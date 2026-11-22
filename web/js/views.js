import * as db from './db.js';
import { html, raw, icon, $, $$, toast, sheet, confirmSheet, fmtDur, ago, backBtn, copyText, esc } from './ui.js';
import { THEMES, CATEGORIES, applyTheme } from './themes.js';

const TILES = ['var(--t1)', 'var(--t2)', 'var(--t3)', 'var(--t4)'];
const tileFor = (id) => TILES[[...id].reduce((s, ch) => s + ch.charCodeAt(0), 0) % 4];

export function card(c, big = false) {
  return html`<a class="card" href="#/clip/${c.id}">
    <div class="thumb" style="background:${raw(tileFor(c.id))}">
      ${c.thumbUrl ? html`<img src="${c.thumbUrl}" alt="" loading="lazy" decoding="async" onerror="this.remove()"><span class="shade"></span>` : ''}
      ${c.scope === 'personal' ? html`<span class="badge">Only you</span>` : ''}
      <span class="dur">${fmtDur(c.duration)}</span>
      <span class="ttl">${c.title}</span>
    </div>
    <div class="meta"><span>by ${c.uploaderName}</span>${big ? html`<span>${c.shares} ${c.shares === 1 ? 'share' : 'shares'}</span>` : ''}</div>
  </a>`;
}
const skeletons = (n, h = 104) => raw(Array.from({ length: n }, () => `<div class="card" aria-hidden="true"><div class="thumb skeleton" style="height:${h}px"></div><div class="skeleton" style="height:12px;width:60%;border-radius:6px"></div></div>`).join(''));

const groupClips = () => [...db.state.clips.values()].filter((c) => c.scope === 'group');
const allClips = () => [...db.state.clips.values()];
const newest = (list) => list.sort((a, b) => b.createdAt - a.createdAt);
const score = (c) => c.favCount * 3 + c.shares * 2 + c.views;

function trending(list) {
  const now = Date.now();
  for (const days of [7, 30, 3650]) {
    const recent = list.filter((c) => now - c.createdAt < days * 86400000 && score(c) > 0);
    if (recent.length >= 3 || days === 3650) {
      return { days, items: recent.sort((a, b) => score(b) - score(a) || b.createdAt - a.createdAt).slice(0, 10) };
    }
  }
}

function header() {
  return html`<header class="app-head">
    <img src="icons/icon-192.png" alt="" width="38" height="38">
    <span class="name">Absolute Clipema</span>
    <a class="sq-btn" href="#/colours" aria-label="App colours" title="App colours"><span class="dot" aria-hidden="true"></span></a>
  </header>`;
}

// ---------- Home ----------
export function home({ root }) {
  let cat = 'All';
  const draw = () => {
    const ready = db.state.ready || db.state.clips.size > 0;
    const list = groupClips().filter((c) => cat === 'All' || c.category === cat);
    const cats = ['All', ...CATEGORIES.filter((k) => groupClips().some((c) => c.category === k))];
    const tr = trending(list.slice());
    const fresh = newest(list.slice()).slice(0, 40);
    root.innerHTML = String(html`<main class="screen">
      ${header()}
      <a class="search" href="#/search">${icon('search')}<span>Search clips, tags, people</span></a>
      ${cats.length > 1 ? html`<div class="chips" role="group" aria-label="Categories">${cats.map((k) => html`<button class="chip" aria-pressed="${k === cat}" data-cat="${k}">${k}</button>`)}</div>` : ''}
      ${!ready ? html`<section class="stack tight"><h2>Trending this week</h2><div class="rail">${skeletons(2, 146)}</div></section>
        <section class="stack tight"><h2>New from the group</h2><div class="grid">${skeletons(4)}</div></section>`
      : !list.length ? html`<div class="empty"><div class="glyph">${icon('film')}</div>
          <h2>${cat === 'All' ? 'No clips yet' : `Nothing in ${cat} yet`}</h2>
          <p>${cat === 'All' ? 'Paste a YouTube link or pick a video from your phone to make the first one.' : 'Make one and pick this category on the details step.'}</p>
          <a class="btn small" href="#/create">${icon('plus')}Make a clip</a></div>`
      : html`
        ${tr.items.length ? html`<section class="stack tight">
          <div class="sec-head"><h2>${tr.days === 7 ? 'Trending this week' : tr.days === 30 ? 'Trending this month' : 'Most loved'}</h2></div>
          <div class="rail">${tr.items.map((c) => card(c, true))}</div></section>` : ''}
        <section class="stack tight">
          <div class="sec-head"><h2>New from the group</h2><a href="#/search">See all</a></div>
          <div class="grid">${fresh.map((c) => card(c))}</div>
        </section>`}
    </main>`);
    $$('[data-cat]', root).forEach((b) => b.onclick = () => { cat = b.dataset.cat; draw(); });
  };
  draw();
  return db.on('clips', draw);
}

