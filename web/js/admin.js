import * as db from './db.js';
import { html, icon, $, $$, toast, sheet, confirmSheet, backBtn, copyText, when, ago } from './ui.js';

function tempPassword() {
  const words = ['plum', 'neon', 'clip', 'meme', 'zoom', 'wave', 'fizz', 'jolt', 'pop', 'glow', 'buzz', 'yeet'];
  const b = new Uint32Array(3); crypto.getRandomValues(b);
  return `${words[b[0] % words.length]}-${words[b[1] % words.length]}-${100 + (b[2] % 900)}`;
}

export async function admin({ root }) {
  if (!db.isAdmin()) { location.hash = '#/me'; return; }
  let tab = sessionStorage.getItem('admin-tab') || 'invites';
  const draw = async () => {
    root.innerHTML = String(html`<main class="screen">
      <div class="top-row">${backBtn('#/me')}<h1 class="grow" style="font-size:28px">Admin</h1></div>
      <div class="seg" role="tablist" aria-label="Admin sections">
        ${[['invites', 'Invites'], ['members', 'Members'], ['robot', 'Robot']].map(([id, l]) => html`<button role="tab" aria-selected="${tab === id}" data-tab="${id}">${l}</button>`)}
      </div>
      <div id="body"><div class="skeleton" style="height:64px;border-radius:16px"></div></div>
    </main>`);
    $$('[data-tab]', root).forEach((b) => b.onclick = () => { tab = b.dataset.tab; sessionStorage.setItem('admin-tab', tab); draw(); });
    const body = $('#body', root);
    try {
      if (tab === 'invites') await invites(body, draw);
      else if (tab === 'members') await members(body, draw);
      else await robot(body);
    } catch (e) { body.innerHTML = String(html`<p class="err">${db.friendlyError(e)}</p>`); }
  };
  draw();
}

async function invites(body, redraw) {
  const list = await db.listInvites();
  const members = await db.listMembers();
  const nameOf = (uid) => (members.find((m) => m.id === uid) || {}).username || 'someone';
  const open = list.filter((i) => !i.usedBy), used = list.filter((i) => i.usedBy);
  body.innerHTML = String(html`<div class="stack">
    <form class="panel" id="nf">
      <h3>Invite a friend</h3>
      <p class="muted small" style="margin:0">Each code works once. Send it to one friend with the app link.</p>
      <div class="field"><label for="note">Who is it for? (only you see this)</label><input class="input" id="note" maxlength="40" autocomplete="off" placeholder="e.g. Priya"></div>
      <button class="btn" type="submit">${icon('plus')}Make an invite code</button>
    </form>
    <section class="stack tight"><h3>Waiting to be used (${open.length})</h3>
      ${open.length ? html`<ul class="list">${open.map((i) => html`<li class="row"><span class="grow"><b class="code">${i.code}</b><span>${i.note ? `For ${i.note} · ` : ''}made ${ago(i.createdAt)}</span></span>
        <button class="icon-btn" data-share="${i.code}" aria-label="Send code ${i.code}" title="Send code">${icon('share')}</button>
        <button class="icon-btn" data-cancel="${i.code}" aria-label="Cancel code ${i.code}" title="Cancel code">${icon('trash')}</button></li>`)}</ul>`
        : html`<p class="muted" style="margin:0">No open codes.</p>`}
    </section>
    ${used.length ? html`<section class="stack tight"><h3>Used (${used.length})</h3><ul class="list">${used.map((i) => html`<li class="row"><span class="grow"><b class="code" style="font-size:15px">${i.code}</b><span>Used by ${nameOf(i.usedBy)}${i.note ? ` · for ${i.note}` : ''}</span></span></li>`)}</ul></section>` : ''}
  </div>`);
  $('#nf', body).onsubmit = async (e) => {
    e.preventDefault();
    const b = $('button[type=submit]', body); b.disabled = true;
    try { const code = await db.createInvite($('#note', body).value.trim()); showCode(code); redraw(); }
    catch (err) { toast(db.friendlyError(err)); b.disabled = false; }
  };
  $$('[data-share]', body).forEach((b) => b.onclick = () => sendCode(b.dataset.share));
  $$('[data-cancel]', body).forEach((b) => b.onclick = async () => {
    const ok = await confirmSheet({ title: `Cancel code ${b.dataset.cancel}?`, body: 'Nobody will be able to join with it.', confirm: 'Cancel code' });
    if (!ok) return;
    try { await db.cancelInvite(b.dataset.cancel); redraw(); } catch (err) { toast(db.friendlyError(err)); }
  });
}

