// Everything that talks to Firebase lives here.
import * as fb from '../vendor/firebase.js';

const cfg = window.CLIPEMA_CONFIG || {};
export const configured = !!(cfg.firebase && cfg.firebase.apiKey);
export const MAX_CLIP_SECONDS = 60;
const EMAIL_DOMAIN = 'users.absolute-clipema.example.com'; // hidden placeholder; no emails are ever sent

let app, auth, fs;
export const state = {
  user: null,        // Firebase auth user
  profile: null,     // users/{uid} doc
  clips: new Map(),  // id -> clip
  folders: [],
  media: null,
  vlips: new Map(),
  ready: false,
};
const subs = { clips: new Set(), profile: new Set(), folders: new Set() };
export function on(kind, fn) { subs[kind].add(fn); return () => subs[kind].delete(fn); }
const emit = (kind) => subs[kind].forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

export function init() {
  app = fb.initializeApp(cfg.firebase);
  auth = fb.getAuth(app);
  const settings = {};
  if (!cfg.emulator) {
    try { settings.localCache = fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }); } catch {}
  }
  fs = fb.initializeFirestore(app, settings);
  if (cfg.emulator) {
    fb.connectAuthEmulator(auth, `http://${cfg.emulator.host || '127.0.0.1'}:9099`, { disableWarnings: true });
    fb.connectFirestoreEmulator(fs, cfg.emulator.host || '127.0.0.1', 8080);
  }
}

export const normUsername = (u) => String(u || '').trim().toLowerCase();
export const validUsername = (u) => /^[a-z0-9_.-]{3,20}$/.test(u);
const emailFor = (u) => `${normUsername(u)}@${EMAIL_DOMAIN}`;
export const normCode = (c) => String(c || '').trim().toUpperCase().replace(/\s+/g, '');

function friendly(e) {
  const c = e && e.code;
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-email') return 'That username and password do not match. Check both and try again.';
  if (c === 'auth/user-disabled') return 'This account has been switched off by the admin.';
  if (c === 'auth/too-many-requests') return 'Too many tries in a row. Wait a few minutes, then try again.';
  if (c === 'auth/network-request-failed' || c === 'unavailable') return 'Could not reach the internet. Check your connection and try again.';
  if (c === 'auth/weak-password') return 'Pick a password with at least 6 characters.';
  if (c === 'auth/email-already-in-use') return 'That username is taken. Try another.';
  if (c === 'permission-denied') return 'That was not allowed. If it keeps happening, ask Aman.';
  return (e && e.message) || 'Something went wrong. Try again.';
}
export const friendlyError = friendly;

// ---------- Auth ----------
export function watchAuth(cb) { return fb.onAuthStateChanged(auth, cb); }

export async function signIn(username, password) {
  try { await fb.signInWithEmailAndPassword(auth, emailFor(username), password); }
  catch (e) { throw new Error(friendly(e)); }
}

export async function join(code, username, password) {
  code = normCode(code); username = normUsername(username);
  if (!code) throw new Error('Type the invite code a friend gave you.');
  if (!validUsername(username)) throw new Error('Usernames are 3 to 20 letters, numbers, dots, dashes or underscores.');
  if (!password || password.length < 6) throw new Error('Pick a password with at least 6 characters.');
  let inv;
  try { inv = await fb.getDoc(fb.doc(fs, 'invites', code)); } catch (e) { throw new Error(friendly(e)); }
  if (!inv.exists()) throw new Error('That invite code does not work. Check it with the friend who sent it.');
  if (inv.data().usedBy) throw new Error('That invite code has already been used. Ask for a new one.');
  const taken = await fb.getDoc(fb.doc(fs, 'usernames', username)).catch(() => null);
  if (taken && taken.exists()) throw new Error('That username is taken. Try another.');
  let cred;
  try { cred = await fb.createUserWithEmailAndPassword(auth, emailFor(username), password); }
  catch (e) { throw new Error(friendly(e)); }
  const uid = cred.user.uid;
  try {
    const b = fb.writeBatch(fs);
    b.set(fb.doc(fs, 'users', uid), {
      username, role: inv.data().role || 'member', inviteCode: code, theme: localTheme(), favs: [], removed: false, createdAt: fb.serverTimestamp(),
    });
    b.set(fb.doc(fs, 'usernames', username), { uid });
    b.update(fb.doc(fs, 'invites', code), { usedBy: uid, usedAt: fb.serverTimestamp() });
    await b.commit();
  } catch (e) {
    await fb.deleteUser(cred.user).catch(() => {});
    throw new Error(e.code === 'permission-denied' ? 'That invite code or username could not be used. Try again, or ask for a new code.' : friendly(e));
  }
}
function localTheme() { try { return localStorage.getItem('clipema-theme') || 'purple'; } catch { return 'purple'; } }

