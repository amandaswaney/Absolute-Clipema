// Reads a web page (for example a Vlipsy clip page) and pulls out its title, tags and video file.
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

const decode = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .trim();

function metas(html) {
  const out = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const val = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (key && val != null) out.push([key.toLowerCase(), decode(val)]);
  }
  return out;
}

function jsonLd(html) {
  const found = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      const walk = (x) => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) return x.forEach(walk); found.push(x); Object.values(x).forEach(walk); };
      walk(j);
    } catch {}
  }
  return found;
}

const cleanTitle = (t) => decode(t).replace(/\s*[|\-–—]\s*(Vlipsy|vlipsy\.com).*$/i, '').replace(/^Vlipsy\s*[|\-–—:]\s*/i, '').replace(/\s+(GIF|Video|Clip)$/i, '').trim();
const cleanTag = (t) => decode(t).toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ').trim();
const BORING = new Set(['vlipsy', 'video', 'videos', 'clip', 'clips', 'gif', 'gifs', 'reaction', 'reactions', 'meme', 'memes', 'video reactions', 'reaction videos', 'video clips']);

export async function lookupPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`The page answered with error ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (/^video\//.test(type)) return { title: '', tags: [], videoUrl: url, thumbUrl: null };
  const html = await res.text();
  const m = metas(html);
  const get = (...keys) => { for (const k of keys) { const hit = m.find(([key, v]) => key === k && v); if (hit) return hit[1]; } return ''; };
  const ld = jsonLd(html);
  const ldVideo = ld.find((x) => /VideoObject/i.test(String(x['@type'] || '')));

  let title = cleanTitle(get('og:title', 'twitter:title') || (ldVideo && ldVideo.name) || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');

  const tags = [];
  const addTags = (s) => (Array.isArray(s) ? s : String(s || '').split(',')).forEach((t) => { const c = cleanTag(t); if (c && c.length <= 24 && !BORING.has(c) && !tags.includes(c)) tags.push(c); });
  m.filter(([k]) => k === 'keywords' || k === 'news_keywords' || k === 'article:tag' || k === 'video:tag' || k === 'og:video:tag').forEach(([, v]) => addTags(v));
  ld.forEach((x) => { if (x.keywords) addTags(x.keywords); });

  const abs = (u) => { try { return new URL(decode(u), res.url).href; } catch { return null; } };
  let videoUrl = get('og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream', 'contenturl')
    || (ldVideo && (ldVideo.contentUrl || ldVideo.embedUrl)) || '';
  if (!videoUrl || !/\.(mp4|webm|mov)(\?|$)/i.test(videoUrl)) {
    const mp4 = html.match(/https?:\\?\/\\?\/[^"'\s<>]+?\.mp4(?:\?[^"'\s<>]*)?/i);
    if (mp4) videoUrl = mp4[0].replace(/\\\//g, '/');
  }
  return {
    title: title.slice(0, 60),
    tags: tags.slice(0, 12),
    videoUrl: videoUrl ? abs(videoUrl) : null,
    thumbUrl: abs(get('og:image', 'twitter:image')) || null,
  };
}
