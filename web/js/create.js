// Make a clip: pick a source, mark ranges, add details, then watch the robot make it.
import * as db from './db.js';
import { html, raw, icon, $, $$, toast, fmtTime, fmtSecs, parseTime, backBtn, confirmSheet } from './ui.js';
import { detailsFields, readDetails, card } from './views.js';

const MAX = db.MAX_CLIP_SECONDS;
const KEY = 'clipema-draft';
let galleryFile = null;      // the picked File (cannot be saved in sessionStorage)
let pendingGallery = null;   // { job, groups } waiting to be cut and uploaded

function load() { try { return JSON.parse(sessionStorage.getItem(KEY)) || null; } catch { return null; } }
function save(d) { try { sessionStorage.setItem(KEY, JSON.stringify(d)); } catch {} }
function clear() { try { sessionStorage.removeItem(KEY); } catch {} galleryFile = null; }

export function ytId(url) {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') return (u.pathname.slice(1).split('/')[0] || '').slice(0, 11) || null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v) return v.slice(0, 11);
      const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch {}
  return null;
}
function ytStart(url) {
  try {
    const t = new URL(url).searchParams.get('t') || '';
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    if (m) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  } catch {}
  return 0;
}
const siteName = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'that site'; } };

function steps(n) {
  const names = ['Source', 'Trim', 'Details'];
  return html`<ol class="steps" aria-label="Steps">${names.map((s, i) => html`<li class="${i + 1 < n ? 'done' : i + 1 === n ? 'on' : ''}" ${i + 1 === n ? html`aria-current="step"` : ''}>
    <b>${i + 1 < n ? icon('check', '', 'width:14px;height:14px;stroke-width:3') : i + 1}</b>${s}</li>`)}</ol>`;
}

// ---------- Step 1: source ----------
export function source({ root, params }) {
  const incoming = params.get('url') || '';
  root.innerHTML = String(html`<main class="screen">
    <div class="top-row"><h1 class="grow">Make a clip</h1></div>
    <form class="panel" id="lf">
      <div class="field"><label for="url">Paste a link</label>
        <div class="top-row" style="gap:8px"><input class="input grow" id="url" type="url" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="https://youtube.com/watch?v=…" value="${incoming}">
        ${navigator.clipboard && navigator.clipboard.readText ? html`<button type="button" class="btn ghost small" id="paste">Paste</button>` : ''}</div>
        <span class="hint">YouTube works best. Instagram, Threads, X and TikTok links can work too, but fail more often.</span></div>
      <p class="err" id="lerr" role="alert"></p>
      <button class="btn" type="submit">Next: pick the bits</button>
    </form>
    <div class="top-row" style="gap:12px"><span class="grow" style="height:1px;background:var(--line)"></span><span class="muted small">or</span><span class="grow" style="height:1px;background:var(--line)"></span></div>
    <label class="source-opt" for="file"><span class="icon-box">${icon('image')}</span>
      <span class="grow" style="display:flex;flex-direction:column;gap:2px"><b>Pick a video from your phone</b><span class="muted small">Your phone cuts it before uploading</span></span>${icon('chev', 'chev')}</label>
    <input type="file" id="file" accept="video/*" class="sr">
    ${db.isAdmin() ? html`<a class="source-opt" href="#/import"><span class="icon-box">${icon('copy')}</span>
      <span class="grow" style="display:flex;flex-direction:column;gap:2px"><b>Paste several links at once</b><span class="muted small">Up to 20, with names and tags filled in for you</span></span>${icon('chev', 'chev')}</a>` : ''}
    <p class="muted small" style="margin:0">Finished clips can be up to ${MAX} seconds long.</p>
  </main>`);
  const urlIn = $('#url', root), err = $('#lerr', root);
  urlIn.oninput = () => { err.textContent = ''; urlIn.removeAttribute('aria-invalid'); };
  const pb = $('#paste', root);
  if (pb) pb.onclick = async () => { try { urlIn.value = (await navigator.clipboard.readText()).trim(); urlIn.focus(); } catch { toast('Press and hold in the box to paste instead.'); } };
  $('#lf', root).onsubmit = (e) => {
    e.preventDefault();
    const raw = urlIn.value.trim();
    const m = raw.match(/https?:\/\/\S+/);
    if (!m) { err.textContent = 'Paste a full link that starts with https://'; urlIn.setAttribute('aria-invalid', 'true'); urlIn.focus(); return; }
    const url = m[0];
    const id = ytId(url);
    galleryFile = null;
    save({ source: id ? 'youtube' : 'link', url, videoId: id, start: ytStart(url), ranges: [], mode: 'join', details: {} });
    location.hash = '#/create/trim';
  };
  $('#file', root).onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    galleryFile = f;
    save({ source: 'gallery', fileName: f.name, ranges: [], mode: 'join', details: { title: f.name.replace(/\.[^.]+$/, '').slice(0, 60) } });
    location.hash = '#/create/trim';
  };
}

