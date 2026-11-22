// Vlipsy's official API: search and trending clips, played straight from Vlipsy's servers.
// Docs: https://docs.vlipsy.com  Videos are not copied into our storage.
import * as db from './db.js';
import { html, icon, $, toast, fmtDur, backBtn, copyText } from './ui.js';
import { folderSheet } from './views.js';

const cfg = window.CLIPEMA_CONFIG || {};
const BASE = cfg.vlipsyBase || 'https://apiv2.vlipsy.com';
const DEMO_KEY = 'vl_hFxn07bG43d0n9t'; // public key from Vlipsy's docs; Aman's own key replaces it in Admin
let keyP = null;
const key = () => (keyP = keyP || db.getVlipsyKey().then((k) => k || DEMO_KEY));
export const resetKey = () => { keyP = null; };

async function api(path, params = {}) {
  const u = new URL(BASE + path);
  Object.entries({ ...params, key: await key() }).forEach(([k, v]) => v != null && v !== '' && u.searchParams.set(k, v));
  const r = await fetch(u.href);
  if (!r.ok) throw new Error(r.status === 401 ? 'Vlipsy did not accept the API key.' : `Vlipsy is not answering right now (error ${r.status}).`);
  return r.json();
}

export function norm(v) {
  const m = v.media || {};
  const mp4 = m.mp4 || m.mp4_small || {};
  const thumb = m.preview_small || m.preview_fixed_width || m.preview || {};
  return {
    id: 'vl:' + v.id, vid: v.id, scope: 'vlipsy', title: v.title || 'Untitled', tags: v.tags || [], from: v.from || '',
    duration: v.duration || 0, videoUrl: mp4.url || null, width: mp4.width || 0, height: mp4.height || 0,
    thumbUrl: thumb.url || null, pageUrl: v.url || null, shortUrl: v.short_url || null,
    uploaderName: 'Vlipsy', category: 'Vlipsy', createdAt: 0, views: 0, favCount: 0, shares: 0,
  };
}

const memo = new Map();
export async function trending(limit = 25, pos = 0) {
  const k = `t${limit}:${pos}`;
  if (!memo.has(k)) memo.set(k, api('/v1/vlips/trending', { limit, pos }).catch((e) => { memo.delete(k); throw e; }));
  const j = await memo.get(k);
  return { items: (j.data || []).map(norm), total: (j.pagination && j.pagination.total_count) || 0 };
}
export async function search(q, limit = 30, pos = 0) {
  const clean = String(q).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return trending(limit, pos);
  const j = await api('/v1/vlips/search', { q: clean, limit, pos });
  return { items: (j.data || []).map(norm), total: (j.pagination && j.pagination.total_count) || 0 };
}
export async function get(vid) {
  const j = await api('/v1/vlips/' + encodeURIComponent(vid));
  return norm(j.data || {});
}

const safeName = (s) => (s || 'clip').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'clip';

// The Vlipsy clip page.
export function vlip({ root, match }) {
  const vid = match[1];
  let c = db.state.vlips.get('vl:' + vid) || null, blob = null, blobP = null, gone = false;
  const getBlob = () => {
    if (!blobP) blobP = fetch(c.videoUrl, { mode: 'cors' }).then((r) => { if (!r.ok) throw new Error(); return r.blob(); }).then((b) => (blob = b)).catch((e) => { blobP = null; throw e; });
    return blobP;
  };
  const draw = () => {
    if (!c) { root.innerHTML = String(html`<main class="screen"><div class="top-row">${backBtn('#/search?src=vlipsy')}</div><div class="player skeleton"></div></main>`); return; }
    const fav = db.isFav(c.id);
    const tall = c.height > c.width;
    root.innerHTML = String(html`<main class="screen">
      <div class="top-row">${backBtn('#/search?src=vlipsy')}<span class="grow"></span><span class="pill">From Vlipsy</span></div>
      <div class="player ${tall ? 'tall' : ''}">
        <video id="v" src="${c.videoUrl}" ${c.thumbUrl ? html`poster="${c.thumbUrl}"` : ''} controls playsinline loop preload="auto"></video>
      </div>
      <div class="stack tight">
        <h1 style="font-size:30px;overflow-wrap:anywhere">${c.title}</h1>
        <p class="muted" style="margin:0">${c.from ? `from ${c.from} · ` : ''}${fmtDur(c.duration)} · via Vlipsy</p>
        ${c.tags.length ? html`<div class="tags">${c.tags.slice(0, 12).map((t) => html`<a class="tag" href="#/search?src=vlipsy&q=${encodeURIComponent(t)}">#${t}</a>`)}</div>` : ''}
      </div>
      <div class="actions">
        <button class="act primary" id="share">${icon('share')}Share</button>
        <button class="act" id="dl">${icon('download')}Save</button>
        <button class="act" id="fav" aria-pressed="${fav}">${icon('heart')}${fav ? 'Loved' : 'Love'}</button>
        <button class="act" id="fold">${icon('folder')}Folder</button>
      </div>
    </main>`);
    const v = $('#v', root);
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    $('#share', root).onclick = share;
    $('#dl', root).onclick = download;
    $('#fav', root).onclick = async () => {
      try { const now = await db.toggleFav(c); toast(now ? 'Added to favourites' : 'Removed from favourites'); draw(); } catch (e) { toast(db.friendlyError(e)); }
    };
    $('#fold', root).onclick = async () => { await db.saveVlip(c).catch(() => {}); folderSheet(c); };
  };
  async function share() {
    if (blob) {
      const file = new File([blob], safeName(c.title) + '.mp4', { type: 'video/mp4' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: c.title }); } catch (e) { if (e.name === 'NotAllowedError') toast('Ready now. Tap Share again.'); }
        return;
      }
    } else if (navigator.canShare) {
      toast('Getting the video ready…', 8000);
      try { await getBlob(); toast('Ready. Tap Share again.'); return; } catch { /* Vlipsy may not allow it; share the link */ }
    }
    const link = c.shortUrl || c.pageUrl || c.videoUrl;
    if (navigator.share) { try { await navigator.share({ title: c.title, url: link }); } catch {} } else copyText(link);
  }
  async function download() {
    try {
      toast('Saving…');
      const b = await getBlob();
      const url = URL.createObjectURL(b);
      const a = document.createElement('a'); a.href = url; a.download = safeName(c.title) + '.mp4';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast('Saved');
    } catch { window.open(c.videoUrl, '_blank', 'noopener'); }
  }
  draw();
  get(vid).then((fresh) => {
    if (gone) return;
    c = fresh; draw(); getBlob().catch(() => {});
    if (db.state.vlips.has(c.id)) db.saveVlip(c).catch(() => {}); // keep saved links fresh
  }).catch((e) => { if (!c && !gone) root.innerHTML = String(html`<main class="screen"><div class="top-row">${backBtn('#/search?src=vlipsy')}</div><div class="empty"><div class="glyph">${icon('alert')}</div><h2>This Vlipsy clip did not load</h2><p>${e.message}</p></div></main>`); });
  const off = db.on('profile', () => { const f = $('#fav', root); if (f && c) { const on = db.isFav(c.id); f.setAttribute('aria-pressed', on); f.innerHTML = String(html`${icon('heart')}${on ? 'Loved' : 'Love'}`); } });
  return () => { gone = true; off(); };
}
