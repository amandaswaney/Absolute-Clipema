import * as db from './db.js';
import { html, icon, $, toast } from './ui.js';
import { applyTheme } from './themes.js';
import * as views from './views.js';
import * as create from './create.js';
import * as admin from './admin.js';
import { bulkImport } from './import.js';
import * as vlipsy from './vlipsy.js';

const root = document.getElementById('app');
let cleanup = null;

const ROUTES = [
  [/^\/home$/, views.home, 'home'],
  [/^\/search$/, views.search, 'search'],
  [/^\/clip\/([\w-]+)$/, views.clip, ''],
  [/^\/vlip\/([\w-]+)$/, vlipsy.vlip, 'search'],
  [/^\/library$/, views.library, 'library'],
  [/^\/library\/(favs|mine)$/, views.libraryList, 'library'],
  [/^\/folder\/([\w-]+)$/, views.folder, 'library'],
  [/^\/me$/, views.me, 'me'],
  [/^\/colours$/, views.colours, 'me'],
  [/^\/jobs$/, views.jobs, 'me'],
  [/^\/create$/, create.source, 'create'],
  [/^\/create\/trim$/, create.trim, 'create'],
  [/^\/create\/details$/, create.details, 'create'],
  [/^\/job\/([\w-]+)$/, create.progress, 'create'],
  [/^\/admin$/, admin.admin, 'me'],
  [/^\/import$/, bulkImport, 'create'],
];

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/home';
  const [path, qs] = h.split('?');
  return { path, params: new URLSearchParams(qs || '') };
}

function nav(active) {
  const a = (id, href, label, ic) => html`<a href="${href}" ${active === id ? html`aria-current="page"` : ''}>${icon(ic)}${label}</a>`;
  return html`<nav class="nav" aria-label="Main"><div class="nav-in">
    ${a('home', '#/home', 'Home', 'home')}
    ${a('search', '#/search', 'Search', 'search')}
    <a href="#/create" class="make" aria-label="Make a clip" title="Make a clip" ${active === 'create' ? html`aria-current="page"` : ''}>${icon('plus')}</a>
    ${a('library', '#/library', 'Library', 'folder')}
    ${a('me', '#/me', 'Me', 'user')}
  </div></nav>`;
}

// Each view gets { root, params, match } and returns optional cleanup.
async function render() {
  if (!state.signedIn) return;
  const { path, params } = parseHash();
  const found = ROUTES.find(([re]) => re.test(path));
  if (!found) { location.hash = '#/home'; return; }
  const [re, view, active] = found;
  const match = path.match(re);
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const container = document.createElement('div');
  root.replaceChildren(container);
  const showNav = !path.startsWith('/create/') && !path.startsWith('/job/');
  if (showNav) root.insertAdjacentHTML('beforeend', String(nav(active)));
  try {
    cleanup = (await view({ root: container, params, match, rerender: render })) || null;
  } catch (e) {
    console.error(e);
    container.innerHTML = String(html`<main class="screen"><div class="empty"><div class="glyph">${icon('alert')}</div><h2>That screen did not load</h2><p>${db.friendlyError(e)}</p><a class="btn small" href="#/home">Go home</a></div></main>`);
  }
  window.scrollTo(0, 0);
}

const state = { signedIn: false };