// ---------- Players ----------
let ytApi = null;
function loadYT() {
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { ytApi = null; reject(new Error('YouTube player did not load')); };
    document.head.appendChild(s);
  });
  return ytApi;
}
function ytPlayer(el, videoId, start) {
  let p;
  const ready = loadYT().then((YT) => new Promise((resolve, reject) => {
    p = new YT.Player(el, {
      videoId, playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(start || 0) },
      events: {
        onReady: () => resolve(),
        onError: (e) => reject(new Error(e.data === 101 || e.data === 150 ? 'This video cannot be played inside other apps, but the robot can usually still grab it. Type the times below instead.' : 'YouTube could not play this video. Check the link.')),
      },
    });
  }));
  return {
    ready,
    time: () => (p && p.getCurrentTime ? p.getCurrentTime() : 0),
    duration: () => (p && p.getDuration ? p.getDuration() : 0),
    seek: (t) => p && p.seekTo(t, true),
    play: () => p && p.playVideo(),
    pause: () => p && p.pauseVideo(),
    playing: () => !!(p && p.getPlayerState && p.getPlayerState() === 1),
    destroy: () => { try { p && p.destroy(); } catch {} },
  };
}
function filePlayer(video, file) {
  const url = URL.createObjectURL(file);
  video.src = url;
  const ready = new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Your phone could not open this video. Try a different one.'));
  });
  return {
    ready,
    time: () => video.currentTime,
    duration: () => video.duration || 0,
    seek: (t) => { video.currentTime = t; },
    play: () => video.play().catch(() => {}),
    pause: () => video.pause(),
    playing: () => !video.paused,
    destroy: () => { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); },
  };
}

