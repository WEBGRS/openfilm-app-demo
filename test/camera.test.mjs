// The camera as keyframes of a clip's own CSS animation, and check: no window is filmed
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cameraAnimation, cameraCss, cameraName, cameraPath, cameraStops, captureFilter, checkFilm, fileSeconds, moments, viewFilm } from '../skills/app-demo/scripts/record-app.mjs';

const noFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 ? false : 'no ffmpeg on the PATH';

// A take of 8 s with one click, as a hand would make it
function handTake() {
  const events = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 6;
  for (let t = 0.2; t < 2; t += 0.015 + Math.abs(rnd()) / 200) events.push({ t: Math.round(t * 1000) / 1000, type: 'move', x: 100 + t * 300 + rnd(), y: 200 + t * 100 + rnd() });
  events.push({ t: 2.1, type: 'down', x: 700, y: 400 }, { t: 2.2, type: 'up', x: 700, y: 400 });
  return { size: '1280x720', fps: 30, take: { video: 'app.mp4', duration: 8, steps: [], events } };
}

test('capture is converted with the BT.709 matrix, which the take is tagged with', () => {
  assert.match(captureFilter({ mode: 'window', hwnd: 1 }), /scale=out_color_matrix=bt709:out_range=tv,format=yuv420p$/);
  assert.match(captureFilter({ mode: 'area', region: { x: 0, y: 0, w: 8, h: 8 }, monitor: { handle: 1, index: 0, rect: { x: 0, y: 0, w: 8, h: 8 } } }), /out_color_matrix=bt709/);
});