export async function signOutNow() {
  stopSync();
  await fb.signOut(auth);
}

export async function changePassword(current, next) {
  if (!next || next.length < 6) throw new Error('Pick a new password with at least 6 characters.');
  try {
    const cred = fb.EmailAuthProvider.credential(state.user.email, current);
    await fb.reauthenticateWithCredential(state.user, cred);
    await fb.updatePassword(state.user, next);
  } catch (e) { throw new Error(friendly(e)); }
}

// ---------- Profile ----------
let unsubs = [];
function stopSync() { unsubs.forEach((u) => u()); unsubs = []; state.clips.clear(); state.folders = []; state.profile = null; }

export function watchProfile(uid, cb) {
  const u = fb.onSnapshot(fb.doc(fs, 'users', uid), { includeMetadataChanges: true }, (snap) => {
    state.profile = snap.exists() ? { id: uid, ...snap.data() } : null;
    // While joining, the profile exists on this phone a moment before the server has it.
    cb(state.profile, null, snap.metadata.hasPendingWrites); emit('profile');
  }, (err) => cb(null, err));
  unsubs.push(u);
  return u;
}
export const isAdmin = () => state.profile && state.profile.role === 'admin';
export async function saveTheme(id) { if (state.user) await fb.updateDoc(fb.doc(fs, 'users', state.user.uid), { theme: id }); }

// ---------- Clips ----------
// Videos live in a private Backblaze bucket. The robot keeps a 7-day download pass in config/media.
function mediaUrl(key, fallback) {
  const m = state.media;
  if (key && m && m.base && m.token) return `${m.base}${key.split('/').map(encodeURIComponent).join('/')}?Authorization=${encodeURIComponent(m.token)}`;
  return fallback || null;
}
function normClip(snap, scope) {
  const d = snap.data({ serverTimestamps: 'estimate' });
  return {
    videoKey: d.videoKey || null, thumbKey: d.thumbKey || null, rawVideoUrl: d.videoUrl, rawThumbUrl: d.thumbUrl,
    get videoUrl() { return mediaUrl(this.videoKey, this.rawVideoUrl); },
    get thumbUrl() { return mediaUrl(this.thumbKey, this.rawThumbUrl); },
    id: snap.id, scope, title: d.title || 'Untitled', tags: d.tags || [], category: d.category || 'Other',
    uploaderUid: d.uploaderUid, uploaderName: d.uploaderName || 'someone',
    duration: d.duration || 0, width: d.width || 0, height: d.height || 0,
    views: d.views || 0, favCount: d.favCount || 0, shares: d.shares || 0,
    createdAt: d.createdAt ? d.createdAt.toMillis() : 0, updatedAt: d.updatedAt ? d.updatedAt.toMillis() : 0,
    deleted: !!d.deleted, source: d.source || null,
  };
}
let clipEmitTimer;
const emitClipsSoon = () => { clearTimeout(clipEmitTimer); clipEmitTimer = setTimeout(() => emit('clips'), 30); };

async function syncCollection(coll, scope) {
  let since = 0;
  try {
    const cached = await fb.getDocsFromCache(fb.query(coll));
    cached.forEach((s) => {
      const c = normClip(s, scope);
      since = Math.max(since, c.updatedAt);
      if (c.deleted) state.clips.delete(c.id); else state.clips.set(c.id, c);
    });
    if (cached.size) emitClipsSoon();
  } catch { /* no cache yet */ }
  // Only fetch what changed since the newest clip we already have, to save free-tier reads.
  const q = fb.query(coll, fb.where('updatedAt', '>', fb.Timestamp.fromMillis(Math.max(0, since - 1000))), fb.orderBy('updatedAt'));
  return new Promise((resolve) => {
    let first = true;
    const listen = (attempt) => {
      const u = fb.onSnapshot(q, (snap) => {
        snap.docChanges().forEach((ch) => {
          const c = normClip(ch.doc, scope);
          if (c.deleted || ch.type === 'removed') state.clips.delete(c.id); else state.clips.set(c.id, c);
        });
        emitClipsSoon();
        if (first) { first = false; resolve(); }
      }, (err) => {
        console.warn('clip sync', err.code || err);
        if (first) { first = false; resolve(); }
        if (attempt < 5 && state.user) setTimeout(() => listen(attempt + 1), 2000 * (attempt + 1));
      });
      unsubs.push(u);
    };
    listen(0);
  });
}