// ---------- Step 2: trim ----------
export function trim({ root }) {
  const d = load();
  if (!d || (d.source === 'gallery' && !galleryFile)) { location.hash = '#/create'; return; }
  if (d.source === 'link') return manualTrim(root, d);

  let sel = d.ranges.length ? 0 : -1;
  let player = null, stopAt = null, timer = null, manual = false;
  root.innerHTML = String(html`<main class="screen no-nav">
    <div class="top-row">${backBtn('#/create')}<span class="grow"></span>${steps(2)}</div>
    <div class="yt-wrap" id="pw">${d.source === 'gallery' ? html`<video id="vid" playsinline preload="auto"></video>` : html`<div id="yt"></div>`}<span class="time" id="now">0:00.0</span></div>
    <p class="err" id="perr" role="alert"></p>
    <div class="stack tight">
      <div class="track" id="track" role="slider" tabindex="0" aria-label="Video timeline" aria-valuemin="0" aria-valuenow="0"></div>
      <div class="track-scale" id="scale" aria-hidden="true"></div>
    </div>
    <div class="transport" role="group" aria-label="Playback">
      <button data-skip="-5" aria-label="Back 5 seconds">−5s</button>
      <button data-skip="-1" aria-label="Back 1 second">−1s</button>
      <button class="play" id="pp" aria-label="Play or pause">${icon('play')}</button>
      <button data-skip="1" aria-label="Forward 1 second">+1s</button>
      <button data-skip="5" aria-label="Forward 5 seconds">+5s</button>
    </div>
    <ul class="list" id="ranges" aria-label="Ranges"></ul>
    <div class="seg" role="radiogroup" aria-label="How to save the ranges" id="mode" hidden></div>
    <div class="stack tight" style="margin-top:auto">
      <p class="muted small" id="sum" style="margin:0;text-align:center"></p>
      <button class="btn" id="next">Next: add details</button>
    </div>
  </main>`);
  const now = $('#now', root), track = $('#track', root);

  const dur = () => (player && player.duration()) || d.duration || 0;
  const persist = () => { d.duration = dur(); save(d); };
  const clamp = (t) => Math.max(0, Math.min(dur() || 1e9, t));
  const outputs = () => (d.mode === 'join' || d.ranges.length < 2) ? [d.ranges] : d.ranges.map((r) => [r]);
  const len = (rs) => rs.reduce((s, r) => s + Math.max(0, r.e - r.s), 0);

  function drawTrack() {
    const D = dur() || 1;
    const t = player ? player.time() : 0;
    track.innerHTML = d.ranges.map((r, i) => `<div class="rng ${i === sel ? 'sel' : ''}" style="left:${(r.s / D) * 100}%;width:${((r.e - r.s) / D) * 100}%"><span class="n">${i + 1}</span></div>`).join('') +
      `<div class="head" style="left:calc(${(t / D) * 100}% - 1px)"></div>`;
    track.setAttribute('aria-valuemax', String(Math.round(D)));
    track.setAttribute('aria-valuenow', String(Math.round(t)));
    track.setAttribute('aria-valuetext', fmtTime(t));
    const marks = [0, 0.25, 0.5, 0.75, 1].map((f) => fmtTime(D * f, false));
    $('#scale', root).innerHTML = marks.map((m) => `<span>${m}</span>`).join('');
  }
  function drawRanges() {
    const ul = $('#ranges', root);
    ul.innerHTML = String(html`${d.ranges.map((r, i) => html`<li class="rrow ${i === sel ? 'sel' : ''}">
      <div class="top"><span class="num">${i + 1}</span>
        <button class="times" data-sel="${i}" aria-label="Range ${i + 1}, ${fmtTime(r.s)} to ${fmtTime(r.e)}. Tap to edit.">${fmtTime(r.s)} to ${fmtTime(r.e)} <span class="muted small">· ${fmtSecs(r.e - r.s)}</span></button>
        <button class="icon-btn" data-playr="${i}" aria-label="Play range ${i + 1}" title="Play this range">${icon('play')}</button>
        <button class="icon-btn" data-del="${i}" aria-label="Remove range ${i + 1}" title="Remove range">${icon('trash', '', 'width:20px;height:20px')}</button></div>
      ${i === sel ? html`${['s', 'e'].map((k) => html`<div class="edge" role="group" aria-label="${k === 's' ? 'Start' : 'End'} of range ${i + 1}">
          <span>${k === 's' ? 'Start' : 'End'}</span>
          <button data-nudge="${k}" data-by="-1">−1</button><button data-nudge="${k}" data-by="-0.1">−.1</button>
          <button data-nudge="${k}" data-by="0.1">+.1</button><button data-nudge="${k}" data-by="1">+1</button>
          <button class="set" data-set="${k}">Set here</button></div>`)}` : ''}
    </li>`)}
    <li><button class="dashed" id="add">${icon('plus', '', 'width:18px;height:18px')}${d.ranges.length ? 'Add another range at the playhead' : 'Add a range at the playhead'}</button></li>`);
    $('#add', ul).onclick = () => {
      const t = player ? player.time() : 0;
      const s = clamp(Math.round(t * 10) / 10);
      const e = clamp(s + 4);
      d.ranges.push({ s, e: e > s ? e : s + 0.5 }); sel = d.ranges.length - 1; changed();
    };
    $$('[data-sel]', ul).forEach((b) => b.onclick = () => { sel = +b.dataset.sel; player && player.seek(d.ranges[sel].s); changed(); });
    $$('[data-del]', ul).forEach((b) => b.onclick = () => { d.ranges.splice(+b.dataset.del, 1); sel = Math.min(sel, d.ranges.length - 1); changed(); });
    $$('[data-playr]', ul).forEach((b) => b.onclick = () => { const r = d.ranges[+b.dataset.playr]; sel = +b.dataset.playr; player.seek(r.s); player.play(); stopAt = r.e; changed(); });
    $$('[data-nudge]', ul).forEach((b) => b.onclick = () => {
      const r = d.ranges[sel], k = b.dataset.nudge;
      r[k] = Math.round(clamp(r[k] + Number(b.dataset.by)) * 10) / 10;
      if (r.e <= r.s) { if (k === 's') r.s = Math.max(0, r.e - 0.1); else r.e = r.s + 0.1; }
      player && player.seek(r[k]); changed();
    });
    $$('[data-set]', ul).forEach((b) => b.onclick = () => {
      const r = d.ranges[sel], k = b.dataset.set, t = Math.round(clamp(player.time()) * 10) / 10;
      r[k] = t;
      if (r.e <= r.s) { if (k === 's') r.e = clamp(r.s + 1); else r.s = Math.max(0, r.e - 1); }
      changed();
    });
  }
  function drawSummary() {
    const mode = $('#mode', root);
    mode.hidden = d.ranges.length < 2;
    if (d.ranges.length >= 2) {
      mode.innerHTML = String(html`<button role="radio" aria-checked="${d.mode === 'join'}" data-mode="join">Join into one clip</button>
        <button role="radio" aria-checked="${d.mode === 'split'}" data-mode="split">Save as ${d.ranges.length} clips</button>`);
      $$('[data-mode]', mode).forEach((b) => b.onclick = () => { d.mode = b.dataset.mode; changed(); });
    }
    const outs = outputs().filter((o) => o.length);
    const lens = outs.map(len);
    const sum = $('#sum', root), next = $('#next', root);
    const tooLong = lens.some((l) => l > MAX);
    if (!d.ranges.length) { sum.textContent = 'Play the video, pause where your clip starts, then tap Add a range.'; next.disabled = true; return; }
    next.disabled = tooLong;
    sum.textContent = tooLong
      ? `Too long: clips can be up to ${MAX} seconds. Shorten a range${d.ranges.length > 1 ? ' or save them as separate clips' : ''}.`
      : outs.length === 1 ? `One clip, ${fmtSecs(lens[0])} long` : `${outs.length} clips: ${lens.map(fmtSecs).join(', ')}`;
    sum.style.color = tooLong ? 'var(--danger)' : '';
  }
  function changed() { persist(); drawTrack(); drawRanges(); drawSummary(); }

  // Tap or drag the timeline to move the playhead.
  const seekFromEvent = (e) => {
    const rect = track.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    player && player.seek(clamp((x / rect.width) * dur()));
    drawTrack();
  };
  let dragging = false;
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); seekFromEvent(e); });
  track.addEventListener('pointermove', (e) => { if (dragging) seekFromEvent(e); });
  track.addEventListener('pointerup', () => { dragging = false; });
  track.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowRight') { player.seek(clamp(player.time() + step)); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { player.seek(clamp(player.time() - step)); e.preventDefault(); }
    drawTrack();
  });
  $$('[data-skip]', root).forEach((b) => b.onclick = () => { player && player.seek(clamp(player.time() + Number(b.dataset.skip))); drawTrack(); });
  $('#pp', root).onclick = () => { if (!player) return; stopAt = null; player.playing() ? player.pause() : player.play(); };
  $('#next', root).onclick = () => { persist(); location.hash = '#/create/details'; };

  const startTimer = () => {
    timer = setInterval(() => {
      if (!player) return;
      const t = player.time();
      now.textContent = fmtTime(t);
      if (stopAt != null && t >= stopAt) { player.pause(); stopAt = null; }
      $('#pp', root).innerHTML = String(icon(player.playing() ? 'pause' : 'play'));
      if (!dragging) drawTrack();
    }, 100);
  };

  if (d.source === 'gallery') player = filePlayer($('#vid', root), galleryFile);
  else player = ytPlayer($('#yt', root), d.videoId, d.start);
  player.ready.then(() => {
    changed(); startTimer();
    if (d.source === 'gallery' && !d.ranges.length && dur() <= MAX) { d.ranges.push({ s: 0, e: Math.round(dur() * 10) / 10 }); sel = 0; changed(); }
  }).catch((e) => {
    $('#perr', root).textContent = e.message;
    if (d.source === 'youtube') { manual = true; d.source = 'link'; save(d); setTimeout(() => { player.destroy(); manualTrim(root, d, e.message); }, 1200); }
  });
  changed();
  return () => { clearInterval(timer); if (player && !manual) player.destroy(); };
}

