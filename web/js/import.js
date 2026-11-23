// Admin bulk import: paste up to 20 links, check the titles and tags the robot found, then import.
import * as db from './db.js';
import { html, icon, $, $$, toast, backBtn } from './ui.js';
import { CATEGORIES } from './themes.js';
import { makeTabs } from './create.js';
import { sourceKey } from './sourcekey.js';

const KEY = 'clipema-import-job';
const MAX = 20;

export function bulkImport({ root, params }) {
  if (!db.isAdmin()) { location.hash = '#/create'; return; }
  let unsub = null;
  const jobId = params.get('job') || sessionStorage.getItem(KEY);
  if (jobId) { watch(jobId); } else paste(sessionStorage.getItem(KEY + '-rest') || '');

  function paste(prefill = '') {
    root.innerHTML = String(html`<main class="screen">
      <div class="top-row"><h1 class="grow">Make a clip</h1></div>
      ${makeTabs('bulk')}
      <p class="muted" style="margin:0">Paste up to ${MAX} Vlipsy links, one per line. No trimming needed: the robot reads each clip's name and tags, and you check them before anything is imported.</p>
      <div class="field"><label for="links">Links</label>
        <textarea class="input" id="links" rows="10" autocapitalize="none" spellcheck="false" placeholder="https://vlipsy.com/vlip/…">${prefill}</textarea>
        <span class="hint" id="count">0 links</span></div>
      <p class="err" id="err" role="alert"></p>
      <button class="btn" id="go">${icon('search')}Look them up</button>
    </main>`);
    const ta = $('#links', root);
    // Vlipsy search, home and other non-clip pages are skipped; only clip pages are looked up.
    const notClip = (u) => /^https?:\/\/(www\.)?vlipsy\.com\//i.test(u) && !/^https?:\/\/(www\.)?vlipsy\.com\/(clips|vlip|vlips)\/[^\/?#]+/i.test(u);
    const urls = () => [...new Set((ta.value.match(/https?:\/\/[^\s,]+/g) || []).filter((u) => !notClip(u)))];
    const upd = () => { const n = urls().length; $('#count', root).textContent = n > MAX ? `${n} links. The first ${MAX} are looked up now; the rest stay here for the next round.` : `${n} ${n === 1 ? 'link' : 'links'}`; };
    ta.oninput = upd; upd();
    $('#go', root).onclick = async () => {
      const list = urls();
      if (!list.length) { $('#err', root).textContent = 'Paste at least one link that starts with https://'; return; }
      $('#go', root).disabled = true;
      try {
        const id = await db.createLookupJob(list.slice(0, MAX)); sessionStorage.setItem(KEY, id);
        sessionStorage.setItem(KEY + '-rest', list.slice(MAX).join('\n')); // the rest wait for the next round
        watch(id);
      }
      catch (e) { $('#err', root).textContent = db.friendlyError(e); $('#go', root).disabled = false; }
    };
  }

  function watch(id) {
    root.innerHTML = String(html`<main class="screen"><div class="top-row">${backBtn('#/create')}<h1 class="grow" style="font-size:28px">Looking them up</h1></div>
      <div class="progress indeterminate"><i></i></div>
      <p class="muted" style="margin:0">The robot is reading each page. This usually takes about a minute (up to 10 if the quick start key is not set up). You can leave and come back; this screen remembers where you were.</p>
      <button class="btn ghost small" id="cancel" style="align-self:flex-start">Start over</button></main>`);
    $('#cancel', root).onclick = () => { forget(id); paste(); };
    unsub = db.watchJob(id, (job) => {
      if (!job) { forget(id); paste(); return; }
      if (job.status === 'failed') { forget(id); paste((job.urls || []).join('\n')); toast(job.error || 'The lookup did not work. Try again.', 6000); return; }
      if (job.status === 'done') { if (unsub) { unsub(); unsub = null; } review(id, job); }
    });
  }

  function forget(id) {
    if (unsub) { unsub(); unsub = null; }
    sessionStorage.removeItem(KEY);
    db.deleteJob(id).catch(() => {});
  }

  function review(id, job) {
    // Spot clips that are already in the app (or twice in this list) and untick them.
    const have = new Map();
    [...db.state.clips.values()].forEach((c) => { if (c.source && c.source.url && !c.deleted) have.set(sourceKey(c.source.url), c.title); });
    const items = (job.items || []).map((it) => {
      const k = it.videoUrl ? sourceKey(it.videoUrl) : null;
      const dup = k && have.has(k) ? `Already in the app as “${have.get(k)}”.` : null;
      if (k && !have.has(k)) have.set(k, it.title || 'another link in this list');
      return { ...it, dup, on: !!it.videoUrl && !it.error && !dup };
    });
    const dups = items.filter((i) => i.dup).length;
    let category = 'Reactions', visibility = 'group';
    const draw = () => {
      const n = items.filter((i) => i.on).length;
      root.innerHTML = String(html`<main class="screen">
        <div class="top-row">${backBtn('#/create')}<h1 class="grow" style="font-size:28px">Check and import</h1></div>
        <p class="muted" style="margin:0">Fix any names or tags, and untick anything you don't want.${dups ? ` ${dups} ${dups === 1 ? 'clip is' : 'clips are'} already in the app, so ${dups === 1 ? 'it is' : 'they are'} unticked.` : ''}</p>
        <ul class="list" style="gap:12px">${items.map((it, i) => html`<li class="panel" style="gap:12px;${it.on ? '' : 'opacity:.6'}">
          <label class="top-row" style="gap:12px;cursor:pointer">
            <input type="checkbox" data-on="${i}" ${it.on ? html`checked` : ''} ${it.videoUrl ? '' : html`disabled`} style="width:22px;height:22px;accent-color:var(--neon)">
            ${it.thumbUrl ? html`<img src="${it.thumbUrl}" alt="" width="64" height="40" style="width:64px;height:40px;object-fit:cover;border-radius:8px;background:var(--raised)" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
            <span class="grow small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${it.url}</span>
          </label>
          ${it.dup ? html`<p class="small" style="margin:0;color:var(--neon)">${it.dup}</p>` : ''}
          ${it.videoUrl ? html`
            <div class="field"><label for="t${i}">Name</label><input class="input" id="t${i}" data-title="${i}" maxlength="60" value="${it.title}"></div>
            <div class="field"><label for="g${i}">Tags</label><input class="input" id="g${i}" data-tags="${i}" value="${(it.tags || []).join(', ')}" autocapitalize="none"></div>`
          : html`<p class="err" style="margin:0">${it.error || 'No video found on this page.'}</p>`}
        </li>`)}</ul>
        <div class="field"><label for="cat">Category for all of them</label>
          <select class="input" id="cat">${CATEGORIES.map((k) => html`<option ${k === category ? html`selected` : ''}>${k}</option>`)}</select></div>
        <div class="field"><span class="lbl" id="vl">Who can see them</span>
          <div class="seg" role="radiogroup" aria-labelledby="vl">
            <button type="button" role="radio" aria-checked="${visibility === 'group'}" data-vis="group">The whole group</button>
            <button type="button" role="radio" aria-checked="${visibility === 'personal'}" data-vis="personal">Only me</button></div></div>
        <p class="err" id="err" role="alert"></p>
        <div class="btn-row"><button class="btn ghost" id="again">Start over</button><button class="btn" id="imp" ${n ? '' : html`disabled`}>Import ${n} ${n === 1 ? 'clip' : 'clips'}</button></div>
      </main>`);
      $$('[data-on]', root).forEach((c) => c.onchange = () => { save(); items[+c.dataset.on].on = c.checked; draw(); });
      $('#cat', root).onchange = (e) => { category = e.target.value; };
      $$('[data-vis]', root).forEach((b) => b.onclick = () => { save(); visibility = b.dataset.vis; draw(); });
      $('#again', root).onclick = () => { forget(id); paste(items.map((i) => i.url).join('\n')); };
      $('#imp', root).onclick = doImport;
    };
    const save = () => {
      $$('[data-title]', root).forEach((inp) => { items[+inp.dataset.title].title = inp.value.trim(); });
      $$('[data-tags]', root).forEach((inp) => { items[+inp.dataset.tags].tags = inp.value.split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean).slice(0, 12); });
      const c = $('#cat', root); if (c) category = c.value;
    };
    async function doImport() {
      save();
      const chosen = items.filter((i) => i.on);
      const missing = chosen.findIndex((i) => !i.title);
      if (missing >= 0) { $('#err', root).textContent = `Clip ${items.indexOf(chosen[missing]) + 1} needs a name.`; return; }
      const btn = $('#imp', root); btn.disabled = true;
      try {
        for (let k = 0; k < chosen.length; k++) {
          const it = chosen[k];
          btn.textContent = `Sending ${k + 1} of ${chosen.length}…`;
          await db.createLinkJob({ type: 'link', url: it.videoUrl, pageUrl: it.url, title: it.title.slice(0, 60), tags: it.tags || [], category, visibility, ranges: [], mode: 'join' }, { poke: k === chosen.length - 1 });
        }
        forget(id);
        toast(`${chosen.length} ${chosen.length === 1 ? 'clip is' : 'clips are'} being made. They show up on Home as they finish.`, 5000);
        const rest = sessionStorage.getItem(KEY + '-rest');
        if (rest) { toast(`Queued. ${rest.split('\n').length} more links are waiting in the box for the next round.`, 5000); paste(rest); }
        else location.hash = '#/jobs';
      } catch (e) { $('#err', root).textContent = db.friendlyError(e); btn.disabled = false; btn.textContent = 'Try again'; }
    }
    draw();
  }

  return () => { if (unsub) unsub(); };
}
