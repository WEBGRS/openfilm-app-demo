#!/usr/bin/env node
// Measures a finished film of a take of the test window: node evals/measure.mjs film.mp4 --take take.mp4 [--film film.html --record take.record.json]
// Needs ffmpeg and ffprobe on the PATH and Node 22. The same script is run on every film, whichever arm made it.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: v, positionals: [filmFile] } = parseArgs({
  allowPositionals: true,
  options: { take: { type: 'string' }, film: { type: 'string' }, record: { type: 'string' }, series: { type: 'boolean' } },
});
if (!filmFile || !v.take) throw new Error('usage: measure.mjs film.mp4 --take take.mp4 [--film film.html --record take.record.json]');

const SAMPLE_W = 480;
const RATE = 5;
const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;

function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout);
  return { w: j.streams[0].width, h: j.streams[0].height, duration: Number(j.format.duration) };
}

// Frames as raw RGB, RATE a second, SAMPLE_W px wide
function frames(file, info, rate, each) {
  const w = SAMPLE_W;
  const h = Math.round((w * info.h) / info.w / 2) * 2;
  return new Promise((done) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vf', `fps=${rate},scale=${w}:-2:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const size = w * h * 3;
    let buf = Buffer.alloc(0);
    let i = 0;
    p.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= size) {
        each(buf.subarray(0, size), i++, w, h);
        buf = buf.subarray(size);
      }
    });
    p.on('close', () => done(i));
  });
}

// The test window's background is a gradient: green runs from 60 to 130 across the whole window, so the green range
// a frame spans says how much of the window it shows (1 = all of it, 2 = half of its width and height)
function gradientRange(rgb, w, h) {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    if (r >= 8 && r <= 50 && g >= 48 && g <= 145 && b >= 92 && b <= 135 && b >= r + 55) {
      hist[g]++;
      n++;
    }
  }
  if (n < w * h * 0.03) return { n, range: 0 };
  const at = (q) => {
    let c = 0;
    for (let g = 0; g < 256; g++) if ((c += hist[g]) >= n * q) return g;
    return 255;
  };
  return { n, range: Math.max(1, at(0.98) - at(0.02)) };
}

const film = probe(filmFile);
const take = probe(v.take);
const out = { film: filmFile.split(/[\\/]/).pop(), size: `${film.w}x${film.h}`, seconds: round(film.duration) };

// Zoom: the whole take's range against each frame's
let base = 0;
await frames(v.take, take, 1, (rgb, i, w, h) => {
  if (i === 2) base = gradientRange(rgb, w, h).range;
});
const zoom = [];
await frames(filmFile, film, RATE, (rgb, i, w, h) => {
  const g = gradientRange(rgb, w, h);
  zoom.push(g.range ? base / g.range : 0);
});
const shown = zoom.filter((z) => z > 0);
const IN = 1.25;
let episodes = 0, run = 0, jump = 0;
zoom.forEach((z, i) => {
  if (z >= IN) run++;
  else {
    if (run >= 0.4 * RATE) episodes++;
    run = 0;
  }
  if (i && z && zoom[i - 1]) jump = Math.max(jump, Math.abs(z - zoom[i - 1]));
});
if (run >= 0.4 * RATE) episodes++;
out.takeOnScreen = `${round((shown.length / zoom.length) * 100, 0)}%`;
out.zoomedShare = shown.length ? `${round((shown.filter((z) => z >= IN).length / shown.length) * 100, 0)}%` : 'n/a';
out.zoomIns = episodes;
out.maxZoom = shown.length ? round(Math.max(...shown)) : 0;
out.largestJumpIn02s = round(jump);
if (v.series) out.zoomEvery02s = zoom.map((z) => round(z));

// Sound
const sd = spawnSync('ffmpeg', ['-hide_banner', '-i', filmFile, '-af', 'silencedetect=n=-40dB:d=1,ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
const sil = [...sd.stderr.matchAll(/silence_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
const lufs = /\n\s+I:\s+(-?[\d.]+) LUFS/.exec(sd.stderr);
out.longestSilenceSeconds = sil.length ? round(Math.max(...sil)) : 0;
out.loudnessLUFS = lufs ? Number(lufs[1]) : null;
out.hasSound = /Audio:/.test(spawnSync('ffprobe', ['-hide_banner', filmFile], { encoding: 'utf8' }).stderr);

// Voice against the take's clicks and marks, read from film.html
if (v.film && v.record) {
  const html = readFileSync(v.film, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const record = JSON.parse(readFileSync(v.record, 'utf8'));
  const dir = dirname(resolve(v.film));
  const base3 = record.take.video.replace(/\.[^.]+$/, '').toLowerCase();
  const attrOf = (tag, n) => new RegExp(`(?:^|\\s)${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find((x) => x !== undefined);
  const fragOf = (src, dur) => {
    const t = /#t=(?:npt:)?(\d*\.?\d*)(?:,(\d*\.?\d+))?/.exec(src ?? '');
    return { tin: t && t[1] ? Number(t[1]) : 0, tout: t && t[2] ? Number(t[2]) : dur };
  };
  const clips = [];
  const voice = [];
  for (const [tag] of html.matchAll(/<(?:iframe|video|audio)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const src = attrOf(tag, 'src');
    if (!src) continue;
    const file = resolve(dir, decodeURIComponent(src.split('#')[0])).toLowerCase();
    const at = Number(attrOf(tag, 'at') ?? 0) || 0;
    const speed = Number(attrOf(tag, 'speed') ?? 1) || 1;
    if (tag.toLowerCase().startsWith('<audio')) {
      // Every sound clip counts as a line; none of the films here has music
      if (existsSync(file)) voice.push(at);
    } else if (file.replace(/\.view[\\/]film\.html$/, '.mp4').split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/\.(camera|cursor)$/, '') === base3) {
      clips.push({ ...fragOf(src, record.take.duration), at, speed });
    }
  }
  const onFilm = (t) => clips.filter((c) => t >= c.tin - 1e-6 && t < c.tout).map((c) => c.at + (t - c.tin) / c.speed);
  const clicks = record.take.events.filter((e) => e.type === 'down');
  const marks = record.take.events.filter((e) => e.type === 'mark');
  const clickAt = clicks.flatMap((e) => onFilm(e.t));
  const markAt = marks.map((e) => onFilm(e.t)[0]);
  out.clicksOnFilm = `${clicks.filter((e) => onFilm(e.t).length).length} of ${clicks.length}`;
  out.marksOnFilm = `${markAt.filter((x) => x !== undefined).length} of ${marks.length}`;
  out.voiceLines = voice.length;
  out.marksWithALine = `${markAt.filter((m) => m !== undefined && voice.some((s) => s >= m - 0.5 && s <= m + 2)).length} of ${marks.length}`;
  const near = voice.map((s) => Math.min(...[...clickAt, ...markAt.filter((x) => x !== undefined)].map((m) => Math.abs(s - m))));
  out.medianSecondsFromLineStartToNearestClickOrMark = near.length ? round(near.sort((a, b) => a - b)[near.length >> 1]) : null;
}
console.log(JSON.stringify(out, null, 2));
