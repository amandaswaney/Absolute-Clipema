// The same clip can come from different links; this gives one key per source video.
export function sourceKey(u) {
  if (!u) return null;
  const m = String(u).match(/vlipsy\.com\/vlips\/([^/?#]+)\//i);
  if (m) return 'vlipsy:' + m[1];
  return String(u).split(/[?#]/)[0].replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase();
}
