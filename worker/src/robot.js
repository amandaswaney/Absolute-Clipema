#!/usr/bin/env node
// The Absolute Clipema clip robot.
//   node src/robot.js           process everything waiting, then stop (GitHub Actions)
//   node src/robot.js --loop    keep checking every minute (old Android phone with Termux)
//   node src/robot.js --setup   one-time setup: security rules, the admin invite, a Backblaze test
//   node src/robot.js --rules   publish the security rules only
//   node src/robot.js --weekly  weekly health check: test-grab a few seconds from YouTube
//   node src/robot.js --peek    say whether anything is waiting (used by GitHub Actions)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getSecurityRules } from 'firebase-admin/security-rules';
import { makeStorage } from './storage.js';
import * as media from './media.js';

const here = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(here, '..', '.env'));
const args = new Set(process.argv.slice(2));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

// ---------- Firebase ----------
function initFirebase() {
  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw && process.env.FIREBASE_SERVICE_ACCOUNT_FILE) raw = fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_FILE, 'utf8');
  if (!raw && !emulator) throw new Error('FIREBASE_SERVICE_ACCOUNT is missing. Add it as a GitHub secret (setup guide, step 5).');
  if (raw) {
    let sa;
    try { sa = JSON.parse(raw.trim()); } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid. Paste the whole contents of the downloaded .json file, from { to }.'); }
    initializeApp({ credential: cert(sa), projectId: sa.project_id });
    return sa.project_id;
  }
  const projectId = process.env.GCLOUD_PROJECT || 'demo-clipema';
  initializeApp({ projectId });
  return projectId;
}

const projectId = initFirebase();
const db = getFirestore();
const auth = getAuth();
const now = () => FieldValue.serverTimestamp();
const runner = process.env.ROBOT_NAME || (process.env.GITHUB_ACTIONS ? 'GitHub Actions' : os.hostname());

function cookiesFile() {
  const c = process.env.YOUTUBE_COOKIES;
  if (!c || !c.trim()) return null;
  const f = path.join(os.tmpdir(), 'clipema-cookies.txt');
  let text = c.trim();
  if (!text.startsWith('# Netscape') && !text.startsWith('# HTTP Cookie File')) text = '# Netscape HTTP Cookie File\n' + text;
  fs.writeFileSync(f, text + '\n', { mode: 0o600 });
  return f;
}

async function heartbeat(extra = {}) {
  await db.doc('config/status').set({ lastRun: now(), runner, ytDlp: await media.ytDlpVersion(), ...extra }, { merge: true });
}

// ---------- Admin tasks ----------
async function doAdminTasks() {
  const snap = await db.collection('adminTasks').get();
  for (const d of snap.docs) {
    const t = d.data();
    try {
      if (t.type === 'setPassword') {
        await auth.updateUser(t.uid, { password: String(t.password) });
        log('Set a new password for', t.uid);
      } else if (t.type === 'disable') {
        await auth.updateUser(t.uid, { disabled: true });
        await auth.revokeRefreshTokens(t.uid);
        log('Switched off account', t.uid);
      } else if (t.type === 'enable') {
        await auth.updateUser(t.uid, { disabled: false });
        log('Switched account back on', t.uid);
      }
    } catch (e) { log('Admin task failed:', t.type, e.message); }
    await d.ref.delete(); // never keep passwords around
  }
}

// ---------- Deleted clips ----------
async function doTrash(storage) {
  const snap = await db.collection('trash').get();
  for (const d of snap.docs) {
    const t = d.data();
    const ref = t.scope === 'personal' ? db.doc(`users/${t.ownerUid}/clips/${d.id}`) : db.doc(`clips/${d.id}`);
    try {
      const c = await ref.get();
      if (c.exists) {
        for (const key of c.data().b2Keys || []) await storage.remove(key).catch((e) => log('Could not remove', key, e.message));
        await ref.set({ deleted: true, purged: true, videoUrl: null, thumbUrl: null, updatedAt: now() }, { merge: true });
      }
      await d.ref.delete();
      log('Removed files for deleted clip', d.id);
    } catch (e) { log('Trash failed for', d.id, e.message); }
  }
}

// ---------- Jobs ----------
async function claim(ref) {
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.data().status !== 'queued') return null;
    tx.update(ref, { status: 'working', startedAt: now(), runner, attempts: FieldValue.increment(1), updatedAt: now() });
    return s.data();
  });
}