// ---------- Search ----------
function matches(c, words) {
  const hay = [c.title, c.category, c.uploaderName, ...(c.tags || [])].join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
function rank(c, q) {
  const t = c.title.toLowerCase();
  let s = 0;
  if (t === q) s += 100;
  if (t.startsWith(q)) s += 40;
  if (t.includes(q)) s += 20;
  if ((c.tags || []).some((g) => g.toLowerCase() === q)) s += 30;
  return s + Math.min(score(c), 20);
}

export function search({ root, params }) {
  let q = params.get('q') || '';
  let cat = params.get('cat') || 'All';
  root.innerHTML = String(html`<main class="screen">
    <h1>Search</h1>
    <form class="search" role="search" id="sf">${icon('search')}
      <label class="sr" for="q">Search clips</label>
      <input id="q" type="search" value="${q}" placeholder="Search clips, tags, people" autocomplete="off" enterkeyhint="search">
    </form>
    <div class="chips" role="group" aria-label="Categories" id="chips"></div>
    <div id="results"></div>
  </main>`);
  const input = $('#q', root);
  $('#sf', root).onsubmit = (e) => { e.preventDefault(); input.blur(); };
  const drawChips = () => {
    $('#chips', root).innerHTML = String(html`${['All', ...CATEGORIES].map((k) => html`<button class="chip" aria-pressed="${k === cat}" data-cat="${k}">${k}</button>`)}`);
    $$('[data-cat]', root).forEach((b) => b.onclick = () => { cat = b.dataset.cat; drawChips(); drawResults(); syncUrl(); });
  };
  const syncUrl = () => {
    const p = new URLSearchParams(); if (q) p.set('q', q); if (cat !== 'All') p.set('cat', cat);
    history.replaceState(null, '', '#/search' + (p.toString() ? '?' + p : ''));
  };
  const drawResults = () => {
    const out = $('#results', root);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let list = allClips().filter((c) => (cat === 'All' || c.category === cat) && matches(c, words));
    const ql = q.trim().toLowerCase();
    list = ql ? list.sort((a, b) => rank(b, ql) - rank(a, ql) || b.createdAt - a.createdAt) : newest(list);
    if (!db.state.ready && !db.state.clips.size) { out.innerHTML = String(html`<div class="grid">${skeletons(6)}</div>`); return; }
    if (!list.length) {
      out.innerHTML = String(html`<div class="empty"><div class="glyph">${icon('search')}</div>
        <h2>${q ? `No clips match “${q}”` : `Nothing in ${cat} yet`}</h2>
        <p>Try fewer words or another category. Or make the clip yourself.</p>
        <div class="btn-row" style="width:100%;max-width:340px">${q || cat !== 'All' ? html`<button class="btn ghost small" id="clear">Clear search</button>` : ''}<a class="btn small" href="#/create">${icon('plus')}Make it</a></div></div>`);
      const cl = $('#clear', out); if (cl) cl.onclick = () => { q = ''; cat = 'All'; input.value = ''; drawChips(); drawResults(); syncUrl(); };
      return;
    }
    const tags = !q ? topTags() : [];
    out.innerHTML = String(html`
      ${tags.length ? html`<section class="stack tight" style="margin-bottom:18px"><h3>Popular tags</h3><div class="tags">${tags.map((t) => html`<button class="tag" data-tag="${t}">#${t}</button>`)}</div></section>` : ''}
      <p class="muted small" style="margin:0 0 10px">${list.length} ${list.length === 1 ? 'clip' : 'clips'}</p>
      <div class="grid">${list.slice(0, 120).map((c) => card(c))}</div>`);
    $$('[data-tag]', out).forEach((b) => b.onclick = () => { q = b.dataset.tag; input.value = q; drawResults(); syncUrl(); });
  };
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = input.value; drawResults(); syncUrl(); }, 120); });
  drawChips(); drawResults();
  if (!q) setTimeout(() => input.focus(), 50);
  return db.on('clips', drawResults);
}
function topTags() {
  const n = new Map();
  allClips().forEach((c) => (c.tags || []).forEach((t) => n.set(t, (n.get(t) || 0) + 1)));
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map((x) => x[0]);
}

