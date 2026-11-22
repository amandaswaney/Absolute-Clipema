// Turns the Firebase snippet pasted into the FIREBASE_WEB_CONFIG secret into web/config.js.
// Accepts the snippet exactly as Firebase shows it (const firebaseConfig = { apiKey: "...", ... };) or plain JSON.
import fs from 'node:fs';

const out = process.argv[2] || 'web/config.js';
const raw = process.env.FIREBASE_WEB_CONFIG || '';
const cfg = {};
for (const m of raw.matchAll(/["']?(\w+)["']?\s*:\s*["']([^"']*)["']/g)) cfg[m[1]] = m[2];
const keep = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
const firebase = Object.fromEntries(keep.filter((k) => cfg[k]).map((k) => [k, cfg[k]]));
if (!firebase.apiKey) console.log('::warning::FIREBASE_WEB_CONFIG secret is missing or has no apiKey. The app will show "Almost there" until it is added.');
const config = { firebase, repo: process.env.GITHUB_REPOSITORY || '', build: process.env.GITHUB_SHA || 'dev' };
fs.writeFileSync(out, `window.CLIPEMA_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
// Give the service worker a new name each release so phones pick up the update.
const sw = out.replace(/config\.js$/, 'sw.js');
if (fs.existsSync(sw)) fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace("const BUILD = 'dev';", `const BUILD = '${config.build.slice(0, 12)}';`));
console.log(`Wrote ${out} for project ${firebase.projectId || '(none)'}`);