export async function startSync(uid) {
  unsubs.push(fb.onSnapshot(fb.collection(fs, 'users', uid, 'vlips'), (snap) => {
    state.vlips = new Map(snap.docs.map((d) => { const x = d.data(); return ['vl:' + d.id, { ...x, id: 'vl:' + d.id, vid: d.id, scope: 'vlipsy', uploaderName: 'Vlipsy', category: 'Vlipsy', createdAt: 0 }]; }));
    emit('clips');
  }, () => {}));
  unsubs.push(fb.onSnapshot(fb.doc(fs, 'config', 'media'), (s) => { state.media = s.exists() ? s.data() : null; emit('clips'); }, () => {}));
  const a = syncCollection(fb.collection(fs, 'clips'), 'group');
  const b = syncCollection(fb.collection(fs, 'users', uid, 'clips'), 'personal');
  unsubs.push(fb.onSnapshot(fb.collection(fs, 'users', uid, 'folders'), (snap) => {
    state.folders = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
      .map((f) => ({ ...f, clipIds: f.clipIds || [], createdAt: f.createdAt ? f.createdAt.toMillis() : 0 }))
      .sort((x, y) => x.name.localeCompare(y.name));
    emit('folders');
  }, (e) => console.warn('folders', e)));
  await Promise.all([a, b]);
  state.ready = true;
  emit('clips');
}

const clipRef = (c) => c.scope === 'personal' ? fb.doc(fs, 'users', c.uploaderUid, 'clips', c.id) : fb.doc(fs, 'clips', c.id);

const seen = new Set();
export function countView(c) {
  if (seen.has(c.id)) return;
  seen.add(c.id);
  fb.updateDoc(clipRef(c), { views: fb.increment(1), updatedAt: fb.serverTimestamp() }).catch(() => {});
}
export function countShare(c) {
  fb.updateDoc(clipRef(c), { shares: fb.increment(1), updatedAt: fb.serverTimestamp() }).catch(() => {});
}
export const isFav = (id) => !!(state.profile && (state.profile.favs || []).includes(id));
export async function toggleFav(c) {
  const fav = isFav(c.id);
  const b = fb.writeBatch(fs);
  if (c.scope === 'vlipsy') { // Vlipsy clips: keep a small copy of the details so Library can show them
    b.update(fb.doc(fs, 'users', state.user.uid), { favs: fav ? fb.arrayRemove(c.id) : fb.arrayUnion(c.id) });
    if (!fav) b.set(fb.doc(fs, 'users', state.user.uid, 'vlips', c.vid), vlipSnapshot(c));
    await b.commit();
    return !fav;
  }
  b.update(fb.doc(fs, 'users', state.user.uid), { favs: fav ? fb.arrayRemove(c.id) : fb.arrayUnion(c.id) });
  b.update(clipRef(c), { favCount: fb.increment(fav ? -1 : 1), updatedAt: fb.serverTimestamp() });
  await b.commit();
  return !fav;
}
export const canDelete = (c) => state.user && (c.uploaderUid === state.user.uid || isAdmin());
export async function deleteClip(c) {
  const b = fb.writeBatch(fs);
  b.set(fb.doc(fs, 'trash', c.id), { scope: c.scope, ownerUid: c.uploaderUid, by: state.user.uid, createdAt: fb.serverTimestamp() });
  b.update(clipRef(c), { deleted: true, updatedAt: fb.serverTimestamp() });
  await b.commit();
  state.clips.delete(c.id);
  emit('clips');
  pokeRobot();
}
export async function editClip(c, { title, tags, category }) {
  await fb.updateDoc(clipRef(c), { title, titleLower: title.toLowerCase(), tags, category, updatedAt: fb.serverTimestamp() });
}

// ---------- Vlipsy clips saved by reference ----------
const vlipSnapshot = (c) => ({ vid: c.vid, title: c.title, tags: c.tags || [], from: c.from || '', duration: c.duration || 0,
  thumbUrl: c.thumbUrl || null, videoUrl: c.videoUrl || null, width: c.width || 0, height: c.height || 0, savedAt: fb.serverTimestamp() });
