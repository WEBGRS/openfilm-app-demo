// The README's GIF and the skill's cover from one real take: the moments around each click and mark, cut together
// in an OpenFilm film of camera-page clips, rendered by OpenFilm. Usage: node demo/make.mjs <take.mp4> [cover mark] [until s]
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const take = resolve(process.argv[2] ?? '');
const coverMark = process.argv[3] ?? 'chart';
// Nothing after this second of the take is used
const until = Number(process.argv[4] ?? Infinity);
const name = basename(take, extname(take));
const record = JSON.parse(readFileSync(join(dirname(take), `${name}.record.json`), 'utf8'));
const FILM = join(ROOT, 'out', 'film');
rmSync(FILM, { recursive: true, force: true });
mkdirSync(join(FILM, 'assets'), { recursive: true });
for (const f of [`${name}.mp4`, `${name}.camera.html`]) copyFileSync(join(dirname(take), f), join(FILM, 'assets', f));
copyFileSync(join(import.meta.dirname, 'bg.html'), join(FILM, 'bg.html'));

// The moments worth seeing: each click and mark, a second before it to two after, joined when they touch
const moments = record.take.events.filter((e) => (e.type === 'down' || e.type === 'mark') && e.t <= until).map((e) => e.t);
const spans = [];
for (const t of moments.sort((a, b) => a - b)) {
  const a = Math.max(0, t - 1);
  const b = Math.min(record.take.duration, until, t + 2);
  const last = spans[spans.length - 1];
  if (last && a <= last.b + 0.6) last.b = Math.max(last.b, b);
  else spans.push({ a, b });
}
const r3 = (x) => Math.round(x * 1000) / 1000;
// The take's picture fitted to the stage with room around it
const [w, h] = record.size.split('x').map(Number);
const boxH = 960;
const boxW = Math.round((boxH * w) / h);
const left = Math.round((1920 - boxW) / 2);
let at = 0;
const clips = spans.map((s, i) => {
  const clip = `  <iframe id="shot-${i + 1}" src="assets/${name}.camera.html#t=${r3(s.a)},${r3(s.b)}" at="${r3(at)}" class="shot" style="left: ${left}px; top: 60px; width: ${boxW}px; height: ${boxH}px"></iframe>`;
  s.at = at;
  at += s.b - s.a;
  return clip;
});
const total = r3(at);
writeFileSync(join(FILM, 'film.html'), `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<style>
  .shot { border-radius: 14px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45); }
</style>
</head>
<body>
<section>
${clips.join('\n')}
</section>
<section>
  <iframe id="backdrop" src="bg.html#t=0,${total}"></iframe>
</section>
</body>
</html>
`);
console.log(`${spans.length} shots, ${total} s: ${spans.map((s) => `${r3(s.a)}-${r3(s.b)}`).join(' ')}`);

const run = (cmd, args, cwd = ROOT) => new Promise((done, fail) => {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const [exe, argv] = process.platform === 'win32' && cmd === 'npx' ? ['cmd.exe', ['/d', '/s', '/c', 'npx', ...args]] : [cmd, args];
  const child = spawn(exe, argv, { cwd, stdio: 'inherit', env: { ...process.env, OPENFILM_NO_BROWSER: '1', OPENFILM_HOME: join(ROOT, 'out', '.openfilm-home'), OPENFILM_LIBRARY: join(ROOT, 'out', '.openfilm-library') } });
  child.on('error', fail);
  child.on('close', (code) => (code === 0 ? done() : fail(new Error(`${cmd} failed (${code})`))));
});
await run('npx', ['-y', 'openfilm@0.2.1', 'look'], FILM);
await run('npx', ['-y', 'openfilm@0.2.1', 'render', '--workers', '1'], FILM);
const mp4 = join(FILM, 'film.mp4');
mkdirSync(join(ROOT, 'docs'), { recursive: true });
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mp4, '-filter_complex', 'fps=12,scale=800:-2:flags=lanczos,split[x][y];[x]palettegen=max_colors=160:stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', join(ROOT, 'docs', 'demo.gif')]);
// The cover: a second after the chosen mark, else the middle
const mark = record.take.events.find((e) => e.type === 'mark' && e.name === coverMark);
const span = mark && spans.find((s) => mark.t >= s.a && mark.t <= s.b);
const coverT = span ? span.at + (mark.t - span.a) + 1 : total / 2;
await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(r3(coverT)), '-i', mp4, '-frames:v', '1', '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '3', join(ROOT, 'skills', 'app-demo', 'cover.jpg')]);
// The Studio that look and render started for this film's home
try {
  const run = JSON.parse(readFileSync(join(ROOT, 'out', '.openfilm-home', 'run.json'), 'utf8'));
  for (const pid of [run.supervisor, run.pid]) if (pid) process.kill(pid);
} catch {
  // Not running
}
console.log('docs/demo.gif and skills/app-demo/cover.jpg written');