// For links we cannot preview (Instagram, X, …): type the times.
function manualTrim(root, d, why) {
  if (!d.ranges.length) d.ranges.push({ s: 0, e: 5 });
  const draw = () => {
    root.innerHTML = String(html`<main class="screen no-nav">
      <div class="top-row">${backBtn('#/create')}<span class="grow"></span>${steps(2)}</div>
      <div class="panel">
        <h3>${d.videoId ? 'Type the times' : `Clip from ${siteName(d.url)}`}</h3>
        <p class="muted small" style="margin:0">${why || 'This site cannot be previewed here.'} Open the video in another app to find the moments you want, then type the start and end of each part, like 0:24.5 or 1:02.</p>
        <a href="${d.url}" target="_blank" rel="noopener" class="small">Open the video</a>
      </div>
      <ul class="list" id="ranges">${d.ranges.map((r, i) => html`<li class="rrow sel"><div class="top"><span class="num">${i + 1}</span><span class="grow"></span>
        ${d.ranges.length > 1 ? html`<button class="icon-btn" data-del="${i}" aria-label="Remove range ${i + 1}">${icon('trash')}</button>` : ''}</div>
        <div class="time-inputs">
          <div class="field"><label for="s${i}">Start</label><input class="input" id="s${i}" data-i="${i}" data-k="s" value="${fmtTime(r.s)}" inputmode="decimal" autocomplete="off"></div>
          <div class="field"><label for="e${i}">End</label><input class="input" id="e${i}" data-i="${i}" data-k="e" value="${fmtTime(r.e)}" inputmode="decimal" autocomplete="off"></div>
        </div></li>`)}
        <li><button class="dashed" id="add">${icon('plus', '', 'width:18px;height:18px')}Add another part</button></li></ul>
      ${d.ranges.length > 1 ? html`<div class="seg" role="radiogroup" aria-label="How to save the parts">
        <button role="radio" aria-checked="${d.mode === 'join'}" data-mode="join">Join into one clip</button>
        <button role="radio" aria-checked="${d.mode === 'split'}" data-mode="split">Save as ${d.ranges.length} clips</button></div>` : ''}
      <div class="stack tight" style="margin-top:auto"><p class="err" id="terr" role="alert"></p>
        <button class="btn" id="next">Next: add details</button></div>
    </main>`);
    $$('input[data-k]', root).forEach((inp) => inp.onchange = () => {
      const v = parseTime(inp.value);
      if (isFinite(v)) { d.ranges[+inp.dataset.i][inp.dataset.k] = v; inp.removeAttribute('aria-invalid'); save(d); }
      else inp.setAttribute('aria-invalid', 'true');
    });
    $('#add', root).onclick = () => { const last = d.ranges[d.ranges.length - 1]; d.ranges.push({ s: last.e, e: last.e + 3 }); save(d); draw(); };
    $$('[data-del]', root).forEach((b) => b.onclick = () => { d.ranges.splice(+b.dataset.del, 1); save(d); draw(); });
    $$('[data-mode]', root).forEach((b) => b.onclick = () => { d.mode = b.dataset.mode; save(d); draw(); });
    $('#next', root).onclick = () => {
      $$('input[data-k]', root).forEach((inp) => inp.onchange());
      const err = $('#terr', root);
      const bad = d.ranges.findIndex((r) => !(isFinite(r.s) && isFinite(r.e) && r.e - r.s >= 0.3));
      if (bad >= 0) { err.textContent = `Part ${bad + 1}: the end needs to be after the start.`; return; }
      const outs = (d.mode === 'join' || d.ranges.length < 2) ? [d.ranges] : d.ranges.map((r) => [r]);
      if (outs.some((o) => o.reduce((s, r) => s + r.e - r.s, 0) > MAX)) { err.textContent = `Clips can be up to ${MAX} seconds. Shorten a part.`; return; }
      save(d); location.hash = '#/create/details';
    };
  };
  draw();
}

