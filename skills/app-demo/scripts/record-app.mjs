#!/usr/bin/env node
// app-demo: film a desktop app while the person works it, for OpenFilm. The pointer and clicks are logged, so the
// film gets a smooth pointer and a camera that moves in on each click. Windows. Node 22 or later, no dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, createWriteStream } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const VERSION = '0.1.0';
const FPS = 30;
/** How far the camera page moves in on a click, unless the record says otherwise. */
export const ZOOM = 1.7;
const SCRIPT = fileURLToPath(import.meta.url);
const HERE = dirname(SCRIPT);

const HELP = `app-demo ${VERSION}: film a desktop app while the person works it (Windows).

  node record-app.mjs windows [text]                 open windows (title, program, size) and the screens
  node record-app.mjs start <take.mp4> --window <title or program> [options]
  node record-app.mjs start <take.mp4> --screen <n> [options]
                                                     puts the record bar on the person's screen and returns
  node record-app.mjs wait <take.mp4> [--timeout <s>] waits for the take (${100} s at most per call; run it again)
  node record-app.mjs stop <take.mp4>                 stops it, as Stop on the bar does; cancel throws it away
  node record-app.mjs camera <take.mp4> [--zoom <n|off>]
                                                     writes the camera page again; nothing is filmed
  node record-app.mjs install                         downloads FFmpeg with window capture (87 MB), when the one on
                                                     the PATH is older than 8

Options for start:
  --window <text>   the window whose title or program name contains the text (windows lists them)
  --area            the window with what opens over it (menus, dialogs): its part of the screen
  --screen <n>      a whole screen, 1 the first
  --note <text>     what the person is asked to do, shown on the bar
  --marks <a,b>     names of the moments the person marks with Mark, in order
  --max <s>         the longest take (300)
  --zoom <n|off>    how far the camera page moves in on a click (${ZOOM}); 1 to 4, or off
  --lang <zh|en>    the bar's language (the system's)

The person presses Start (F9), works the app, presses Mark (F9) at each moment worth naming, and Stop (F10).
The bar is never in the take. Only the window (or area, or screen) is filmed; the pointer and clicks are logged.

Beside the video:
  <name>.record.json   what was filmed and what happened: the size, every pointer move and click, the marks
  <name>.cursor.html   a page drawing the pointer (smoothed) and its clicks; on the track above the video, with the
                       same at, #t= and box
  <name>.camera.html   the take as a page that moves in on each click and keeps the pointer in view, the pointer
                       drawn in: in place of the video (and its cursor page), with the same #t=
A page plays at one speed: leave clips you speed up as plain video.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round3 = (x) => Math.round(x * 1000) / 1000;
const fmt = (x) => String(round3(x));
const shown = (p) => {
  const r = relative(process.cwd(), p);
  return r && !r.startsWith('..') ? r.replace(/\\/g, '/') : p;
};
const windows = () => process.platform === 'win32';
const notWindows = () => new Error('app-demo films desktop apps on Windows only: for a web product use the web-demo skill');

// ---------------------------------------------------------------- where things are

export const home = () => process.env.APP_DEMO_HOME || join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'openfilm-app-demo');
const runsDir = () => join(home(), 'runs');
const runKey = (take) => createHash('sha1').update(resolve(take).toLowerCase()).digest('hex').slice(0, 16);
const stateFile = (take) => join(runsDir(), `${runKey(take)}.json`);
const controlFile = (take) => join(runsDir(), `${runKey(take)}.control`);
export const recordFileFor = (video) => join(dirname(video), `${basename(video, extname(video))}.record.json`);
export const cursorFileFor = (video) => join(dirname(video), `${basename(video, extname(video))}.cursor.html`);
export const cameraFileFor = (video) => join(dirname(video), `${basename(video, extname(video))}.camera.html`);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Written whole, so a reader never sees half of it; a reader holding the file makes Windows refuse for a moment
function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 1));
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      if (i >= 20 || e.code !== 'EPERM') throw e;
      spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},25)']);
    }
  }
}

function moveFile(from, to) {
  try {
    renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV' && e.code !== 'EPERM') throw e;
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

// ---------------------------------------------------------------- the helper (record bar, windows, pointer)

let built = null;
/** The helper program, built once with the C# compiler Windows ships, kept by the hash of its source. */
export function helperExe() {
  if (built) return built;
  if (!windows()) throw notWindows();
  const src = join(HERE, 'deskrec.cs');
  const tag = createHash('sha1').update(readFileSync(src)).digest('hex').slice(0, 10);
  const dir = join(home(), 'bin');
  const exe = join(dir, `deskrec-${tag}.exe`);
  if (existsSync(exe)) return (built = exe);
  mkdirSync(dir, { recursive: true });
  const win = process.env.SystemRoot || 'C:\\Windows';
  const csc = ['Framework64', 'Framework'].map((d) => join(win, 'Microsoft.NET', d, 'v4.0.30319', 'csc.exe')).find((f) => existsSync(f));
  if (!csc) throw new Error('the C# compiler that comes with Windows (.NET Framework 4, csc.exe) is missing');
  const tmp = join(dir, `deskrec-${tag}.${process.pid}.tmp.exe`);
  const r = spawnSync(csc, ['-nologo', '-utf8output', '-optimize', '-target:winexe', `-out:${tmp}`, '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll', src], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !existsSync(tmp)) throw new Error(`could not build the recorder helper: ${`${r.stdout}${r.stderr}`.trim().slice(-500)}`);
  try {
    renameSync(tmp, exe);
  } catch {
    // Another run built it at the same moment
    rmSync(tmp, { force: true });
  }
  return (built = exe);
}

function helperJson(args) {
  const r = spawnSync(helperExe(), args, { encoding: 'utf8', timeout: 20000, windowsHide: true });
  if (r.status !== 0) throw new Error(`recorder helper ${args[0]} failed: ${(r.stderr || r.stdout || '').trim().slice(-300)}`);
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------- FFmpeg with window capture

const FF_BUILD = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip';
const ffDir = () => join(home(), 'ffmpeg');

function canCapture(bin) {
  const run = (a) => spawnSync(bin, ['-hide_banner', ...a], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  const f = run(['-filters']);
  return f.status === 0 && /\bgfxcapture\b/.test(f.stdout ?? '') && /\blibx264\b/.test(run(['-encoders']).stdout ?? '');
}

function findFile(dir, name) {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name) return p;
    if (e.isDirectory()) {
      const hit = findFile(p, name);
      if (hit) return hit;
    }
  }
  return null;
}

/** FFmpeg 8 or newer with gfxcapture and libx264: APP_DEMO_FFMPEG, the one install downloaded, or ffmpeg on the PATH. */
export function captureFfmpeg() {
  for (const c of [process.env.APP_DEMO_FFMPEG, findFile(ffDir(), 'ffmpeg.exe'), 'ffmpeg']) if (c && canCapture(c)) return c;
  return null;
}

async function install() {
  if (!windows()) throw notWindows();
  const have = captureFfmpeg();
  if (have) return `${have} can capture windows already: nothing to download`;
  mkdirSync(ffDir(), { recursive: true });
  const zip = join(ffDir(), 'ffmpeg.zip.part');
  const r = await fetch(FF_BUILD);
  if (!r.ok || !r.body) throw new Error(`could not download FFmpeg: ${r.status} ${r.statusText}`);
  const total = Number(r.headers.get('content-length')) || 0;
  const out = createWriteStream(zip);
  let got = 0;
  let told = -1;
  for await (const chunk of r.body) {
    if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok));
    got += chunk.length;
    const pct = total ? Math.floor((got / total) * 10) * 10 : -1;
    if (pct > told) process.stderr.write(`  ${(told = pct)}%\n`);
  }
  await new Promise((ok, fail) => out.end((e) => (e ? fail(e) : ok())));
  // Windows' own tar reads zip files
  const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const x = spawnSync(existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', ffDir()], { encoding: 'utf8', windowsHide: true });
  rmSync(zip, { force: true });
  if (x.status !== 0) throw new Error(`could not unpack FFmpeg: ${(x.stderr ?? '').trim().slice(-300)}`);
  const ff = captureFfmpeg();
  if (!ff) throw new Error('the FFmpeg downloaded cannot capture windows');
  return `${ff} installed`;
}

// ---------------------------------------------------------------- what the helper reports, as a take

/** gfxcapture source for a window's client area, or a monitor cropped to a region. */
export function captureFilter(t) {
  const base = `capture_cursor=0:max_framerate=${FPS}`;
  if (t.mode === 'window') return `gfxcapture=hwnd=${t.hwnd}:${base}:width=-2:height=-2,hwdownload,format=bgra,format=yuv420p`;
  const m = t.monitor.rect;
  const r = t.region;
  const crop = `crop_left=${r.x - m.x}:crop_top=${r.y - m.y}:crop_right=${m.x + m.w - (r.x + r.w)}:crop_bottom=${m.y + m.h - (r.y + r.h)}`;
  return `gfxcapture=hmonitor=${t.monitor.handle}:${base}:${crop},hwdownload,format=bgra,format=yuv420p`;
}

/**
 * The capture only gets frames when the picture changes; this pass makes it 30 fps, holds the last picture to the
 * end, and cuts away everything before the countdown finished.
 */
export function finishFilter(skip, dur) {
  return `setpts=PTS-STARTPTS,fps=${FPS},tpad=stop_mode=clone:stop_duration=${(skip + dur + 1).toFixed(3)},trim=start=${skip.toFixed(3)}:duration=${dur.toFixed(3)},setpts=PTS-STARTPTS`;
}

/**
 * Helper events as the take's events: seconds from the first frame, positions in the take's own px (screen pixels
 * divided by the screen's scale), named marks.
 */
export function toEvents(evs, goMs, dur, scale = 1, markNames = []) {
  const out = [];
  const used = new Set();
  let k = 0;
  const px = (v) => Math.round((v / scale) * 10) / 10;
  for (const e of evs) {
    if (e.ms === undefined) continue;
    const t = Math.round(((e.ms - goMs) / 1000) * 1000) / 1000;
    if (t < 0 || t > dur) continue;
    if (e.ev === 'move' || e.ev === 'down' || e.ev === 'up') out.push({ t, type: e.ev, x: px(e.x), y: px(e.y) });
    else if (e.ev === 'mark') {
      let name = markNames[k] ?? `m${k + 1}`;
      for (let n = 2; used.has(name); n++) name = `${markNames[k] ?? 'm'}${n}`;
      used.add(name);
      out.push({ t, type: 'mark', name });
      k++;
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- the pointer and the camera

/** Samples a second of the pointer's and the camera's paths in the pages. */
const PATH_RATE = 60;

// Implicit critically damped spring step
function spring(x, v, goal, w, dt) {
  const f = 1 + 2 * dt * w;
  const hoo = dt * w * w;
  const hhoo = dt * hoo;
  const inv = 1 / (f + hhoo);
  return [(f * x + dt * v + hhoo * goal) * inv, (v + hoo * (goal - x)) * inv];
}

/**
 * The pointer as the film shows it, PATH_RATE samples a second: [x, y, shown]. A hand's pointer jitters and jumps
 * between the logged moves; a spring smooths it, and it fades out after three still seconds.
 */
export function pointerPath(record) {
  const take = record.take;
  const [w, h] = record.size.split('x').map(Number);
  const pts = take.events.filter((e) => e.type === 'move' || e.type === 'down' || e.type === 'up');
  const n = Math.max(1, Math.ceil(take.duration * PATH_RATE) + 1);
  if (!pts.length) return Array.from({ length: n }, () => [w / 2, h / 2, 0]);
  let j = 0;
  const at = (t) => {
    while (j + 1 < pts.length && pts[j + 1].t <= t) j++;
    const p = pts[j];
    const q = pts[j + 1];
    if (t <= pts[0].t || !q) return t <= pts[0].t ? pts[0] : p;
    const k = (t - p.t) / Math.max(1e-6, q.t - p.t);
    return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
  };
  const wn = 2 * Math.PI * 5;
  const dt = 1 / PATH_RATE;
  let x = pts[0].x, y = pts[0].y, vx = 0, vy = 0;
  let last = -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / PATH_RATE;
    const g = at(t);
    [x, vx] = spring(x, vx, g.x, wn, dt);
    [y, vy] = spring(y, vy, g.y, wn, dt);
    while (last + 1 < pts.length && pts[last + 1].t <= t) last++;
    const idle = last >= 0 ? t - pts[last].t : 0;
    const shown = t < pts[0].t - 0.3 ? 0 : idle > 3 ? Math.max(0, 1 - (idle - 3) / 0.5) : 1;
    out.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(shown * 100) / 100]);
  }
  return out;
}

/**
 * Where the view moves in, in the take's own seconds: a span around each click, at the record's zoom. Spans with the
 * same focus close together become one; short gaps are bridged so the view pans instead of pulling out.
 */
export function zoomPlan(record) {
  const take = record.take;
  const s = record.zoom === undefined ? ZOOM : record.zoom === false ? 1 : record.zoom;
  if (!(s > 1)) return [];
  const spans = take.events.filter((e) => e.type === 'down').map((e) => ({ a: e.t - 0.6, b: e.t + 1.6, x: e.x, y: e.y, s }));
  const out = [];
  for (const g of spans) {
    const l = out[out.length - 1];
    if (l && g.a - l.b < 0.9 && Math.hypot(g.x - l.x, g.y - l.y) < 40) l.b = Math.max(l.b, g.b);
    else {
      if (l && g.a < l.b) l.b = g.a;
      out.push({ ...g });
    }
  }
  for (let i = 1; i < out.length; i++) if (out[i].a - out[i - 1].b < 0.9) out[i - 1].b = out[i].a;
  return out.map((g) => ({ ...g, a: round3(Math.max(0, g.a)), b: round3(Math.min(take.duration, g.b)) })).filter((g) => g.b > g.a);
}

/**
 * The camera's path, PATH_RATE samples a second: [scale, left, top], the part of the take in view. Two cascaded
 * springs ease every move in and out; while zoomed in, the view keeps the pointer's next moves in it, and it never
 * leaves the picture.
 */
export function cameraPath(record, pointer = pointerPath(record)) {
  const [w, h] = record.size.split('x').map(Number);
  const plan = zoomPlan(record);
  const n = pointer.length;
  const ahead = Math.round(0.4 * PATH_RATE);
  const margin = 0.72;
  const goals = [];
  for (let i = 0; i < n; i++) {
    const t = i / PATH_RATE;
    const span = plan.find((g) => t >= g.a && t < g.b);
    const s = span ? span.s : 1;
    let x = span ? span.x : w / 2;
    let y = span ? span.y : h / 2;
    if (span) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let j = i; j <= Math.min(n - 1, i + ahead); j++) {
        if (pointer[j][2] < 0.5) continue;
        x0 = Math.min(x0, pointer[j][0]); x1 = Math.max(x1, pointer[j][0]);
        y0 = Math.min(y0, pointer[j][1]); y1 = Math.max(y1, pointer[j][1]);
      }
      if (x0 !== Infinity) {
        const hold = (c, lo, hi, now, half) => {
          if (hi - lo > 2 * half) lo = hi = now;
          return lo < c - half ? lo + half : hi > c + half ? hi - half : c;
        };
        x = hold(x, x0, x1, pointer[i][0], (w / (2 * s)) * margin);
        y = hold(y, y0, y1, pointer[i][1], (h / (2 * s)) * margin);
      }
    }
    goals.push([s, Math.min(Math.max(x - w / (2 * s), 0), w - w / s), Math.min(Math.max(y - h / (2 * s), 0), h - h / s)]);
  }
  const wn = 2 * Math.PI * 1.1 * 1.6;
  const dt = 1 / PATH_RATE;
  const A = goals[0].slice(), B = goals[0].slice(), vA = [0, 0, 0], vB = [0, 0, 0];
  return goals.map((g) => {
    for (let k = 0; k < 3; k++) {
      [A[k], vA[k]] = spring(A[k], vA[k], g[k], wn, dt);
      [B[k], vB[k]] = spring(B[k], vB[k], A[k], wn, dt);
    }
    return [Math.round(B[0] * 10000) / 10000, Math.round(B[1] * 10) / 10, Math.round(B[2] * 10) / 10];
  });
}

/**
 * A page of the take: `camera` false, the pointer and its clicks alone, laid over the video; `camera` true, the take
 * itself moving in on its clicks with the pointer drawn in, used in place of the video.
 */
export function takePage(record, camera) {
  const take = record.take;
  const [w, h] = record.size.split('x').map(Number);
  const pointer = pointerPath(record);
  const downs = take.events.filter((e) => e.type === 'down').map((e) => e.t);
  const ups = take.events.filter((e) => e.type === 'up').map((e) => e.t);
  const name = basename(take.video, extname(take.video));
  const last = round3(take.duration - 0.5 / record.fps);
  const src = encodeURI(take.video).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${camera ? 'Camera' : 'Pointer'} for ${take.video}</title>
<!-- Made by app-demo with ${take.video}: ${camera
    ? `the take, moving in on its clicks, with the pointer. Use it in place of the video, with the same #t=. Change the
     zoom with "record-app.mjs camera ${name}.mp4 --zoom <n|off>".`
    : `the pointer and its clicks, in the take's own seconds. Lay it over the video with the same at, #t= and box.`} -->