function authScreen(mode = 'join') {
  state.signedIn = false;
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const join = mode === 'join';
  root.innerHTML = String(html`<main class="screen auth no-nav">
    <div class="stack tight" style="gap:18px">
      <img class="logo" src="icons/icon-192.png" alt="Absolute Clipema" width="72" height="72">
      <div>
        <h1 style="font-size:38px">${join ? 'Join the group' : 'Welcome back'}</h1>
        <p class="lead">${join ? 'Absolute Clipema is invite only. Ask a friend in the group for a code.' : 'Sign in with your username and password.'}</p>
      </div>
    </div>
    <div class="seg" role="tablist" aria-label="Account">
      <button role="tab" aria-selected="${!join}" data-mode="signin">Sign in</button>
      <button role="tab" aria-selected="${join}" data-mode="join">Join</button>
    </div>
    <form class="stack" novalidate>
      ${join ? html`<div class="field"><label for="code">Invite code</label>
        <input class="input" id="code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-1234" required></div>` : ''}
      <div class="field"><label for="user">Username</label>
        <input class="input" id="user" name="user" autocomplete="username" autocapitalize="none" spellcheck="false" required>
        ${join ? html`<span class="hint">Friends will see this next to your clips. 3 to 20 letters or numbers.</span>` : ''}</div>
      <div class="field"><label for="pw">Password</label>
        <input class="input" id="pw" name="pw" type="password" autocomplete="${join ? 'new-password' : 'current-password'}" required>
        ${join ? html`<span class="hint">There is no reset by email, so pick one you will remember. If you forget it, Aman can set a new one.</span>` : ''}</div>
      <p class="err" role="alert" id="err"></p>
      <button class="btn" type="submit">${join ? 'Join the group' : 'Sign in'}</button>
    </form>
  </main>`);
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => authScreen(b.dataset.mode)));
  const form = root.querySelector('form');
  const err = $('#err');
  if (state.authError) {
    err.textContent = state.authError;
    if (state.authForm) { if (form.code) form.code.value = state.authForm.code; form.user.value = state.authForm.user; }
  }
  form.addEventListener('input', () => { err.textContent = ''; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const user = form.user.value, pw = form.pw.value;
    if (!user.trim() || !pw) { err.textContent = 'Fill in your username and password.'; return; }
    btn.disabled = true; btn.textContent = join ? 'Joining…' : 'Signing in…';
    try {
      if (join) await db.join(form.code.value, user, pw); else await db.signIn(user, pw);
    } catch (ex) {
      err.textContent = ex.message; btn.disabled = false; btn.textContent = join ? 'Join the group' : 'Sign in';
      // A failed join signs the half-made account out, which redraws this screen. Keep the message and typing.
      state.authError = ex.message;
      state.authForm = { code: form.code ? form.code.value : '', user };
      setTimeout(() => { state.authError = null; }, 3000);
    }
  });
}

function notConfigured() {
  root.innerHTML = String(html`<main class="screen auth no-nav"><img class="logo" src="icons/icon-192.png" alt="" width="72" height="72">
    <h1>Almost there</h1><p class="lead">The app is installed but not connected to its database yet. Follow the setup guide, step 6, to add the Firebase settings, then reload this page.</p></main>`);
}

function removedScreen() {
  root.innerHTML = String(html`<main class="screen auth no-nav"><img class="logo" src="icons/icon-192.png" alt="" width="72" height="72">
    <h1>You're signed out</h1><p class="lead">This account is no longer part of the group. If that seems wrong, ask Aman.</p>
    <button class="btn ghost" id="back">Back to sign in</button></main>`);
  $('#back').onclick = () => authScreen('signin');
}

function boot() {
  if ('serviceWorker' in navigator && !(window.CLIPEMA_CONFIG || {}).emulator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!db.configured) { notConfigured(); return; }
  db.init();
  let profileUnsub = null;
  let firstRender = true;
  db.watchAuth((user) => {
    if (profileUnsub) { profileUnsub(); profileUnsub = null; }
    db.state.user = user;
    if (!user) {
      let had = false; try { had = !!localStorage.getItem('clipema-has-account'); } catch {}
      authScreen(had ? 'signin' : 'join');
      return;
    }
    let waited = 0;
    profileUnsub = db.watchProfile(user.uid, async (profile, err, pending) => {
      if (err || (profile && profile.removed)) { removedScreen(); db.signOutNow(); return; }
      if (!profile) {
        // Just joined: the profile is being written. Give it a moment.
        if (++waited > 3) { removedScreen(); db.signOutNow(); }
        return;
      }
      applyTheme(profile.theme);
      if (pending && !state.signedIn) return; // wait until the server has the new profile
      try { localStorage.setItem('clipema-has-account', '1'); } catch {}
      if (!state.signedIn) {
        state.signedIn = true;
        firstRender = true;
        db.startSync(user.uid).catch((e) => console.warn(e));
        if (!location.hash || location.hash === '#' || location.hash === '#/') location.hash = '#/home';
        handleShareTarget();
        render();
      }
    });
  });
  window.addEventListener('hashchange', render);
}

// Android "share to Clipema" lands here with ?url= or ?text= in the page address.
function handleShareTarget() {
  const p = new URLSearchParams(location.search);
  const shared = p.get('url') || p.get('text') || '';
  const m = shared.match(/https?:\/\/\S+/);
  if (m) {
    history.replaceState(null, '', location.pathname + '#/create?url=' + encodeURIComponent(m[0]));
  }
}

window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); });
boot();
export { toast };