const outputsOf = (job) => {
  const ranges = (job.ranges || []).map((r) => ({ s: Number(r.s), e: Number(r.e) })).filter((r) => r.e > r.s);
  if (!ranges.length) return [[{ s: 0, e: media.MAX_SECONDS }]];
  return job.mode === 'split' ? ranges.map((r) => [r]) : [ranges];
};

async function makeClip(job, file, info, storage, title) {
  const scopeColl = job.visibility === 'personal' ? db.collection(`users/${job.ownerUid}/clips`) : db.collection('clips');
  const ref = scopeColl.doc();
  const dir = path.dirname(file);
  const jpg = path.join(dir, `${ref.id}.jpg`);
  let thumbKey = null;
  try { await media.thumbnail(file, jpg, info.duration); thumbKey = `v/${ref.id}.jpg`; } catch (e) { log('No thumbnail:', e.message); }
  const videoKey = `v/${ref.id}.mp4`;
  const videoUrl = await storage.put(videoKey, file, 'video/mp4');
  const thumbUrl = thumbKey ? await storage.put(thumbKey, jpg, 'image/jpeg') : null;
  const t = String(title || job.title || 'Untitled').slice(0, 60);
  await ref.set({
    title: t, titleLower: t.toLowerCase(), tags: job.tags || [], category: job.category || 'Other',
    uploaderUid: job.ownerUid, uploaderName: job.ownerName || 'someone',
    videoUrl, thumbUrl, b2Keys: [videoKey, ...(thumbKey ? [thumbKey] : [])],
    duration: Math.round(info.duration * 10) / 10, width: info.width, height: info.height,
    source: { type: job.type, url: job.url || null },
    views: 0, favCount: 0, shares: 0, deleted: false,
    createdAt: now(), updatedAt: now(),
  });
  return ref.id;
}

async function processLinkJob(job, work, storage) {
  const cookies = cookiesFile();
  const groups = outputsOf(job);
  const ids = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const pieces = [];
    for (let ri = 0; ri < groups[gi].length; ri++) {
      const r = groups[gi][ri];
      log(`Grabbing ${r.s}s to ${r.e}s`);
      pieces.push(await media.grabSection(job.url, r.s, r.e, path.join(work, `g${gi}r${ri}`), cookies));
    }
    const out = path.join(work, `out${gi}.mp4`);
    const info = await media.joinPieces(pieces, out);
    const title = groups.length > 1 ? `${job.title} ${gi + 1}` : job.title;
    ids.push(await makeClip(job, out, info, storage, title));
  }
  return ids;
}

async function processGalleryJob(ref, job, work, storage) {
  const chunks = await ref.collection('chunks').get();
  const parts = job.parts || [];
  const ids = [];
  for (let p = 0; p < parts.length; p++) {
    const mine = chunks.docs.map((d) => d.data()).filter((c) => c.part === p).sort((a, b) => a.i - b.i);
    if (mine.length !== parts[p].chunks) throw new Error('Some of the upload is missing. Please try uploading again.');
    const buf = Buffer.concat(mine.map((c) => Buffer.from(c.data)));
    const raw = path.join(work, `up${p}.mp4`), out = path.join(work, `out${p}.mp4`);
    fs.writeFileSync(raw, buf);
    const info = await media.tidyUpload(raw, out);
    ids.push(await makeClip(job, out, info, storage, parts[p].title || job.title));
  }
  return ids;
}

async function deleteChunks(ref) {
  const chunks = await ref.collection('chunks').get();
  const batches = [];
  for (let i = 0; i < chunks.docs.length; i += 400) {
    const b = db.batch();
    chunks.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    batches.push(b.commit());
  }
  await Promise.all(batches);
}

function explain(e) {
  const m = String((e && e.message) || e);
  if (/Sign in to confirm|not a bot/i.test(m)) return 'YouTube said: Sign in to confirm you are not a bot. (cookies needed)';
  if (/Private video/i.test(m)) return 'Private video';
  if (/Video unavailable|has been removed|This video is not available/i.test(m)) return 'Video unavailable or removed';
  if (/age/i.test(m) && /confirm/i.test(m)) return 'Age restricted video (cookies needed)';
  if (/Unsupported URL/i.test(m)) return 'Unsupported URL';
  return m.split('\n').filter((l) => /ERROR|error|Error/.test(l)).slice(-2).join(' ').slice(0, 400) || m.slice(0, 400);
}