export async function saveVlip(c) { await fb.setDoc(fb.doc(fs, 'users', state.user.uid, 'vlips', c.vid), vlipSnapshot(c)); }
export const getAny = (id) => state.clips.get(id) || state.vlips.get(id) || null;
export async function getVlipsyKey() {
  try { const s = await fb.getDoc(fb.doc(fs, 'config', 'vlipsy')); return s.exists() ? s.data().key || '' : ''; } catch { return ''; }
}
export async function saveVlipsyKey(key) { await fb.setDoc(fb.doc(fs, 'config', 'vlipsy'), { key: key.trim(), updatedAt: fb.serverTimestamp() }); }

// ---------- Folders ----------
export async function createFolder(name) {
  const ref = await fb.addDoc(fb.collection(fs, 'users', state.user.uid, 'folders'), { name: name.trim().slice(0, 40), clipIds: [], createdAt: fb.serverTimestamp() });
  return ref.id;
}
export async function setInFolder(folderId, clipId, inside) {
  await fb.updateDoc(fb.doc(fs, 'users', state.user.uid, 'folders', folderId), { clipIds: inside ? fb.arrayUnion(clipId) : fb.arrayRemove(clipId) });
}
export async function renameFolder(folderId, name) { await fb.updateDoc(fb.doc(fs, 'users', state.user.uid, 'folders', folderId), { name: name.trim().slice(0, 40) }); }
export async function deleteFolder(folderId) { await fb.deleteDoc(fb.doc(fs, 'users', state.user.uid, 'folders', folderId)); }

// ---------- Jobs (clips waiting for the robot) ----------
export function newJobId() { return fb.doc(fb.collection(fs, 'jobs')).id; }

export async function createLinkJob(job, { poke = true } = {}) {
  const ref = fb.doc(fb.collection(fs, 'jobs'));
  await fb.setDoc(ref, {
    ...job, ownerUid: state.user.uid, ownerName: state.profile.username, status: 'queued',
    createdAt: fb.serverTimestamp(), updatedAt: fb.serverTimestamp(),
  });
  if (poke) pokeRobot();
  return ref.id;
}

// Admin bulk import: the robot reads each page's title, tags and video first, for review.
export async function createLookupJob(urls) {
  const ref = fb.doc(fb.collection(fs, 'jobs'));
  await fb.setDoc(ref, {
    type: 'lookup', urls: urls.slice(0, 20), title: 'Looking up links', visibility: 'group', ranges: [],
    ownerUid: state.user.uid, ownerName: state.profile.username, status: 'queued',
    createdAt: fb.serverTimestamp(), updatedAt: fb.serverTimestamp(),
  });
  pokeRobot();
  return ref.id;
}

// Gallery clips are cut on the phone, then sent in ~900 KB pieces for the robot to move to Backblaze.
export const CHUNK = 900 * 1024;
export async function createUploadJob(job, outputs, onProgress) {
  const ref = fb.doc(fb.collection(fs, 'jobs'));
  const parts = outputs.map((o) => ({ chunks: Math.ceil(o.bytes.length / CHUNK), size: o.bytes.length, duration: o.duration, title: o.title || null }));
  await fb.setDoc(ref, {
    ...job, type: 'gallery', parts, ownerUid: state.user.uid, ownerName: state.profile.username, status: 'uploading',
    createdAt: fb.serverTimestamp(), updatedAt: fb.serverTimestamp(),
  });
  const total = parts.reduce((s, p) => s + p.chunks, 0);
  let sent = 0;
  for (let p = 0; p < outputs.length; p++) {
    const bytes = outputs[p].bytes;
    for (let i = 0; i < parts[p].chunks; i++) {
      const piece = bytes.subarray(i * CHUNK, Math.min(bytes.length, (i + 1) * CHUNK));
      await fb.setDoc(fb.doc(fs, 'jobs', ref.id, 'chunks', `p${p}-${String(i).padStart(3, '0')}`), { part: p, i, data: fb.Bytes.fromUint8Array(piece) });
      sent++; onProgress && onProgress(sent / total);
    }
  }
  await fb.updateDoc(ref, { status: 'queued', updatedAt: fb.serverTimestamp() });
  pokeRobot();
  return ref.id;
}