test('a take is as long as its file: the frames counted, so a clip may end where the record says', { skip: noFfmpeg }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-demo-secs-'));
  try {
    // 181 frames at 30 fps is a file of 6.033 s
    const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:r=30:d=6.04', '-frames:v', '181', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'a.mp4')], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    assert.ok(Math.abs(fileSeconds('ffmpeg', join(dir, 'a.mp4')) - 181 / 30) < 1e-9);
    assert.equal(fileSeconds('ffmpeg', join(dir, 'none.mp4')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Where a point of the take is on the clip's box at time t, by the keyframes: [x, y, scale]
function seen(record, stops, t, p) {
  const [w, h] = record.size.split('x').map(Number);
  let i = stops.findIndex((s) => s[0] >= t);
  i = Math.max(1, i < 0 ? stops.length - 1 : i);
  const [a, b] = [stops[i - 1], stops[i]];
  const k = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
  const [s, x, y] = [1, 2, 3].map((j) => a[j] + (b[j] - a[j]) * k);
  return [w / 2 + (x * w) / 100 + s * (p[0] - w / 2), h / 2 + (y * h) / 100 + s * (p[1] - h / 2), s];
}

test('the camera as keyframes: few stops, the page\'s own path, the click near the middle while zoomed', () => {
  const r = handTake();
  const [w, h] = r.size.split('x').map(Number);
  const stops = cameraStops(r);
  const path = cameraPath(r);
  assert.ok(stops.length < 120, `${stops.length} stops for ${path.length} samples`);
  assert.deepEqual([stops[0][0], stops.at(-1)[0]], [0, 8]);
  // Where each puts the picture's top left corner, in px of a 1920 px box: within 2 px
  path.forEach(([s, l, top], i) => {
    const [sx, sy, ss] = seen(r, stops, Math.min(i / 60, 8), [0, 0]);
    const k = 1920 / w;
    assert.ok(Math.abs(sx * k + l * s * k) < 2 && Math.abs(sy * k + top * s * k) < 2 && Math.abs(ss - s) < 0.003, `sample ${i}: ${sx * k}, ${sy * k} against ${-l * s * k}, ${-top * s * k}`);
  });
  const [cx, cy, s] = seen(r, stops, 3, [700, 400]);
  assert.ok(s > 1.6 && Math.abs(cx - w / 2) < w * 0.3 && Math.abs(cy - h / 2) < h * 0.3, `the click at ${cx.toFixed(0)}, ${cy.toFixed(0)} of ${w} x ${h}, zoom ${s}`);
  assert.deepEqual(cameraStops({ ...r, zoom: false }).map((x) => x.slice(1)), [[1, 0, 0], [1, 0, 0]]);
});

test('the keyframes: a name, a block of stops from 0% to 100%, the animation of the view', () => {
  const r = handTake();
  const css = cameraCss(r);
  assert.equal(css.name, 'app-camera');
  assert.match(css.text, /^@keyframes app-camera \{\n {2}0% \{ scale: 1; translate: 0% 0% \}\n/);
  assert.match(css.text, /\n {2}100% \{ scale: 1; translate: 0% 0% \}\n\}\n$/);
  assert.notEqual(cameraCss({ ...r, zoom: 2.2 }).text, css.text);
  assert.equal(cameraName({ take: { video: '2 apps.final.mp4' } }), 'take-2-apps-final-camera');
  assert.equal(cameraAnimation(r), 'app-camera 8s linear 0s both');
});

test('check: a clip past the take, a pointer page off its video, a click with no pointer, a camera page', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-demo-check-'));
  try {
    mkdirSync(join(dir, 'assets'));
    const r = handTake();
    writeFileSync(join(dir, 'assets', 'app.record.json'), JSON.stringify(r));
    const box = 'left:0;top:0;width:1920px;height:1080px';
    const write = (clips) => {
      writeFileSync(join(dir, 'film.html'), `<html><head></head><body>${clips}</body></html>`);
      return checkFilm(join(dir, 'film.html'));
    };
    // Right: the view; a clip of the video with its pointer page, in the same box
    const ok = write(`<section><iframe src="assets/app.view/film.html#t=0,5" style="${box}"></iframe></section>
<section><iframe src="assets/app.cursor.html#t=3,8" at="5" style="${box}"></iframe></section><section><video src="assets/app.mp4#t=3,8" at="5" style="${box}"></video></section>`);
    assert.equal(ok.code, 0, ok.lines.join('\n'));
    assert.match(ok.lines.at(-1), /^no problem found/);
    const bad = write(`<section><iframe src="assets/app.cursor.html#t=0,5" style="left:10px;top:0;width:1920px;height:1080px"></iframe>
<iframe src="assets/app.view/film.html#t=3,8.5" at="5"></iframe></section><section>
<video src="assets/app.mp4#t=0,5" style="${box}"></video></section>`);
    const said = bad.lines.join('\n');
    assert.equal(bad.code, 1);
    assert.match(said, /pointer page at 0 s is not in the video's box/);
    assert.match(said, /view clip at 5 s \(#t=3,8.5\) runs to 8.5 s, past the take's 8 s: end it at 8 at most/);
    assert.match(bad.lines.at(-1), /^2 problems: put each right/);
    // A click on a plain video with no pointer over it is a note, not a problem
    const note = write(`<section><video src="assets/app.mp4#t=0,8" style="${box}"></video></section>`);
    assert.equal(note.code, 0);
    assert.match(note.lines.join('\n'), /note: .*1 click \(2.1 s of the take\) on the film with no pointer over it: use the view/);
    // A camera page works, and says what the view is
    assert.match(write(`<section><iframe src="assets/app.camera.html#t=0,8" style="${box}"></iframe></section>`).lines.join('\n'), /note: .*its camera page renders many times slower than its view/);
    writeFileSync(join(dir, 'film.html'), '<section><video src="other.mp4"></video></section>');
    assert.equal(checkFilm(join(dir, 'film.html')).code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the view: a film of its own with the take and its pointer page moved by the camera, its paths one folder up', () => {
  const r = handTake();
  const view = viewFilm({ ...r, take: { ...r.take, video: 'my app #2.mp4' } });
  assert.match(view, /<meta name="viewport" content="width=1280, height=720">/);
  assert.match(view, /<iframe src="\.\.\/my%20app%20%232\.cursor\.html#t=0,8" style="left: 0; top: 0; width: 1280px; height: 720px; animation: my-app--2-camera 8s linear 0s both"><\/iframe>/);
  assert.match(view, /<video src="\.\.\/my%20app%20%232\.mp4#t=0,8" style="left: 0; top: 0; width: 1280px; height: 720px; animation: my-app--2-camera 8s linear 0s both"><\/video>/);
  assert.match(view, /<style>\n@keyframes my-app--2-camera \{\n {2}0% \{ scale: 1;/);
  assert.ok(view.indexOf('<iframe') < view.indexOf('<video'), 'the pointer is on the track above the video');
});

test('moments and check read the view as a clip of the take, placed by its #t= and at', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-demo-view-'));
  try {
    mkdirSync(join(dir, 'assets', 'app.view'), { recursive: true });
    const r = handTake();
    writeFileSync(join(dir, 'assets', 'app.record.json'), JSON.stringify(r));
    writeFileSync(join(dir, 'film.html'), '<section>\n<iframe src="assets/app.view/film.html#t=1,5" at="2" style="left:0;top:0;width:1920px;height:1080px"></iframe>\n</section>');
    assert.deepEqual(moments(join(dir, 'assets', 'app.mp4')).slice(1), ['  click 1: take 2.1 s, film 3.1 s']);
    const c = checkFilm(join(dir, 'film.html'));
    assert.equal(c.code, 0, c.lines.join('\n'));
    assert.match(c.lines[0], /1 of its view/);
    writeFileSync(join(dir, 'film.html'), '<section>\n<iframe src="assets/app.view/film.html#t=1,9" at="2"></iframe>\n</section>');
    assert.match(checkFilm(join(dir, 'film.html')).lines.join('\n'), /view clip at 2 s \(#t=1,9\) runs to 9 s, past the take's 8 s/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