async function doJobs(storage) {
  let count = 0;
  for (;;) {
    const snap = await db.collection('jobs').where('status', '==', 'queued').limit(5).get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const job = await claim(d.ref);
      if (!job) continue;
      count++;
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'clipema-'));
      log(`Job ${d.id}: ${job.type} "${job.title}" by ${job.ownerName}`);
      try {
        const ids = job.type === 'gallery' ? await processGalleryJob(d.ref, job, work, storage) : await processLinkJob(job, work, storage);
        await d.ref.update({ status: 'done', resultClipIds: ids, finishedAt: now(), updatedAt: now(), error: FieldValue.delete() });
        if (job.type === 'gallery') await deleteChunks(d.ref);
        log(`Job ${d.id}: done, made ${ids.length} clip(s)`);
      } catch (e) {
        const msg = explain(e);
        log(`Job ${d.id}: FAILED: ${msg}`);
        if (e.stderr) console.log(e.stderr.slice(-3000));
        await d.ref.update({ status: 'failed', error: msg, finishedAt: now(), updatedAt: now() });
        if (job.type === 'gallery') await deleteChunks(d.ref).catch(() => {});
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    }
  }
  return count;
}

// Tidy up: retry jobs a crashed robot left half done, forget old finished jobs, drop abandoned uploads.
async function doHousekeeping() {
  const ago = (min) => Timestamp.fromMillis(Date.now() - min * 60000);
  const stuck = await db.collection('jobs').where('status', '==', 'working').get();
  for (const d of stuck.docs) {
    const j = d.data();
    if (j.startedAt && j.startedAt.toMillis() < ago(30).toMillis()) {
      if ((j.attempts || 1) < 2) await d.ref.update({ status: 'queued', updatedAt: now() });
      else await d.ref.update({ status: 'failed', error: 'The robot stopped part way through twice.', updatedAt: now() });
    }
  }
  const old = await db.collection('jobs').where('updatedAt', '<', ago(60 * 24 * 14)).limit(200).get();
  for (const d of old.docs) {
    const st = d.data().status;
    if (st === 'done' || st === 'failed' || st === 'uploading') { await deleteChunks(d.ref).catch(() => {}); await d.ref.delete(); }
  }
  const abandoned = await db.collection('jobs').where('status', '==', 'uploading').get();
  for (const d of abandoned.docs) {
    const u = d.data().updatedAt;
    if (u && u.toMillis() < ago(60 * 24).toMillis()) { await deleteChunks(d.ref).catch(() => {}); await d.ref.delete(); }
  }
}

async function processAll(storage) {
  await heartbeat();
  await doAdminTasks();
  await doTrash(storage);
  let n = await doJobs(storage);
  // Someone may have queued a clip while we worked. Look once more after a short wait.
  await new Promise((r) => setTimeout(r, Number(process.env.ROBOT_LINGER_MS || 15000)));
  await doAdminTasks();
  n += await doJobs(storage);
  await doHousekeeping().catch((e) => log('Housekeeping:', e.message));
  await heartbeat();
  return n;
}

// ---------- Setup ----------
async function publishRules() {
  if (process.env.FIRESTORE_EMULATOR_HOST) { log('Emulator: rules are loaded from firestore.rules automatically.'); return; }
  const src = fs.readFileSync(path.join(here, '..', '..', 'firestore.rules'), 'utf8');
  await getSecurityRules().releaseFirestoreRulesetFromSource(src);
  log('Published the Firestore security rules.');
}