export function watchJob(id, cb) {
  return fb.onSnapshot(fb.doc(fs, 'jobs', id), (s) => cb(s.exists() ? { id: s.id, ...s.data({ serverTimestamps: 'estimate' }) } : null), () => cb(null));
}
export async function myJobs() {
  const snap = await fb.getDocs(fb.query(fb.collection(fs, 'jobs'), fb.where('ownerUid', '==', state.user.uid)));
  return snap.docs.map((d) => {
    const x = d.data({ serverTimestamps: 'estimate' });
    return { id: d.id, ...x, createdAt: x.createdAt ? x.createdAt.toMillis() : 0 };
  }).sort((a, b) => b.createdAt - a.createdAt);
}
export async function deleteJob(id) { await fb.deleteDoc(fb.doc(fs, 'jobs', id)); }
export async function retryJob(id) {
  // Retry by copying the request into a fresh job.
  const s = await fb.getDoc(fb.doc(fs, 'jobs', id));
  if (!s.exists()) return null;
  const d = s.data();
  const keep = ['type', 'url', 'ranges', 'mode', 'title', 'tags', 'category', 'visibility'];
  const job = {}; keep.forEach((k) => { if (d[k] !== undefined) job[k] = d[k]; });
  const newId = await createLinkJob(job);
  await fb.deleteDoc(s.ref).catch(() => {});
  return newId;
}

// ---------- The robot ----------
let triggerCache = null;
export async function pokeRobot() {
  try {
    if (!triggerCache) {
      const s = await fb.getDoc(fb.doc(fs, 'config', 'trigger'));
      triggerCache = s.exists() ? s.data() : {};
    }
    const token = triggerCache.token;
    const repo = triggerCache.repo || cfg.repo;
    if (!token || !repo) return false; // the robot still checks every 10 minutes on its own
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/robot.yml/dispatches`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: triggerCache.branch || 'main' }),
    });
    return res.status === 204;
  } catch { return false; }
}
export async function getStatus() {
  const s = await fb.getDoc(fb.doc(fs, 'config', 'status'));
  return s.exists() ? s.data() : null;
}
export async function getTrigger() {
  const s = await fb.getDoc(fb.doc(fs, 'config', 'trigger'));
  return s.exists() ? s.data() : {};
}
export async function saveTrigger(token) {
  await fb.setDoc(fb.doc(fs, 'config', 'trigger'), { token: token.trim(), repo: cfg.repo || '', branch: 'main', updatedAt: fb.serverTimestamp() }, { merge: true });
  triggerCache = null;
}
export async function testTrigger() { triggerCache = null; return pokeRobot(); }

// ---------- Admin ----------
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export async function createInvite(note) {
  const buf = new Uint32Array(8); crypto.getRandomValues(buf);
  const letters = Array.from(buf.slice(0, 4), (n) => CODE_LETTERS[n % CODE_LETTERS.length]).join('');
  const digits = Array.from(buf.slice(4), (n) => String(n % 10)).join('');
  const code = `${letters}-${digits}`;
  await fb.setDoc(fb.doc(fs, 'invites', code), { role: 'member', note: (note || '').slice(0, 40), createdBy: state.user.uid, createdAt: fb.serverTimestamp(), usedBy: null, usedAt: null });
  return code;
}
export async function listInvites() {
  const snap = await fb.getDocs(fb.collection(fs, 'invites'));
  return snap.docs.map((d) => { const x = d.data({ serverTimestamps: 'estimate' }); return { code: d.id, ...x, createdAt: x.createdAt ? x.createdAt.toMillis() : 0 }; })
    .sort((a, b) => b.createdAt - a.createdAt);
}
export async function cancelInvite(code) { await fb.deleteDoc(fb.doc(fs, 'invites', code)); }
export async function listMembers() {
  const snap = await fb.getDocs(fb.collection(fs, 'users'));
  return snap.docs.map((d) => { const x = d.data({ serverTimestamps: 'estimate' }); return { id: d.id, ...x, createdAt: x.createdAt ? x.createdAt.toMillis() : 0 }; })
    .sort((a, b) => a.username.localeCompare(b.username));
}
export async function adminSetPassword(uid, password) {
  await fb.addDoc(fb.collection(fs, 'adminTasks'), { type: 'setPassword', uid, password, by: state.user.uid, createdAt: fb.serverTimestamp() });
  pokeRobot();
}
export async function adminSetRemoved(uid, removed) {
  const b = fb.writeBatch(fs);
  b.update(fb.doc(fs, 'users', uid), { removed });
  b.set(fb.doc(fb.collection(fs, 'adminTasks')), { type: removed ? 'disable' : 'enable', uid, by: state.user.uid, createdAt: fb.serverTimestamp() });
  await b.commit();
  pokeRobot();
}