// ---------- Clip detail ----------
const safeName = (s) => (s || 'clip').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'clip';

export function clip({ root, match }) {
  const id = match[1];
  let blobP = null, blob = null, offs = [];
  const getBlob = (c) => {
    if (!blobP) blobP = fetch(c.videoUrl, { mode: 'cors' }).then((r) => { if (!r.ok) throw new Error('fetch ' + r.status); return r.blob(); })
      .then((b) => (blob = b)).catch((e) => { blobP = null; throw e; });
    return blobP;
  };
  const draw = () => {
    const c = db.state.clips.get(id);
    if (!c) {
      root.innerHTML = String(html`<main class="screen"><div class="top-row">${backBtn()}</div>
        ${db.state.ready ? html`<div class="empty"><div class="glyph">${icon('film')}</div><h2>This clip is gone</h2><p>It may have been deleted by the person who made it.</p><a class="btn small" href="#/home">Go home</a></div>`
          : html`<div class="player skeleton"></div>`}</main>`);
      return;
    }
    const tall = c.height > c.width;
    const fav = db.isFav(c.id);
    root.innerHTML = String(html`<main class="screen">
      <div class="top-row">${backBtn()}<span class="grow"></span>
        ${db.canDelete(c) ? html`<button class="sq-btn" id="more" aria-label="Edit or delete" title="Edit or delete">${icon('edit')}</button>` : ''}</div>
      <div class="player ${tall ? 'tall' : ''}" ${c.width && c.height ? raw(`style="aspect-ratio:${c.width}/${c.height}"`) : ''}>
        <video id="v" src="${c.videoUrl}" ${c.thumbUrl ? html`poster="${c.thumbUrl}"` : ''} controls playsinline loop preload="auto" crossorigin="anonymous"></video>
      </div>
      <div class="stack tight">
        <h1 style="font-size:30px;overflow-wrap:anywhere">${c.title}</h1>
        <p class="muted" style="margin:0">by ${c.uploaderName} · ${ago(c.createdAt)} · ${fmtDur(c.duration)} · ${c.category}${c.scope === 'personal' ? ' · only you can see this' : ''}</p>
        ${c.tags.length ? html`<div class="tags">${c.tags.map((t) => html`<a class="tag" href="#/search?q=${encodeURIComponent(t)}">#${t}</a>`)}</div>` : ''}
      </div>
      <div class="actions">
        <button class="act primary" id="share">${icon('share')}Share</button>
        <button class="act" id="dl">${icon('download')}Save</button>
        <button class="act" id="fav" aria-pressed="${fav}">${icon('heart')}${fav ? 'Loved' : 'Love'}</button>
        <button class="act" id="fold">${icon('folder')}Folder</button>
      </div>
      <p class="muted small" style="margin:0">${c.views} ${c.views === 1 ? 'view' : 'views'} · ${c.favCount} ${c.favCount === 1 ? 'love' : 'loves'} · ${c.shares} ${c.shares === 1 ? 'share' : 'shares'}</p>
      <button class="btn ghost small" id="copy" style="align-self:flex-start">${icon('link')}Copy video link</button>
    </main>`);
    const v = $('#v', root);
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    $('#share', root).onclick = () => share(c);
    $('#dl', root).onclick = () => download(c);
    $('#fav', root).onclick = async () => {
      try { const now = await db.toggleFav(c); toast(now ? 'Added to favourites' : 'Removed from favourites'); } catch (e) { toast(db.friendlyError(e)); }
    };
    $('#fold', root).onclick = () => folderSheet(c);
    $('#copy', root).onclick = () => copyText(c.videoUrl);
    const more = $('#more', root); if (more) more.onclick = () => manageSheet(c);
  };

  async function share(c) {
    const name = safeName(c.title) + '.mp4';
    const done = () => db.countShare(c);
    if (blob) {
      const file = new File([blob], name, { type: 'video/mp4' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: c.title }); done(); }
        catch (e) { if (e.name === 'NotAllowedError') toast('Ready now. Tap Share again.'); }
        return;
      }
    }
    if (!blob && navigator.canShare) {
      toast('Getting the video ready…', 8000);
      try { await getBlob(c); toast('Ready. Tap Share again.'); } catch { shareLink(c); }
      return;
    }
    shareLink(c);
  }
  async function shareLink(c) {
    if (navigator.share) { try { await navigator.share({ title: c.title, url: c.videoUrl }); db.countShare(c); } catch {} }
    else copyText(c.videoUrl);
  }
  async function download(c) {
    try {
      toast('Saving…');
      const b = await getBlob(c);
      const url = URL.createObjectURL(b);
      const a = document.createElement('a'); a.href = url; a.download = safeName(c.title) + '.mp4';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast(/iPhone|iPad/.test(navigator.userAgent) ? 'Saved to Files. To put it in Photos, use Share then Save Video.' : 'Saved to your downloads');
    } catch { window.open(c.videoUrl, '_blank', 'noopener'); }
  }

  draw();
  const c0 = db.state.clips.get(id);
  if (c0) { db.countView(c0); getBlob(c0).catch(() => {}); }
  // Redraw only when this clip's info or favourites change, without restarting the video.
  let lastKey = '';
  const keyOf = () => { const c = db.state.clips.get(id); return c ? [c.title, c.tags.join(), c.category, c.favCount, c.views, c.shares, db.isFav(id)].join('|') : 'none'; };
  lastKey = keyOf();
  const maybe = () => {
    const k = keyOf(); if (k === lastKey) return; lastKey = k;
    const v = $('#v', root);
    if (v && db.state.clips.get(id)) { updateStats(); return; }
    draw();
    const c = db.state.clips.get(id); if (c) { db.countView(c); getBlob(c).catch(() => {}); }
  };
  function updateStats() {
    const c = db.state.clips.get(id), fav = db.isFav(id);
    const f = $('#fav', root); if (f) { f.setAttribute('aria-pressed', fav); f.innerHTML = String(html`${icon('heart')}${fav ? 'Loved' : 'Love'}`); }
    const p = $('.actions + p', root); if (p) p.textContent = `${c.views} ${c.views === 1 ? 'view' : 'views'} · ${c.favCount} ${c.favCount === 1 ? 'love' : 'loves'} · ${c.shares} ${c.shares === 1 ? 'share' : 'shares'}`;
    const h = $('h1', root); if (h) h.textContent = c.title;
  }
  offs.push(db.on('clips', maybe), db.on('profile', maybe));
  return () => offs.forEach((o) => o());
}