// ---------- Step 3: details ----------
export function details({ root }) {
  const d = load();
  if (!d || !d.ranges.length || (d.source === 'gallery' && !galleryFile)) { location.hash = '#/create'; return; }
  const outs = (d.mode === 'join' || d.ranges.length < 2) ? 1 : d.ranges.length;
  const vis = d.details.visibility || 'group';
  root.innerHTML = String(html`<main class="screen no-nav">
    <div class="top-row">${backBtn('#/create/trim')}<span class="grow"></span>${steps(3)}</div>
    <form class="stack" id="df">
      ${detailsFields(d.details)}
      ${outs > 1 ? html`<p class="hint" style="margin-top:-10px">You are making ${outs} clips. They will be named “Name 1”, “Name 2” and so on.</p>` : ''}
      <div class="field"><span class="lbl" id="vis-l">Who can see it</span>
        <div class="seg" role="radiogroup" aria-labelledby="vis-l" id="vis">
          <button type="button" role="radio" aria-checked="${vis === 'group'}" data-vis="group">The whole group</button>
          <button type="button" role="radio" aria-checked="${vis === 'personal'}" data-vis="personal">Only me</button>
        </div></div>
      <p class="err" id="derr" role="alert"></p>
      <button class="btn" type="submit">${icon('scissors')}${outs > 1 ? `Make ${outs} clips` : 'Make the clip'}</button>
    </form>
  </main>`);
  let visibility = vis;
  $$('[data-vis]', root).forEach((b) => b.onclick = () => {
    visibility = b.dataset.vis;
    $$('[data-vis]', root).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  });
  const form = $('#df', root);
  form.oninput = () => { d.details = { ...readDetails(root), visibility }; save(d); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const det = readDetails(root);
    const err = $('#derr', root);
    if (!det.title) { err.textContent = 'Give the clip a name so friends can find it.'; $('#d-title', root).focus(); return; }
    const btn = $('button[type=submit]', form); btn.disabled = true;
    const job = { ...det, visibility, ranges: d.ranges.map((r) => ({ s: +r.s.toFixed(2), e: +r.e.toFixed(2) })), mode: outs > 1 ? 'split' : 'join' };
    try {
      if (d.source === 'gallery') {
        const groups = job.mode === 'split' ? job.ranges.map((r) => [r]) : [job.ranges];
        pendingGallery = { job, groups, file: galleryFile };
        clear();
        location.hash = '#/job/local';
      } else {
        const id = await db.createLinkJob({ ...job, type: d.source === 'youtube' ? 'youtube' : 'link', url: d.url });
        clear();
        location.hash = '#/job/' + id;
      }
    } catch (ex) { err.textContent = db.friendlyError(ex); btn.disabled = false; }
  };
}

