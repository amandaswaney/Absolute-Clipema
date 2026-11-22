// Cuts gallery videos on the phone with ffmpeg.wasm, so no server is needed.
import { FFmpeg } from '../vendor/ffmpeg/index.js';

let ff = null;
let logs = [];

async function getFF() {
  if (ff) return ff;
  const f = new FFmpeg();
  f.on('log', ({ message }) => { logs.push(message); if (logs.length > 400) logs.shift(); });
  const base = new URL('../vendor/ffmpeg/core/', import.meta.url).href;
  await f.load({ coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' });
  ff = f;
  return f;
}

const even = (dim) => `trunc(min(720,${dim})/2)*2`;
// Short side at most 720 px, keep shape, keep even sizes for H.264.
const SCALE = `scale=w='if(gte(iw,ih),-2,${even('iw')})':h='if(gte(iw,ih),${even('ih')},-2)'`;

/**
 * file: File from the gallery. groups: array of outputs, each an array of {s, e} ranges joined in order.
 * onStage(text), onProgress(0..1) report progress. Returns [{ bytes, duration }].
 */
export async function cut(file, groups, { onStage, onProgress } = {}) {
  onStage && onStage('Loading the video cutter (first time takes a moment)…');
  const f = await getFF();
  const dir = '/in' + Date.now();
  await f.createDir(dir);
  await f.mount('WORKERFS', { files: [file] }, dir);
  const input = `${dir}/${file.name}`;
  try {
    logs = [];
    await f.exec(['-hide_banner', '-i', input]); // exits non-zero, but prints what is inside the file
    const hasAudio = logs.some((l) => /Stream #.*Audio:/.test(l));
    const total = groups.reduce((s, g) => s + g.reduce((a, r) => a + (r.e - r.s), 0), 0);
    let doneSecs = 0;
    const outputs = [];
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const dur = g.reduce((a, r) => a + (r.e - r.s), 0);
      onStage && onStage(groups.length > 1 ? `Cutting clip ${gi + 1} of ${groups.length}…` : 'Cutting your clip…');
      const args = ['-hide_banner', '-y'];
      g.forEach((r) => args.push('-ss', r.s.toFixed(3), '-t', (r.e - r.s).toFixed(3), '-i', input));
      if (!hasAudio) g.forEach((r) => args.push('-f', 'lavfi', '-t', (r.e - r.s).toFixed(3), '-i', 'anullsrc=r=44100:cl=stereo'));
      const n = g.length;
      let fc = '';
      for (let i = 0; i < n; i++) {
        fc += `[${i}:v:0]${SCALE},fps=30,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v${i}];`;
        fc += `[${hasAudio ? i : n + i}:a:0]aresample=44100,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}];`;
      }
      fc += Array.from({ length: n }, (_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${n}:v=1:a=1[v][a]`;
      args.push('-filter_complex', fc, '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'out.mp4');
      const onProg = ({ time }) => {
        const secs = Math.max(0, Math.min(dur, (time || 0) / 1e6));
        onProgress && onProgress(Math.min(1, (doneSecs + secs) / total));
      };
      f.on('progress', onProg);
      logs = [];
      const code = await f.exec(args);
      f.off('progress', onProg);
      if (code !== 0) {
        console.warn(logs.join('\n'));
        throw new Error('This video could not be cut on your phone. Try a shorter range, or a different video.');
      }
      const bytes = await f.readFile('out.mp4');
      await f.deleteFile('out.mp4');
      outputs.push({ bytes, duration: dur });
      doneSecs += dur;
    }
    onProgress && onProgress(1);
    return outputs;
  } finally {
    try { await f.unmount(dir); await f.deleteDir(dir); } catch {}
  }
}
