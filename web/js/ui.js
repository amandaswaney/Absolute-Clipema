// Small UI helpers: safe HTML templates, icons, toasts, sheets and formatting.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

// Tagged template that escapes every value unless it is raw() or an array of raw().
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) out += show(vals[i]);
  });
  return raw(out);
}
function show(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return String(v); // so aria-pressed="false" etc. come out right
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(show).join('');
  return esc(v);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const P = {
  home: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  out: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  robot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
};
export const icon = (name, cls = '', style = '') => raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"${style ? ` style="${style}"` : ''}>${P[name] || ''}</svg>`);

let toastTimer;
export function toast(msg, ms = 2600) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// Bottom sheet. Returns { el, close }. content is html() output; onMount(el, close) binds events.
export function sheet(title, content, onMount) {
  const prev = document.activeElement;
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = String(html`<div class="sheet" role="dialog" aria-modal="true" aria-label="${title}"><div class="grab" aria-hidden="true"></div>
    <div class="top-row"><h2 class="grow">${title}</h2><button class="sq-btn" data-close aria-label="Close" title="Close">${icon('x')}</button></div>
    ${content}</div>`);
  document.body.appendChild(scrim);
  const el = scrim.firstElementChild;
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { // keep focus inside the sheet
      const f = $$('button, a[href], input, select, textarea', el).filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  $('[data-close]', el).addEventListener('click', close);
  if (onMount) onMount(el, close);
  const first = $('input, textarea, select', el) || $('[data-close]', el);
  setTimeout(() => first && first.focus(), 30);
  return { el, close };
}

// Confirm sheet with a named destructive action.
export function confirmSheet({ title, body, confirm, danger = true }) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet(title, html`<p class="muted" style="margin:0">${body}</p>
      <div class="btn-row"><button class="btn ghost" data-no>Keep it</button><button class="btn ${danger ? 'danger' : ''}" data-yes>${confirm}</button></div>`,
    (el, close) => {
      $('[data-no]', el).onclick = () => { done = true; close(); resolve(false); };
      $('[data-yes]', el).onclick = () => { done = true; close(); resolve(true); };
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(s.el)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

export function fmtTime(s, tenths = true) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const whole = Math.floor(sec);
  const str = `${m}:${String(whole).padStart(2, '0')}`;
  return tenths ? `${str}.${Math.floor((sec - whole) * 10 + 1e-6)}` : str;
}
export function fmtDur(s) {
  if (!s && s !== 0) return '';
  const r = Math.max(1, Math.round(s));
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
}
export function fmtSecs(s) { return `${(Math.round(s * 10) / 10).toFixed(1)} s`; }
export function parseTime(str) {
  str = String(str || '').trim().replace(',', '.');
  if (!str) return NaN;
  const parts = str.split(':').map(Number);
  if (parts.some((n) => !isFinite(n) || n < 0)) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
export function ago(ms) {
  if (!ms) return '';
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} d ago`;
  return new Date(ms).toLocaleDateString();
}
export function when(ms) {
  if (!ms) return 'never';
  return new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function backBtn(href = '#/home') {
  return html`<a class="sq-btn" href="${href}" data-back aria-label="Back" title="Back">${icon('back')}</a>`;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { toast('Copy did not work. Press and hold to copy it instead.'); }
}