// ---------- Step 4: progress ----------
const STAGES = [
  ['saved', 'Request saved'],
  ['queued', 'Waiting for the robot to start'],
  ['working', 'Robot is grabbing and cutting'],
  ['done', 'Clip ready'],
];
const GALLERY_STAGES = [
  ['cutting', 'Cutting on your phone'],
  ['uploading', 'Uploading'],
  ['queued', 'Waiting for the robot'],
  ['working', 'Robot is saving it'],
  ['done', 'Clip ready'],
];

function friendlyFail(msg = '') {
  if (/sign in to confirm|not a bot|cookies/i.test(msg)) return 'YouTube asked the robot to prove it is not a bot. Try again in a little while. If it keeps happening, Aman needs to refresh the YouTube cookies (setup guide, “If YouTube clips stop working”).';
  if (/private|unavailable|removed|copyright|members-only|age/i.test(msg)) return 'That video is private, age restricted or has been removed, so it cannot be grabbed.';
  if (/unsupported url/i.test(msg)) return 'That site is not supported. Try a YouTube link, or save the video to your phone and pick it from your gallery.';
  if (/login|log in|rate|429/i.test(msg)) return 'That site wants a login or is limiting downloads. Save the video to your phone and pick it from your gallery instead.';
  return msg || 'Something went wrong while making the clip.';
}