<style>
  html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: ${camera ? '#000' : 'transparent'}; }
  #view { position: absolute; left: 0; top: 0; width: ${w}px; height: ${h}px; transform-origin: 0 0; }
  video { display: block; width: 100%; height: 100%; }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
</style>
</head>
<body>
<div id="view">
${camera ? `  <video id="take" src="${src}" muted playsinline preload="auto"></video>\n` : ''}  <svg viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <circle id="ring" r="0" fill="none" stroke="#000" stroke-opacity="0" stroke-width="3"></circle>
    <g id="pointer">
      <path d="M0 0 L0 23 L6 17.6 L10.4 27.4 L14.6 25.5 L10.2 15.9 L17.6 15.9 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"></path>
    </g>
  </svg>
</div>
<script type="module">
// Size of the pointer, 1 = a desktop pointer; 0 hides it
const SIZE = 1;
const RATE = ${PATH_RATE};
// [x, y, shown] of the pointer, RATE times a second
const POINTER = ${JSON.stringify(pointer)};
${camera ? `// [scale, left, top] of the view, RATE times a second
const PATH = ${JSON.stringify(cameraPath(record, pointer))};
` : ''}const DOWNS = ${JSON.stringify(downs)};
const UPS = ${JSON.stringify(ups)};
${camera ? "const video = document.getElementById('take');\n" : ''}const view = document.getElementById('view');
const pointer = document.getElementById('pointer');
const ring = document.getElementById('ring');
const last = (list, t) => {
  let lo = 0, hi = list.length - 1, hit = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid] <= t + 1e-6) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
  return hit;
};
const sample = (list, t) => {
  const f = Math.min(Math.max(t * RATE, 0), list.length - 1);
  const i = Math.floor(f), k = f - i, p = list[i], q = list[Math.min(i + 1, list.length - 1)];
  return p.map((v, j) => v + (q[j] - v) * k);
};
function draw(t) {
  ${camera ? `const [s, x, y] = sample(PATH, t);
  view.style.transform = \`scale(\${s}) translate(\${-x}px, \${-y}px)\`;` : 'const s = 1;'}
  const [px, py, shown] = sample(POINTER, t);
  const d = last(DOWNS, t), u = last(UPS, t);
  const pressed = d >= 0 && (u < 0 || UPS[u] < DOWNS[d]);
  // The pointer grows with the view, but less
  const size = SIZE / Math.sqrt(s);
  pointer.setAttribute('transform', \`translate(\${px} \${py}) scale(\${size * (pressed ? 0.86 : 1)})\`);
  pointer.setAttribute('opacity', String(SIZE > 0 ? shown : 0));
  const k = d >= 0 ? (t - DOWNS[d]) / 0.5 : -1;
  if (k >= 0 && k < 1 && SIZE > 0) {
    ring.setAttribute('cx', px);
    ring.setAttribute('cy', py);
    ring.setAttribute('r', String((6 + 26 * Math.sqrt(k)) * size));
    ring.setAttribute('stroke-width', String(3 * size));
    ring.setAttribute('stroke-opacity', String(0.45 * (1 - k)));
  } else ring.setAttribute('stroke-opacity', '0');
}
${camera ? `function frame(t) {
  video.currentTime = Math.min(Math.max(t, 0), ${last});
  draw(t);
}
const ready = new Promise((done) => {
  if (video.readyState >= 2) done();
  else { video.addEventListener('loadeddata', done, { once: true }); video.addEventListener('error', done, { once: true }); }
});
window.film = { frame, duration: ${take.duration}, width: ${w}, height: ${h}, ready };
if (!window.filmHost) {
  // Opened on its own: the take plays, and the view follows it
  video.loop = true;
  ready.then(() => video.play().catch(() => undefined));
  const loop = () => { draw(video.currentTime); requestAnimationFrame(loop); };
  loop();
}` : `window.film = { frame: draw, duration: ${take.duration}, width: ${w}, height: ${h} };
if (!window.filmHost) {
  const t0 = performance.now();
  const loop = () => { draw(((performance.now() - t0) / 1000) % film.duration); requestAnimationFrame(loop); };
  loop();
}`}
</script>
</body>
</html>
`;
}

/** The zoom spans of a take, one line each. */
export function zoomLines(record) {
  const plan = zoomPlan(record);
  if (!plan.length) return ['camera: no zoom (no clicks, or zoom off)'];
  return plan.map((g) => `camera: ${g.s}x ${fmt(g.a)}-${fmt(g.b)} s on ${Math.round(g.x)},${Math.round(g.y)}`);
}

function zoomValue(z, where) {
  if (z === false || z === 'off') return false;
  const n = Number(z);
  if (!(Number.isFinite(n) && n >= 1 && n <= 4)) throw new Error(`${where}: a zoom is a number from 1 to 4, or off, not ${JSON.stringify(z)}`);
  return n;
}

/** The camera page (and the pointer page) written again from the record, with its zoom changed. */
export function camera(videoArg, o = {}) {
  const video = resolve(videoArg);
  const recFile = recordFileFor(video);
  const record = readJson(recFile);
  if (!record?.take) throw new Error(`${shown(recFile)} is not there: only a take made by record-app.mjs has a camera page`);
  if (o.zoom !== undefined) record.zoom = zoomValue(o.zoom, '--zoom');
  writeJson(recFile, record);
  writeFileSync(cursorFileFor(video), takePage(record, false));
  writeFileSync(cameraFileFor(video), takePage(record, true));
  return [`${shown(cameraFileFor(video))}  written`, ...zoomLines(record)];
}

// ---------------------------------------------------------------- a take (the worker, detached from start)

const FINAL = new Set(['done', 'failed', 'cancelled']);

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** The run of a take: what the worker last wrote, with a worker that died mid-way read as failed. */
export function runState(take) {
  const s = readJson(stateFile(take));
  if (s && !FINAL.has(s.state) && s.pid && !processAlive(s.pid)) return { ...s, state: 'failed', message: 'the recorder stopped without finishing the take' };
  return s;
}

async function worker(o) {
  const out = resolve(o.out);
  const state = (s, extra = {}) => writeJson(stateFile(out), { take: out, pid: process.pid, started: o.started, state: s, updated: new Date().toISOString(), ...extra });
  const fake = process.env.APP_DEMO_FAKE;
  const exe = helperExe();
  const ff = captureFfmpeg();
  const work = mkdtempSync(join(tmpdir(), 'app-demo-take-'));
  const raw = join(work, 'raw.ts');
  const args = ['rec', '--mode', o.mode, '--lang', o.lang, '--max', String(o.max)];
  if (o.window) args.push('--match', o.window);
  if (o.hwnd) args.push('--hwnd', String(o.hwnd));
  if (o.screen) args.push('--monitor', String(o.screen - 1));
  if (o.note) args.push('--note', o.note);
  if (o.marks?.length) args.push('--marks', o.marks.join(','));
  if (fake) args.push('--now', '--hidden-bar', '--fake', fake);
  // A program with a window: hiding it at spawn would hide the record bar too
  const h = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const tell = (s) => {
    try {
      h.stdin.write(`${s}\n`);
    } catch {
      // Already gone
    }
  };
  const evs = [];
  let target = null;
  let goMs = 0;
  let stop = null;
  let cap = null;
  let capClosed = Promise.resolve();
  let t0 = Infinity;
  let capErr = '';
  let helperErr = '';
  h.stderr.on('data', (d) => (helperErr += d));
  // stop and cancel from the command line
  const control = setInterval(() => {
    const c = controlFile(out);
    if (!existsSync(c)) return;
    const what = readFileSync(c, 'utf8').trim();
    rmSync(c, { force: true });
    if (what === 'stop' || what === 'cancel') tell(what);
  }, 250);
  try {
    const outcome = await new Promise((done, fail) => {
      const waitStart = setTimeout(() => {
        if (target) return;
        tell('quit');
        fail(new Error(`nobody pressed Start on the record bar within ${Math.round(o.wait / 60)} min`));
      }, o.wait * 1000);
      const failed = (e) => {
        clearTimeout(waitStart);
        tell('quit');
        fail(e);
      };
      h.on('error', failed);
      h.on('close', (code) => {
        clearTimeout(waitStart);
        if (stop) return done('stop');
        // The bar went away mid-take: keep what was filmed
        if (goMs) {
          stop = { ev: 'stop', ms: Date.now(), why: 'closed' };
          return done('stop');
        }
        failed(new Error(`the record bar closed before the take started${code ? ` (exit ${code}${helperErr ? `: ${helperErr.trim().slice(-300)}` : ''})` : ''}`));
      });
      readline.createInterface({ input: h.stdout }).on('line', (line) => {
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          return;
        }
        if (e.ev === 'ready') state('waiting', { keys: e.keys ?? ['F9', 'F10'] });
        else if (e.ev === 'target') {
          target = e;
          clearTimeout(waitStart);
          const a = ['-hide_banner', '-loglevel', 'error', '-y', '-progress', 'pipe:1', '-stats_period', '0.05', '-filter_complex', captureFilter(e), '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '16', '-flush_packets', '1', '-f', 'mpegts', raw];
          const c = spawn(ff, a, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
          cap = c;
          c.stderr.on('data', (d) => (capErr = (capErr + d).slice(-4000)));
          // The first frame's moment: the least delayed report of "now minus how far the stream has got"
          let told = false;
          let frame = 0;
          let us = 0;
          readline.createInterface({ input: c.stdout }).on('line', (l) => {
            const [k, v] = l.split('=');
            if (k === 'frame') frame = Number(v) || 0;
            else if (k === 'out_time_us') us = Math.max(0, Number(v) || 0);
            else if (k === 'progress' && frame > 0) {
              t0 = Math.min(t0, Date.now() - us / 1000);
              if (!told) {
                told = true;
                tell('capturing');
              }
            }
          });
          capClosed = new Promise((ok) => c.on('close', () => ok()));
          c.on('close', (code) => {
            if (stop || code === 0) return;
            const msg = capErr.trim().split(/\r?\n/).pop() || `ffmpeg exit ${code}`;
            tell(`status Capture failed: ${msg.slice(0, 80)}`);
            setTimeout(() => failed(new Error(`window capture failed: ${msg.slice(0, 300)}`)), 1500);
          });
        } else if (e.ev === 'go') {
          goMs = e.ms;
          state('recording', { window: target?.title, program: target?.exe });
        } else if (e.ev === 'stop') {
          stop = e;
          done('stop');
        } else if (e.ev === 'cancel') done('cancel');
        else if (e.ev === 'error') failed(new Error(e.msg ?? 'recorder error'));
        else evs.push(e);
      });
    });

    // Stop the capture: ask, then insist (a still window gives ffmpeg no frame to notice the request on)
    if (cap) {
      try {
        cap.stdin.write('q');
      } catch {
        // Already closed
      }
      const t = setTimeout(() => cap.kill(), 1500);
      await capClosed;
      clearTimeout(t);
    }
    if (outcome === 'cancel') {
      state('cancelled', { message: 'the person cancelled the take' });
      return;
    }
    if (!goMs || !existsSync(raw)) throw new Error(`nothing was filmed${capErr ? `: ${capErr.trim().slice(-300)}` : ''}`);
    state('saving');
    tell('status Saving the take…');
    const dur = Math.max(0.5, (stop.ms - goMs) / 1000);
    const skip = Math.max(0, (goMs - (Number.isFinite(t0) ? t0 : goMs)) / 1000);
    const name = basename(out, extname(out));
    const tmp = join(work, `${name}.mp4`);
    // A key frame every quarter second: a page that sets the take's time frame by frame seeks it quickly
    const fin = spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-an', '-vf', finishFilter(skip, dur), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', String(Math.round(FPS / 4)), '-movflags', '+faststart', tmp], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 24 });
    if (fin.status !== 0 || !existsSync(tmp)) throw new Error(`could not finish the take: ${(fin.stderr ?? '').trim().slice(-300)}`);
    const probe = spawnSync(ff, ['-hide_banner', '-i', tmp], { encoding: 'utf8', windowsHide: true });
    const m = /Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(probe.stderr ?? '');
    const width = m ? Number(m[1]) : target.region.w;
    const height = m ? Number(m[2]) : target.region.h;
    const scale = target.scale > 0 ? target.scale : 1;
    const events = toEvents(evs, goMs, dur, scale, o.marks);
    const record = {
      app: { mode: o.mode, window: target.title ?? null, program: target.exe ?? null, screen: (target.monitor?.index ?? 0) + 1 },
      size: `${Math.round(width / scale)}x${Math.round(height / scale)}`,
      scale,
      fps: FPS,
      ...(o.zoom === undefined ? {} : { zoom: o.zoom }),
      take: {
        by: `app-demo ${VERSION}`,
        recorded: new Date().toISOString(),
        video: basename(out),
        width,
        height,
        duration: round3(dur),
        // The first frame, in ms since 1970, to line the take up with anything else recorded then
        startedAt: goMs,
        stopped: stop.why ?? 'user',
        steps: [],
        marks: events.filter((e) => e.type === 'mark').map((e) => ({ name: e.name, t: e.t })),
        events,
      },
    };
    writeFileSync(join(work, `${name}.record.json`), `${JSON.stringify(record, null, 1)}\n`);
    writeFileSync(join(work, `${name}.cursor.html`), takePage(record, false));
    writeFileSync(join(work, `${name}.camera.html`), takePage(record, true));
    mkdirSync(dirname(out), { recursive: true });
    for (const f of [`${name}.mp4`, `${name}.record.json`, `${name}.cursor.html`, `${name}.camera.html`]) moveFile(join(work, f), join(dirname(out), f));
    state('done', {
      result: {
        duration: record.take.duration,
        width,
        height,
        size: record.size,
        window: record.app.window,
        program: record.app.program,
        marks: record.take.marks,
        clicks: events.filter((e) => e.type === 'down').length,
        stopped: record.take.stopped,
        camera: zoomLines(record),
      },
    });
  } finally {
    clearInterval(control);
    tell('quit');
    if (cap && cap.exitCode === null) cap.kill();
    setTimeout(() => h.kill(), 3000).unref();
    try {
      rmSync(work, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // Left in the temp folder
    }
  }
}