export function folderSheet(c) {
  sheet('Add to folder', html`<div id="fl"></div>
    <form class="top-row" id="nf" style="gap:8px"><label class="sr" for="fname">New folder name</label>
      <input class="input grow" id="fname" placeholder="New folder name" maxlength="40" autocomplete="off">
      <button class="btn small" type="submit">Create</button></form>`, (el, close) => {
    const draw = () => {
      const fs = db.state.folders;
      $('#fl', el).innerHTML = String(fs.length ? html`<ul class="list">${fs.map((f) => {
        const inside = f.clipIds.includes(c.id);
        return html`<li><button class="row" data-f="${f.id}" aria-pressed="${inside}"><span class="icon-box">${icon(inside ? 'check' : 'folder')}</span>
          <span class="grow"><b>${f.name}</b><span>${f.clipIds.length} ${f.clipIds.length === 1 ? 'clip' : 'clips'}</span></span>
          ${inside ? html`<span class="pill neon">Added</span>` : ''}</button></li>`;
      })}</ul>` : html`<p class="muted" style="margin:0">You have no folders yet. Name one below to start.</p>`);
      $$('[data-f]', el).forEach((b) => b.onclick = async () => {
        const inside = b.getAttribute('aria-pressed') === 'true';
        try { await db.setInFolder(b.dataset.f, c.id, !inside); } catch (e) { toast(db.friendlyError(e)); }
      });
    };
    draw();
    const off = db.on('folders', draw);
    const obs = new MutationObserver(() => { if (!document.body.contains(el)) { off(); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
    $('#nf', el).onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#fname', el).value.trim();
      if (!name) { $('#fname', el).focus(); return; }
      try { const fid = await db.createFolder(name); await db.setInFolder(fid, c.id, true); $('#fname', el).value = ''; toast(`Added to ${name}`); }
      catch (err) { toast(db.friendlyError(err)); }
    };
  });
}

export function detailsFields(v = {}) {
  return html`
    <div class="field"><label for="d-title">Name</label>
      <input class="input" id="d-title" maxlength="60" value="${v.title || ''}" placeholder="What people will search for" required autocomplete="off"></div>
    <div class="field"><label for="d-tags">Tags</label>
      <input class="input" id="d-tags" value="${(v.tags || []).join(', ')}" placeholder="funny, reaction, no way" autocomplete="off" autocapitalize="none">
      <span class="hint">Separate tags with commas.</span></div>
    <div class="field"><label for="d-cat">Category</label>
      <select class="input" id="d-cat">${CATEGORIES.map((k) => html`<option ${k === (v.category || 'Reactions') ? html`selected` : ''}>${k}</option>`)}</select></div>`;
}
export function readDetails(el) {
  const title = $('#d-title', el).value.trim().slice(0, 60);
  const tags = [...new Set($('#d-tags', el).value.split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 12).map((t) => t.slice(0, 24));
  return { title, tags, category: $('#d-cat', el).value };
}

function manageSheet(c) {
  sheet('Edit clip', html`<form class="stack" id="ef">${detailsFields(c)}<p class="err" id="eerr"></p>
    <button class="btn" type="submit">Save changes</button></form>
    <button class="btn danger" id="del">${icon('trash')}Delete clip</button>`, (el, close) => {
    $('#ef', el).onsubmit = async (e) => {
      e.preventDefault();
      const d = readDetails(el);
      if (!d.title) { $('#eerr', el).textContent = 'Give the clip a name.'; return; }
      try { await db.editClip(c, d); close(); toast('Saved'); } catch (err) { $('#eerr', el).textContent = db.friendlyError(err); }
    };
    $('#del', el).onclick = async () => {
      close();
      const ok = await confirmSheet({ title: `Delete “${c.title}”?`, body: 'It disappears for everyone, including from their favourites and folders. This cannot be undone.', confirm: 'Delete clip' });
      if (!ok) return;
      try { await db.deleteClip(c); toast('Clip deleted'); location.hash = '#/home'; } catch (err) { toast(db.friendlyError(err)); }
    };
  });
}

// ---------- Library ----------
export function library({ root }) {
  const draw = () => {
    const favs = (db.state.profile.favs || []).filter((id) => db.state.clips.has(id));
    const mine = allClips().filter((c) => c.uploaderUid === db.state.user.uid);
    const fs = db.state.folders;
    root.innerHTML = String(html`<main class="screen">
      <h1>Library</h1>
      <ul class="list">
        <li><a class="row" href="#/library/favs"><span class="icon-box">${icon('heart')}</span><span class="grow"><b>Favourites</b><span>${favs.length} ${favs.length === 1 ? 'clip' : 'clips'}</span></span>${icon('chev', 'chev')}</a></li>
        <li><a class="row" href="#/library/mine"><span class="icon-box">${icon('film')}</span><span class="grow"><b>My uploads</b><span>${mine.length} ${mine.length === 1 ? 'clip' : 'clips'}, including ones only you can see</span></span>${icon('chev', 'chev')}</a></li>
        <li><a class="row" href="#/jobs"><span class="icon-box">${icon('clock')}</span><span class="grow"><b>Clips in progress</b><span>Ones the robot is still making</span></span>${icon('chev', 'chev')}</a></li>
      </ul>
      <div class="sec-head"><h2>Folders</h2></div>
      ${fs.length ? html`<ul class="list">${fs.map((f) => html`<li><a class="row" href="#/folder/${f.id}"><span class="icon-box">${icon('folder')}</span>
        <span class="grow"><b>${f.name}</b><span>${countIn(f)} ${countIn(f) === 1 ? 'clip' : 'clips'}</span></span>${icon('chev', 'chev')}</a></li>`)}</ul>`
        : html`<p class="muted" style="margin:0">Folders keep your go-to clips together, like "Monday mood" or "Wins". Only you see your folders.</p>`}
      <button class="dashed" id="nf">${icon('plus', '', 'width:18px;height:18px')}New folder</button>
    </main>`);
    $('#nf', root).onclick = () => newFolderSheet();
  };
  draw();
  const a = db.on('clips', draw), b = db.on('folders', draw), c = db.on('profile', draw);
  return () => { a(); b(); c(); };
}
const countIn = (f) => f.clipIds.filter((id) => db.state.clips.has(id)).length;

function newFolderSheet(onDone) {
  sheet('New folder', html`<form class="stack" id="f"><div class="field"><label for="fn">Folder name</label><input class="input" id="fn" maxlength="40" autocomplete="off" required></div>
    <p class="err" id="ferr"></p><button class="btn" type="submit">Create folder</button></form>`, (el, close) => {
    $('#f', el).onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#fn', el).value.trim();
      if (!name) { $('#ferr', el).textContent = 'Give the folder a name.'; return; }
      try { const id = await db.createFolder(name); close(); if (onDone) onDone(id); else location.hash = '#/folder/' + id; }
      catch (err) { $('#ferr', el).textContent = db.friendlyError(err); }
    };
  });
}

export function libraryList({ root, match }) {
  const kind = match[1];
  const draw = () => {
    const list = kind === 'favs'
      ? (db.state.profile.favs || []).map((id) => db.state.clips.get(id)).filter(Boolean).reverse()
      : newest(allClips().filter((c) => c.uploaderUid === db.state.user.uid));
    root.innerHTML = String(html`<main class="screen">
      <div class="top-row">${backBtn('#/library')}<h1 class="grow" style="font-size:28px">${kind === 'favs' ? 'Favourites' : 'My uploads'}</h1></div>
      ${list.length ? html`<div class="grid">${list.map((c) => card(c))}</div>`
        : html`<div class="empty"><div class="glyph">${icon(kind === 'favs' ? 'heart' : 'film')}</div>
          <h2>${kind === 'favs' ? 'No favourites yet' : 'You have not made a clip yet'}</h2>
          <p>${kind === 'favs' ? 'Open any clip and tap Love to keep it here.' : 'Paste a YouTube link or pick a video from your phone.'}</p>
          <a class="btn small" href="${kind === 'favs' ? '#/home' : '#/create'}">${kind === 'favs' ? 'Browse clips' : html`${icon('plus')}Make a clip`}</a></div>`}
    </main>`);
  };
  draw();
  const a = db.on('clips', draw), b = db.on('profile', draw);
  return () => { a(); b(); };
}

export function folder({ root, match }) {
  const id = match[1];
  const draw = () => {
    const f = db.state.folders.find((x) => x.id === id);
    if (!f) {
      root.innerHTML = String(html`<main class="screen"><div class="top-row">${backBtn('#/library')}</div>
        <div class="empty"><div class="glyph">${icon('folder')}</div><h2>Folder not found</h2><p>It may have been deleted.</p><a class="btn small" href="#/library">Back to Library</a></div></main>`);
      return;
    }
    const list = f.clipIds.map((cid) => db.state.clips.get(cid)).filter(Boolean).reverse();
    root.innerHTML = String(html`<main class="screen">
      <div class="top-row">${backBtn('#/library')}<h1 class="grow" style="font-size:28px;overflow-wrap:anywhere">${f.name}</h1>
        <button class="sq-btn" id="ren" aria-label="Rename folder" title="Rename folder">${icon('edit')}</button>
        <button class="sq-btn" id="delf" aria-label="Delete folder" title="Delete folder">${icon('trash')}</button></div>
      ${list.length ? html`<div class="grid">${list.map((c) => card(c))}</div>`
        : html`<div class="empty"><div class="glyph">${icon('folder')}</div><h2>This folder is empty</h2>
          <p>Open any clip and tap Folder to add it here.</p><a class="btn small" href="#/home">Browse clips</a></div>`}
    </main>`);
    $('#ren', root).onclick = () => sheet('Rename folder', html`<form class="stack" id="rf"><div class="field"><label for="rn">Folder name</label>
      <input class="input" id="rn" maxlength="40" value="${f.name}" required></div><button class="btn" type="submit">Save name</button></form>`, (el, close) => {
      $('#rf', el).onsubmit = async (e) => { e.preventDefault(); const n = $('#rn', el).value.trim(); if (!n) return; await db.renameFolder(id, n).catch((er) => toast(db.friendlyError(er))); close(); };
    });
    $('#delf', root).onclick = async () => {
      const ok = await confirmSheet({ title: `Delete the folder “${f.name}”?`, body: 'The clips stay in the app. Only this folder goes.', confirm: 'Delete folder' });
      if (!ok) return;
      await db.deleteFolder(id).catch((e) => toast(db.friendlyError(e)));
      location.hash = '#/library';
    };
  };
  draw();
  const a = db.on('clips', draw), b = db.on('folders', draw);
  return () => { a(); b(); };
}

// ---------- Me ----------
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

export function me({ root }) {
  const p = db.state.profile;
  const theme = THEMES.find((t) => t.id === p.theme) || THEMES[0];
  root.innerHTML = String(html`<main class="screen">
    <div class="top-row"><span class="icon-box" style="width:56px;height:56px;border-radius:18px;background:var(--neon);color:var(--on-neon);display:flex;align-items:center;justify-content:center;font:800 26px 'Bricolage Grotesque',sans-serif">${p.username.slice(0, 1).toUpperCase()}</span>
      <div class="grow"><h1 style="font-size:28px">${p.username}</h1><span class="muted small">${p.role === 'admin' ? 'Admin' : 'Member'}</span></div></div>
    <ul class="list">
      <li><a class="row" href="#/colours"><span class="icon-box">${icon('palette')}</span><span class="grow"><b>App colours</b><span>${theme.name}</span></span>${icon('chev', 'chev')}</a></li>
      <li><a class="row" href="#/jobs"><span class="icon-box">${icon('clock')}</span><span class="grow"><b>Clips in progress</b><span>Ones the robot is still making</span></span>${icon('chev', 'chev')}</a></li>
      ${db.isAdmin() ? html`<li><a class="row" href="#/admin"><span class="icon-box">${icon('shield')}</span><span class="grow"><b>Admin</b><span>Invites, members, the clip robot</span></span>${icon('chev', 'chev')}</a></li>` : ''}
      ${!isStandalone() ? html`<li><button class="row" id="inst"><span class="icon-box">${icon('phone')}</span><span class="grow"><b>Put it on your home screen</b><span>Opens like a normal app</span></span>${icon('chev', 'chev')}</button></li>` : ''}
      <li><button class="row" id="pw"><span class="icon-box">${icon('key')}</span><span class="grow"><b>Change password</b><span>You need your current one</span></span>${icon('chev', 'chev')}</button></li>
      <li><button class="row" id="out"><span class="icon-box">${icon('out')}</span><span class="grow"><b>Sign out</b><span>Of this phone</span></span></button></li>
    </ul>
    <p class="muted small" style="margin:0">Absolute Clipema · private, for friends only${(window.CLIPEMA_CONFIG || {}).build ? ` · version ${String(window.CLIPEMA_CONFIG.build).slice(0, 7)}` : ''}</p>
  </main>`);
  const inst = $('#inst', root);
  if (inst) inst.onclick = async () => {
    if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; return; }
    sheet('Put it on your home screen', isIOS()
      ? html`<ol class="stack tight" style="margin:0;padding-left:20px"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>`
      : html`<ol class="stack tight" style="margin:0;padding-left:20px"><li>Open this page in <b>Chrome</b>.</li><li>Tap the <b>⋮</b> menu at the top right.</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li></ol>`);
  };
  $('#pw', root).onclick = () => sheet('Change password', html`<form class="stack" id="cp">
      <input type="text" name="username" autocomplete="username" value="${p.username}" hidden>
      <div class="field"><label for="cur">Current password</label><input class="input" id="cur" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="nw">New password</label><input class="input" id="nw" type="password" autocomplete="new-password" required><span class="hint">At least 6 characters.</span></div>
      <p class="err" id="cperr"></p><button class="btn" type="submit">Change password</button></form>`, (el, close) => {
    $('#cp', el).onsubmit = async (e) => {
      e.preventDefault();
      const b = $('button[type=submit]', el); b.disabled = true;
      try { await db.changePassword($('#cur', el).value, $('#nw', el).value); close(); toast('Password changed'); }
      catch (err) { $('#cperr', el).textContent = err.message; b.disabled = false; }
    };
  });
  $('#out', root).onclick = async () => {
    const ok = await confirmSheet({ title: 'Sign out?', body: 'You will need your username and password to get back in.', confirm: 'Sign out', danger: false });
    if (ok) { await db.signOutNow(); location.hash = ''; }
  };
}

export function colours({ root }) {
  const cur = db.state.profile.theme || 'purple';
  root.innerHTML = String(html`<main class="screen">
    <div class="top-row">${backBtn('#/me')}</div>
    <div><h1>App colours</h1><p class="muted" style="margin:8px 0 0">Changes the look for you only. Friends keep their own pick.</p></div>
    <fieldset style="margin:0;padding:0;border:0" class="stack tight"><legend class="sr">Theme</legend>
      ${THEMES.map((t) => html`<label class="theme-opt">
        <input type="radio" name="theme" value="${t.id}" ${t.id === cur ? html`checked` : ''}>
        <span class="swatch" aria-hidden="true" style="background:${t.bg}"><span class="l1" style="background:${t.fg}"></span><span class="l2" style="background:${t.fg}"></span><span class="n" style="background:${t.neon};box-shadow:0 0 10px ${t.neon}"></span></span>
        <span class="grow" style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-weight:600">${t.name}</span><span class="muted small">${t.desc}</span></span>
        <span class="radio-dot" aria-hidden="true"></span>
      </label>`)}
    </fieldset>
  </main>`);
  $$('input[name=theme]', root).forEach((r) => r.addEventListener('change', () => {
    applyTheme(r.value);
    db.saveTheme(r.value).catch((e) => toast(db.friendlyError(e)));
  }));
}

// ---------- Jobs ----------
export async function jobs({ root }) {
  root.innerHTML = String(html`<main class="screen"><div class="top-row">${backBtn('#/me')}<h1 class="grow" style="font-size:28px">Clips in progress</h1></div><div id="jl"><div class="skeleton" style="height:64px;border-radius:16px"></div></div></main>`);
  const list = await db.myJobs();
  const label = { uploading: 'Uploading', queued: 'Waiting for the robot', working: 'Being made now', done: 'Done', failed: 'Did not work' };
  $('#jl', root).innerHTML = String(list.length ? html`<ul class="list">${list.map((j) => html`<li><a class="row" href="#/job/${j.id}">
      <span class="icon-box">${icon(j.status === 'done' ? 'check' : j.status === 'failed' ? 'alert' : 'clock')}</span>
      <span class="grow"><b>${j.title || 'Untitled'}</b><span>${label[j.status] || j.status} · ${ago(j.createdAt)}</span></span>${icon('chev', 'chev')}</a></li>`)}</ul>`
    : html`<div class="empty"><div class="glyph">${icon('clock')}</div><h2>Nothing in progress</h2><p>Clips you make show here while the robot works on them.</p><a class="btn small" href="#/create">${icon('plus')}Make a clip</a></div>`);
}

export { esc };