const appLink = () => location.origin + location.pathname;
const inviteText = (code) => `Join me on Absolute Clipema, our clip app: ${appLink()}\nTap Join and use this invite code: ${code}`;
async function sendCode(code) {
  if (navigator.share) { try { await navigator.share({ text: inviteText(code) }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copyText(inviteText(code));
}
function showCode(code) {
  sheet('Invite code ready', html`<div class="panel" style="align-items:center"><span class="code" style="font-size:28px">${code}</span></div>
    <p class="muted" style="margin:0">Send this to one friend. They open the app, tap Join, and type the code.</p>
    <div class="btn-row"><button class="btn ghost" id="cp">${icon('copy')}Copy</button><button class="btn" id="sh">${icon('share')}Send</button></div>`, (el) => {
    $('#cp', el).onclick = () => copyText(inviteText(code));
    $('#sh', el).onclick = () => sendCode(code);
  });
}

async function members(body, redraw) {
  const list = await db.listMembers();
  const me = db.state.user.uid;
  body.innerHTML = String(html`<div class="stack tight">
    <p class="muted small" style="margin:0">${list.filter((m) => !m.removed).length} people in the group.</p>
    <ul class="list">${list.map((m) => html`<li class="row" style="${m.removed ? 'opacity:.65' : ''}">
      <span class="grow"><b>${m.username}${m.id === me ? ' (you)' : ''}</b><span>${m.role === 'admin' ? 'Admin' : m.removed ? 'Removed' : 'Member'} · joined ${ago(m.createdAt)}</span></span>
      ${m.id !== me ? html`
        <button class="icon-btn" data-pw="${m.id}" data-name="${m.username}" aria-label="Set a new password for ${m.username}" title="Set a new password">${icon('key')}</button>
        <button class="icon-btn" data-rm="${m.id}" data-name="${m.username}" data-removed="${!!m.removed}" aria-label="${m.removed ? `Let ${m.username} back in` : `Remove ${m.username}`}" title="${m.removed ? 'Let back in' : 'Remove'}">${icon(m.removed ? 'refresh' : 'trash')}</button>` : ''}
    </li>`)}</ul>
    <p class="muted small" style="margin:0">Password changes and removals are carried out by the clip robot, usually within a minute (up to 10 minutes if the quick start key is not set up).</p>
  </div>`);
  $$('[data-pw]', body).forEach((b) => b.onclick = () => {
    const name = b.dataset.name, pw = tempPassword();
    sheet(`New password for ${name}`, html`<form class="stack" id="pf">
      <div class="field"><label for="np">New password</label><input class="input" id="np" value="${pw}" autocomplete="off" autocapitalize="none" spellcheck="false" minlength="6" required>
      <span class="hint">Tell ${name} this password. They can change it under Me, then Change password.</span></div>
      <p class="err" id="perr"></p><button class="btn" type="submit">Set password</button></form>`, (el, close) => {
      $('#pf', el).onsubmit = async (e) => {
        e.preventDefault();
        const v = $('#np', el).value.trim();
        if (v.length < 6) { $('#perr', el).textContent = 'Use at least 6 characters.'; return; }
        try { await db.adminSetPassword(b.dataset.pw, v); close(); toast(`Done. ${name}'s new password works within a few minutes.`, 5000); }
        catch (err) { $('#perr', el).textContent = db.friendlyError(err); }
      };
    });
  });
  $$('[data-rm]', body).forEach((b) => b.onclick = async () => {
    const name = b.dataset.name, removed = b.dataset.removed === 'true';
    const ok = await confirmSheet(removed
      ? { title: `Let ${name} back in?`, body: 'They can sign in again with their old password.', confirm: 'Let back in', danger: false }
      : { title: `Remove ${name}?`, body: 'They are signed out and cannot sign in again. Their clips stay unless you delete them.', confirm: `Remove ${name}` });
    if (!ok) return;
    try { await db.adminSetRemoved(b.dataset.rm, !removed); redraw(); } catch (err) { toast(db.friendlyError(err)); }
  });
}

async function robot(body) {
  const [st, trig] = await Promise.all([db.getStatus(), db.getTrigger()]);
  const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
  const lastRun = ms(st && st.lastRun);
  const weekly = st && st.weekly;
  const stale = !lastRun || Date.now() - lastRun > 3 * 3600 * 1000;
  body.innerHTML = String(html`<div class="stack">
    <section class="panel ${stale || (weekly && !weekly.ok) ? 'warn' : ''}">
      <h3>Robot health</h3>
      <ul class="list" style="gap:4px">
        <li>Last ran: <b>${lastRun ? `${when(lastRun)} (${ago(lastRun)})` : 'never'}</b></li>
        <li>Where: <b>${(st && st.runner) || 'unknown'}</b></li>
        <li>Video storage used: <b>${st && st.storageBytes ? `${(st.storageBytes / 1e9).toFixed(2)} GB of 10 GB free` : 'not counted yet'}</b></li>
        <li>yt-dlp version: <b>${(st && st.ytDlp) || 'unknown'}</b></li>
        <li>Weekly YouTube check: <b>${weekly ? `${weekly.ok ? 'passed' : 'FAILED'} on ${when(ms(weekly.at))}` : 'not run yet'}</b></li>
      </ul>
      ${weekly && !weekly.ok ? html`<p class="small" style="margin:0">YouTube is blocking the robot. See "If YouTube clips stop working" in the setup guide.</p>` : ''}
      ${stale ? html`<p class="small" style="margin:0">The robot normally checks in every 10 minutes. If this stays old, open the repository on GitHub, tap Actions, and look at the latest "Clip robot" run.</p>` : ''}
    </section>
    <form class="panel" id="tf">
      <h3>Quick start key</h3>
      <p class="muted small" style="margin:0">Optional. With a GitHub key here, the robot starts the moment someone makes a clip (about 1 minute). Without it, the robot checks every 10 minutes. Setup guide, step 9.</p>
      <div class="field"><label for="tok">GitHub key</label>
        <input class="input" id="tok" type="password" autocomplete="off" spellcheck="false" placeholder="${trig.token ? 'A key is saved. Paste a new one to replace it.' : 'github_pat_…'}"></div>
      <p class="err" id="terr"></p>
      <div class="btn-row"><button class="btn ghost small" type="button" id="test" ${trig.token ? '' : 'disabled'}>Test it</button><button class="btn small" type="submit">Save key</button></div>
    </form>
  </div>`);
  $('#tf', body).onsubmit = async (e) => {
    e.preventDefault();
    const v = $('#tok', body).value.trim();
    if (!v) { $('#terr', body).textContent = 'Paste the key first.'; return; }
    try { await db.saveTrigger(v); toast('Key saved'); robot(body); } catch (err) { $('#terr', body).textContent = db.friendlyError(err); }
  };
  $('#test', body).onclick = async () => {
    const ok = await db.testTrigger();
    toast(ok ? 'It works. The robot is starting.' : 'GitHub said no. Check the key has "Actions: Read and write" for this repository and has not expired.', 6000);
  };
}