async function setup(storage) {
  const results = [];
  const step = async (name, fn) => {
    try { const note = await fn(); results.push(`OK    ${name}${note ? ` (${note})` : ''}`); }
    catch (e) { results.push(`FAIL  ${name}: ${e.message}`); }
  };
  await step('Connect to Firebase', async () => { await db.doc('config/status').set({ setupAt: now() }, { merge: true }); return `project ${projectId}`; });
  await step('Publish security rules', publishRules);
  await step('Create the admin invite code', async () => {
    const code = String(process.env.ADMIN_SETUP_CODE || '').trim().toUpperCase().replace(/\s+/g, '');
    if (code.length < 6) throw new Error('Add a secret called ADMIN_SETUP_CODE with at least 6 letters or numbers');
    const admins = await db.collection('users').where('role', '==', 'admin').limit(1).get();
    if (!admins.empty) return 'an admin already exists, so no new admin code was made';
    const ref = db.doc(`invites/${code}`);
    const s = await ref.get();
    if (s.exists && s.data().usedBy) return 'that code was already used';
    await ref.set({ role: 'admin', note: 'Admin', createdBy: 'setup', createdAt: now(), usedBy: null, usedAt: null });
    return 'use your ADMIN_SETUP_CODE on the Join screen';
  });
  await step('Upload a test file to Backblaze', async () => {
    const f = path.join(os.tmpdir(), 'clipema-test.txt');
    fs.writeFileSync(f, `Absolute Clipema test ${new Date().toISOString()}\n`);
    const url = await storage.put('test/hello.txt', f, 'text/plain');
    let pub = 'could not check';
    try {
      const r = await fetch(url);
      pub = r.ok ? 'files are public, good' : `files are NOT public (HTTP ${r.status}): set the bucket to Public in Backblaze`;
      const cors = await fetch(url, { headers: { Origin: 'https://example.github.io' } });
      if (!cors.headers.get('access-control-allow-origin')) pub += '; sharing the video file needs the CORS rule from step 3';
    } catch (e) { pub = 'could not check: ' + e.message; }
    await storage.remove('test/hello.txt');
    return pub;
  });
  await step('yt-dlp is installed', async () => media.ytDlpVersion());
  await heartbeat({ setupResults: results });
  console.log('\n===== Setup results =====\n' + results.join('\n') + '\n=========================\n');
  if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
}

// ---------- Weekly check ----------
async function weekly() {
  const version = await media.ytDlpVersion();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'clipema-weekly-'));
  const testUrl = process.env.WEEKLY_TEST_URL || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  let ok = false, error = null;
  try {
    const piece = await media.grabSection(testUrl, 1, 4, path.join(work, 't'), cookiesFile());
    const info = await media.probe(piece);
    ok = info.hasVideo && info.duration > 1;
    if (!ok) error = 'The test download was empty';
  } catch (e) { error = explain(e); }
  fs.rmSync(work, { recursive: true, force: true });
  await heartbeat({ weekly: { ok, at: now(), ytDlp: version, error } });
  log(ok ? `Weekly check passed with yt-dlp ${version}` : `Weekly check FAILED with yt-dlp ${version}: ${error}`);
  fs.writeFileSync(path.join(here, '..', '..', 'status', 'weekly-check.json'),
    JSON.stringify({ checkedAt: new Date().toISOString(), ok, ytDlp: version, error }, null, 2) + '\n');
  if (!ok) process.exitCode = 1;
}

// ---------- Main ----------
// Quick look: is there anything to do? Saves installing ffmpeg and yt-dlp on idle runs.
async function peek() {
  const [jobs, tasks, trash, stuck] = await Promise.all([
    db.collection('jobs').where('status', '==', 'queued').limit(1).get(),
    db.collection('adminTasks').limit(1).get(),
    db.collection('trash').limit(1).get(),
    db.collection('jobs').where('status', '==', 'working').limit(1).get(),
  ]);
  const work = !jobs.empty || !tasks.empty || !trash.empty || !stuck.empty;
  const st = await db.doc('config/status').get();
  const last = st.exists && st.data().lastHousekeeping ? st.data().lastHousekeeping.toMillis() : 0;
  const daily = Date.now() - last > 86400000;
  if (daily) await db.doc('config/status').set({ lastHousekeeping: now() }, { merge: true });
  await db.doc('config/status').set({ lastRun: now(), runner }, { merge: true });
  log(work ? 'There is work waiting.' : daily ? 'Nothing waiting, but it is time for the daily tidy-up.' : 'Nothing waiting.');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `work=${work || daily}\n`);
}

async function main() {
  if (args.has('--peek')) return peek();
  if (args.has('--rules')) return publishRules();
  if (args.has('--weekly')) return weekly();
  const storage = makeStorage();
  if (args.has('--setup')) return setup(storage);
  if (args.has('--loop')) {
    log(`Clip robot running on ${runner}. Checking every minute. Press Ctrl+C to stop.`);
    for (;;) {
      try { await processAll(storage); } catch (e) { log('Error:', e.message); }
      await new Promise((r) => setTimeout(r, Number(process.env.ROBOT_INTERVAL_MS || 60000)));
    }
  }
  const n = await processAll(storage);
  log(`Finished. Made clips for ${n} request(s).`);
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error('Robot error:', e.message); process.exit(1); });
