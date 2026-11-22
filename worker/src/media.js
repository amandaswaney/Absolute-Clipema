// yt-dlp and ffmpeg helpers.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_SECONDS = 60;

export function run(cmd, args, { timeoutMs = 10 * 60 * 1000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; if (out.length > 2e6) out = out.slice(-1e6); });
    p.stderr.on('data', (d) => { err += d; if (err.length > 2e6) err = err.slice(-1e6); });
    const t = setTimeout(() => { p.kill('SIGKILL'); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve({ out, err });
      else { const e = new Error(lastLines(err || out, 6) || `${cmd} exited with ${code}`); e.code = code; e.stderr = err; reject(e); }
    });
  });
}
const lastLines = (s, n) => s.trim().split('\n').filter((l) => !/^\s*$/.test(l)).slice(-n).join('\n');

export const ytDlpBin = () => process.env.YTDLP_BIN || 'yt-dlp';

export async function ytDlpVersion() {
  try { return (await run(ytDlpBin(), ['--version'], { timeoutMs: 30000 })).out.trim(); } catch { return 'not installed'; }
}

export async function probe(file) {
  const { out } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { timeoutMs: 60000 });
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  return { duration: parseFloat(j.format && j.format.duration) || 0, width: v ? v.width : 0, height: v ? v.height : 0, hasVideo: !!v, hasAudio: !!a };
}

// Download just one section of a video, cut precisely.
export async function grabSection(url, s, e, outBase, cookiesFile) {
  const args = [
    '--no-playlist', '--no-progress', '--no-warnings', '--newline',
    '-f', 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b',
    '-S', 'res:720,vcodec:h264,acodec:aac',
    '--download-sections', `*${s.toFixed(2)}-${e.toFixed(2)}`,
    '--force-keyframes-at-cuts',
    '--merge-output-format', 'mp4',
    '--js-runtimes', 'node',
    '-o', `${outBase}.%(ext)s`,
  ];
  if (cookiesFile) args.push('--cookies', cookiesFile);
  if (process.env.YTDLP_EXTRA_ARGS) args.push(...process.env.YTDLP_EXTRA_ARGS.split(' ').filter(Boolean));
  args.push(url);
  await run(ytDlpBin(), args, { timeoutMs: 15 * 60 * 1000 });
  const dir = path.dirname(outBase), base = path.basename(outBase);
  const f = fs.readdirSync(dir).find((n) => n.startsWith(base + '.') && !n.endsWith('.part') && !n.endsWith('.ytdl'));
  if (!f) throw new Error('yt-dlp finished but no video file appeared');
  return path.join(dir, f);
}

// Join pieces (or re-encode one) into a 720p H.264/AAC MP4 at most 60 s long.
export async function joinPieces(pieces, outFile) {
  const infos = [];
  for (const p of pieces) infos.push(await probe(p));
  if (!infos[0].hasVideo) throw new Error('The download had no video in it');
  const first = infos[0];
  let W = first.width, H = first.height;
  const scaleDown = Math.min(1, 720 / Math.min(W, H));
  W = Math.max(2, Math.round((W * scaleDown) / 2) * 2);
  H = Math.max(2, Math.round((H * scaleDown) / 2) * 2);
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  pieces.forEach((p) => args.push('-i', p));
  const n = pieces.length;
  infos.forEach((inf, i) => { if (!inf.hasAudio) args.push('-f', 'lavfi', '-t', String(inf.duration || 1), '-i', 'anullsrc=r=44100:cl=stereo'); });
  let fc = '';
  let silentIdx = n;
  infos.forEach((inf, i) => {
    fc += `[${i}:v:0]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v${i}];`;
    const ai = inf.hasAudio ? `${i}:a:0` : `${silentIdx++}:a:0`;
    fc += `[${ai}]aresample=44100,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}];`;
  });
  fc += infos.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${n}:v=1:a=1[v][a]`;
  args.push('-filter_complex', fc, '-map', '[v]', '-map', '[a]', '-t', String(MAX_SECONDS + 0.5),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outFile);
  await run('ffmpeg', args, { timeoutMs: 15 * 60 * 1000 });
  return probe(outFile);
}

// Make sure an uploaded file is a playable MP4 that starts quickly; re-encode only if needed.
export async function tidyUpload(inFile, outFile) {
  const info = await probe(inFile);
  if (!info.hasVideo) throw new Error('The uploaded file has no video in it');
  if (info.duration > MAX_SECONDS + 1.5) throw new Error(`The uploaded clip is longer than ${MAX_SECONDS} seconds`);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', inFile, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', outFile], { timeoutMs: 5 * 60 * 1000 });
  return probe(outFile);
}

export async function thumbnail(videoFile, outJpg, duration) {
  const at = Math.max(0, Math.min(1, (duration || 1) / 3));
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at.toFixed(2), '-i', videoFile, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', outJpg], { timeoutMs: 60000 });
}