// ---------------------------------------------------------------- commands

function listWindows(text) {
  const wins = helperJson(['list']).filter((w) => w.title && w.client.w > 0 && (!text || `${w.title} ${w.exe}`.toLowerCase().includes(text.toLowerCase())));
  const mons = helperJson(['monitors']);
  return [
    ...(wins.length ? wins.map((w) => `  "${w.title}" · ${w.exe} · ${w.client.w} x ${w.client.h}${w.minimized ? ' · minimized' : ''}${w.foreground ? ' · in front' : ''}`) : [`  no window${text ? ` matches "${text}"` : ''}`]),
    'Screens:',
    ...mons.map((m) => `  ${m.index + 1}${m.primary ? ' (main)' : ''} · ${m.rect.w} x ${m.rect.h} · scale ${m.scale}`),
  ].join('\n');
}

const systemLang = () => (/^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale) ? 'zh' : 'en');

export async function start(takeArg, o = {}) {
  if (!windows()) throw notWindows();
  const out = resolve(takeArg);
  if (extname(out).toLowerCase() !== '.mp4') throw new Error(`${takeArg}: the take is an .mp4`);
  const mode = o.screen ? 'screen' : o.area ? 'area' : 'window';
  if (mode !== 'screen' && !o.window && !o.hwnd) throw new Error('say what to film: --window <title or program> (windows lists them), or --screen <n>');
  const now = runState(out);
  if (now && !FINAL.has(now.state)) throw new Error(`a take of ${shown(out)} is ${now.state} already: wait for it, or stop or cancel it`);
  if (!captureFfmpeg()) throw new Error('filming a window needs FFmpeg 8 or later with window capture: "record-app.mjs install" downloads one (87 MB); ask the person first');
  helperExe();
  const opts = {
    out,
    mode,
    window: o.window,
    hwnd: o.hwnd,
    screen: o.screen ? Number(o.screen) : undefined,
    note: o.note ?? '',
    marks: o.marks ? String(o.marks).split(',').map((s) => s.trim()).filter(Boolean) : [],
    max: Number(o.max ?? 300),
    wait: Number(o.wait ?? 600),
    lang: o.lang ?? systemLang(),
    zoom: o.zoom === undefined ? undefined : zoomValue(o.zoom, '--zoom'),
    started: new Date().toISOString(),
  };
  if (!(opts.max >= 1 && opts.max <= 3600)) throw new Error('--max is 1 to 3600 seconds');
  rmSync(controlFile(out), { force: true });
  writeJson(stateFile(out), { take: out, state: 'starting', started: opts.started, updated: opts.started });
  const child = spawn(process.execPath, [SCRIPT, '_run', JSON.stringify(opts)], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  // Until the bar is up, or the run fails
  const end = Date.now() + 30000;
  for (;;) {
    const s = runState(out);
    if (s?.state === 'starting' && !s.pid) writeJson(stateFile(out), { ...s, pid: child.pid });
    if (s && s.state !== 'starting') break;
    if (Date.now() > end) throw new Error('the record bar did not come up within 30 s');
    await sleep(200);
  }
  const s = runState(out);
  if (s.state === 'failed') throw new Error(s.message);
  const [kStart, kStop] = s.keys ?? ['F9', 'F10'];
  const what = mode === 'screen' ? `screen ${opts.screen}` : `the window "${o.window ?? o.hwnd}"${mode === 'area' ? ' and what opens over it' : ''}`;
  return [
    `The record bar is on the person's screen, ready to film ${what}.`,
    `Ask them to get it ready, press Start (${kStart}), ${opts.marks.length ? `press Mark (${kStart}) at: ${opts.marks.join(', ')}, ` : ''}and Stop (${kStop}) when done.`,
    `Then: node ${shown(SCRIPT)} wait ${shown(out)}`,
  ].join('\n');
}

export async function wait(takeArg, o = {}) {
  const out = resolve(takeArg);
  const limit = Math.min(Number(o.timeout ?? 100), 600);
  const end = Date.now() + limit * 1000;
  let s = runState(out);
  if (!s) {
    const record = readJson(recordFileFor(out));
    if (record?.take) return { code: 0, text: `${shown(out)} was filmed already (${fmt(record.take.duration)} s); nothing is being filmed` };
    return { code: 1, text: `no take of ${shown(out)} was started: start puts the record bar up` };
  }
  while (!FINAL.has(s.state) && Date.now() < end) {
    await sleep(300);
    s = runState(out);
  }
  if (s.state === 'done') {
    const r = s.result;
    rmSync(stateFile(out), { force: true });
    return {
      code: 0,
      text: [
        `${shown(out)}  ${r.width} x ${r.height}, ${fmt(r.duration)} s, ${FPS} fps, ${r.clicks} click${r.clicks === 1 ? '' : 's'}${r.window ? `, "${r.window}"` : ''}${r.stopped === 'max' ? ' (stopped at --max)' : r.stopped === 'closed' ? ' (the window closed)' : ''}`,
        `${shown(recordFileFor(out))}  what was filmed and what happened (pointer, clicks, marks; size ${r.size} px)`,
        `${shown(cursorFileFor(out))}  the pointer, a page to lay over the video`,
        `${shown(cameraFileFor(out))}  the take moving in on its clicks, with the pointer: a page to use in place of the video`,
        r.marks.length ? `marks: ${r.marks.map((m) => `${m.name} ${fmt(m.t)} s`).join(' · ')}` : 'marks: none',
        ...r.camera,
      ].join('\n'),
    };
  }
  if (s.state === 'failed' || s.state === 'cancelled') {
    rmSync(stateFile(out), { force: true });
    return { code: 1, text: s.message ?? s.state };
  }
  const since = Math.round((Date.now() - Date.parse(s.started ?? s.updated)) / 1000);
  const doing = s.state === 'waiting' ? 'waiting for the person to press Start' : s.state === 'recording' ? `filming${s.window ? ` "${s.window}"` : ''}` : s.state;
  return { code: 0, text: `still ${doing} (${since} s since start): run wait again` };
}

function control(takeArg, what) {
  const out = resolve(takeArg);
  const s = runState(out);
  if (!s || FINAL.has(s.state)) return `no take of ${shown(out)} is being filmed`;
  mkdirSync(runsDir(), { recursive: true });
  writeFileSync(controlFile(out), what);
  return what === 'stop' ? 'asked to stop: wait gives the take' : 'asked to cancel: nothing is kept';
}

async function main(argv) {
  const { values: v, positionals: p } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      window: { type: 'string' }, hwnd: { type: 'string' }, area: { type: 'boolean' }, screen: { type: 'string' }, note: { type: 'string' },
      marks: { type: 'string' }, max: { type: 'string' }, wait: { type: 'string' }, lang: { type: 'string' }, zoom: { type: 'string' },
      timeout: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
    },
  });
  if (v.version) return console.log(VERSION);
  const [cmd, arg] = p;
  if (v.help || !cmd) return console.log(HELP);
  if (cmd === '_run') {
    const o = JSON.parse(arg);
    try {
      await worker(o);
    } catch (e) {
      writeJson(stateFile(o.out), { take: resolve(o.out), pid: process.pid, started: o.started, state: 'failed', updated: new Date().toISOString(), message: e.message });
    }
    return;
  }
  if (cmd === 'windows') return console.log(listWindows(arg));
  if (cmd === 'install') return console.log(await install());
  if (!arg) throw new Error(`${cmd} takes the take: ${cmd} <take.mp4>`);
  if (cmd === 'start') return console.log(await start(arg, v));
  if (cmd === 'wait') {
    const r = await wait(arg, v);
    console.log(r.text);
    if (r.code) process.exitCode = r.code;
    return;
  }
  if (cmd === 'stop' || cmd === 'cancel') return console.log(control(arg, cmd));
  if (cmd === 'camera') return console.log(camera(arg, { zoom: v.zoom }).join('\n'));
  throw new Error(`no command ${cmd}: windows, start, wait, stop, cancel, camera or install`);
}

const same = (x) => (windows() ? resolve(x).toLowerCase() : resolve(x));
if (process.argv[1] && same(process.argv[1]) === same(SCRIPT)) {
  main(process.argv.slice(2)).then(
    () => process.stdout.write('', () => process.exit(process.exitCode ?? 0)),
    (e) => {
      console.error(`record-app.mjs: ${e.message}`);
      process.exit(1);
    },
  );
}