export function progress({ root, match }) {
  const id = match[1];
  let unsub = null, gone = false;
  const gallery = id === 'local' || false;
  let isGallery = gallery;

  const draw = (job, extra = {}) => {
    const status = extra.stage || (job && job.status) || 'queued';
    const failed = status === 'failed';
    const done = status === 'done';
    const list = isGallery ? GALLERY_STAGES : STAGES;
    const idx = list.findIndex(([k]) => k === status);
    const results = done && job && job.resultClipIds ? job.resultClipIds.map((cid) => db.state.clips.get(cid)).filter(Boolean) : [];
    root.innerHTML = String(html`<main class="screen no-nav">
      <div class="top-row">${backBtn('#/home')}<span class="grow"></span></div>
      ${failed ? html`<div class="empty" style="padding-top:12px"><div class="glyph" style="color:var(--danger)">${icon('alert')}</div>
          <h1 style="font-size:30px">That clip did not work</h1>
          <p>${friendlyFail(job && job.error)}</p></div>
          <div class="stack tight">
            ${job && job.type !== 'gallery' ? html`<button class="btn" id="retry">${icon('refresh')}Try again</button>` : ''}
            <a class="btn ghost" href="#/create">${icon('image')}Make it from your gallery instead</a>
            <button class="btn danger" id="drop">Delete this attempt</button>
          </div>`
      : html`<div class="stack tight"><h1 style="font-size:30px">${done ? (results.length > 1 ? 'Your clips are ready' : 'Your clip is ready') : 'Making your clip'}</h1>
          <p class="muted" style="margin:0">${(job && job.title) || (extra.title) || ''}</p></div>
        <ul class="status-list">${list.map(([k, label], i) => html`<li class="${i < idx || done ? 'done' : i === idx ? 'on' : ''}"><span class="ck">${i < idx || done ? icon('check', '', 'width:14px;height:14px;stroke-width:3') : ''}</span>${label}</li>`)}</ul>
        ${!done ? html`<div class="progress ${extra.pct == null ? 'indeterminate' : ''}"><i style="width:${Math.round((extra.pct || 0) * 100)}%"></i></div>
          <p class="muted small" style="margin:0" id="note">${extra.note || (status === 'queued' ? 'The robot usually starts within a minute. If the quick start key is not set up it can take up to 10 minutes. You can leave this screen; the clip will appear on Home when it is ready.' : status === 'working' ? 'Grabbing just the bits you picked. This usually takes under a minute.' : '')}</p>` : ''}
        ${done ? html`${results.length ? html`<div class="grid">${results.map((c) => card(c))}</div>` : html`<p class="muted">Loading the clip…</p>`}
          <div class="btn-row">${results.length === 1 ? html`<a class="btn" href="#/clip/${results[0].id}">Open the clip</a>` : ''}<a class="btn ghost" href="#/create">Make another</a></div>` : ''}`}
    </main>`);
    const r = $('#retry', root);
    if (r) r.onclick = async () => { r.disabled = true; try { const nid = await db.retryJob(id); location.hash = '#/job/' + nid; } catch (e) { toast(db.friendlyError(e)); r.disabled = false; } };
    const dr = $('#drop', root);
    if (dr) dr.onclick = async () => { await db.deleteJob(id).catch(() => {}); location.hash = '#/create'; };
  };

  if (id === 'local') {
    const p = pendingGallery;
    if (!p) { location.hash = '#/jobs'; return; }
    pendingGallery = null;
    (async () => {
      const { cut } = await import('./clipper.js');
      let stage = 'cutting';
      draw(null, { stage, pct: 0, title: p.job.title, note: 'Keep this screen open while your phone cuts the video.' });
      const setPct = (pct) => { const i = $('.progress > i', root); if (i) { i.parentElement.classList.remove('indeterminate'); i.style.width = Math.round(pct * 100) + '%'; } };
      const setNote = (t) => { const n = $('#note', root); if (n) n.textContent = t; };
      try {
        const outputs = await cut(p.file, p.groups, { onStage: (t) => setNote(t + ' Keep this screen open.'), onProgress: setPct });
        if (gone) return;
        const size = outputs.reduce((s, o) => s + o.bytes.length, 0);
        if (size > 60 * 1024 * 1024) throw new Error('The cut clip is too big to upload. Try a shorter range.');
        draw(null, { stage: 'uploading', pct: 0, title: p.job.title, note: 'Uploading. Keep this screen open.' });
        const names = outputs.length > 1 ? outputs.map((_, i) => `${p.job.title} ${i + 1}`) : [p.job.title];
        const jobId = await db.createUploadJob(p.job, outputs.map((o, i) => ({ ...o, title: names[i] })), (pct) => setPct(pct));
        history.replaceState(null, '', '#/job/' + jobId);
        watch(jobId);
      } catch (e) {
        console.error(e);
        draw({ status: 'failed', type: 'gallery', error: e.message || String(e) });
      }
    })();
  } else {
    watch(id);
  }

  function watch(jobId) {
    let last = null;
    const u1 = db.watchJob(jobId, (job) => {
      last = job;
      if (!job) {
        root.innerHTML = String(html`<main class="screen"><div class="top-row">${backBtn('#/jobs')}</div><div class="empty"><div class="glyph">${icon('clock')}</div><h2>This clip request is gone</h2><p>It may have been finished and cleaned up. Check My uploads.</p><a class="btn small" href="#/library/mine">My uploads</a></div></main>`);
        return;
      }
      if (job.type === 'lookup') { location.hash = '#/import?job=' + job.id; return; }
      isGallery = job.type === 'gallery';
      draw(job);
    });
    // The finished clip can arrive a moment after the job says done, so redraw when clips change.
    const u2 = db.on('clips', () => { if (last && last.status === 'done') draw(last); });
    unsub = () => { u1(); u2(); };
  }

  return () => { gone = true; if (unsub) unsub(); };
}

export { clear as clearDraft };
