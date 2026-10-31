// What the helper reports, as a take; the pointer, the camera and the pages; no window is filmed
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { cameraPath, captureFilter, finishFilter, pointerPath, takePage, toEvents, ZOOM, zoomPlan } from '../skills/app-demo/scripts/record-app.mjs';

// The guide's pictures need ffmpeg; the CI runner has none
const noFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 ? false : 'no ffmpeg on the PATH';

test('helper events become take events: seconds from the first frame, px over the screen scale, named marks', () => {
  const go = 1_000_000;
  const ev = toEvents(
    [
      { ev: 'move', ms: go - 50, x: 1, y: 1 },
      { ev: 'move', ms: go, x: 15, y: 30 },
      { ev: 'down', ms: go + 1500, x: 300, y: 450, b: 'left' },
      { ev: 'up', ms: go + 1600, x: 300, y: 450 },
      { ev: 'mark', ms: go + 2000 },
      { ev: 'scroll', ms: go + 2100, x: 5, y: 5, d: -240 },
      { ev: 'mark', ms: go + 2500 },
      { ev: 'mark', ms: go + 2600 },
      { ev: 'move', ms: go + 9000, x: 9, y: 9 },
    ],
    go,
    5,
    1.5,
    ['open', 'open'],
  );
  assert.deepEqual(ev.map((e) => e.type), ['move', 'down', 'up', 'mark', 'mark', 'mark']);
  assert.equal(ev[1].t, 1.5);
  assert.deepEqual([ev[1].x, ev[1].y], [200, 300]);
  assert.deepEqual(ev.filter((e) => e.type === 'mark').map((e) => e.name), ['open', 'open2', 'm3']);
});

test('capture filters: a window by handle, an area as a cropped screen; the finish pass pads and trims', () => {
  assert.match(captureFilter({ mode: 'window', hwnd: 42 }), /^gfxcapture=hwnd=42:capture_cursor=0:max_framerate=30:width=-2:height=-2,hwdownload/);
  const a = captureFilter({ mode: 'area', region: { x: 110, y: 60, w: 800, h: 600 }, monitor: { handle: 7, index: 1, rect: { x: 100, y: 50, w: 1920, h: 1080 } } });
  assert.match(a, /hmonitor=7:.*crop_left=10:crop_top=10:crop_right=1110:crop_bottom=470/);
  assert.equal(finishFilter(2.25, 3), 'setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration=6.250,trim=start=2.250:duration=3.000,setpts=PTS-STARTPTS');
});

// A hand's pointer: logged every 15-40 ms with a few px of jitter, a click on a button, then still
function handTake() {
  const events = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 6;
  for (let t = 0.2; t < 2; t += 0.015 + Math.abs(rnd()) / 200) events.push({ t: Math.round(t * 1000) / 1000, type: 'move', x: 100 + t * 300 + rnd(), y: 200 + t * 100 + rnd() });
  events.push({ t: 2.1, type: 'down', x: 700, y: 400 }, { t: 2.2, type: 'up', x: 700, y: 400 });
  return { size: '1280x720', fps: 30, take: { video: 'app.mp4', duration: 8, steps: [], events } };
}

test('the pointer is smoothed: less jitter than the hand, and it fades out after three still seconds', () => {
  const r = handTake();
  const p = pointerPath(r);
  assert.equal(p.length, 8 * 60 + 1);
  // Second differences along the move: the jitter
  const rough = (xs) => xs.slice(2).reduce((s, x, i) => s + Math.abs(x - 2 * xs[i + 1] + xs[i]), 0) / (xs.length - 2);
  const raw = r.take.events.filter((e) => e.type === 'move').map((e) => e.y);
  const smooth = p.slice(Math.round(0.5 * 60), Math.round(1.8 * 60)).map((s) => s[1]);
  assert.ok(rough(smooth) < rough(raw) / 5, `jitter ${rough(raw).toFixed(2)} -> ${rough(smooth).toFixed(2)}`);
  assert.equal(p[Math.round(1 * 60)][2], 1, 'shown while moving');
  assert.equal(p[Math.round(4.9 * 60)][2], 1, 'still shown 2.7 s after the click');
  assert.equal(p[Math.round(6 * 60)][2], 0, 'gone 3.8 s after the click');
  assert.equal(p[0][2], 1, 'shown from the first logged move');
});

test('the camera moves in on the click, stays in the picture, and keeps the pointer in view', () => {
  const r = handTake();
  assert.deepEqual(zoomPlan(r).map((g) => [g.x, g.y, g.s, g.a, g.b]), [[700, 400, ZOOM, 1.5, 3.7]]);
  assert.deepEqual(zoomPlan({ ...r, zoom: false }), []);
  const pointer = pointerPath(r);
  const path = cameraPath(r, pointer);
  assert.ok(Math.abs(path[Math.round(3 * 60)][0] - ZOOM) < 0.03, `zoomed in at 3 s: ${path[180][0]}`);
  assert.ok(path[Math.round(7.9 * 60)][0] < 1.05, 'back out by the end');
  path.forEach(([s, x, y], i) => {
    assert.ok(x >= -0.05 && y >= -0.05 && x + 1280 / s <= 1280.05 && y + 720 / s <= 720.05, `in the picture at sample ${i}`);
    const [px, py, shown] = pointer[i];
    if (s > 1.5 && shown > 0.5) assert.ok(px >= x - 2 && px <= x + 1280 / s + 2 && py >= y - 2 && py <= y + 720 / s + 2, `pointer in view at ${(i / 60).toFixed(2)} s`);
  });
});

test('the pages: a pointer page over the video, and a camera page that plays the take', () => {
  const r = handTake();
  const cursor = takePage(r, false);
  assert.match(cursor, /window\.film = \{ frame: draw, duration: 8, width: 1280, height: 720 \}/);
  assert.doesNotMatch(cursor, /<video/);
  assert.match(cursor, /background: transparent/);
  const cam = takePage({ ...r, take: { ...r.take, video: 'my app #2.mp4' } }, true);
  assert.match(cam, /<video id="take" src="my%20app%20%232\.mp4" muted playsinline preload="auto"><\/video>/);
  assert.match(cam, /window\.film = \{ frame, duration: 8, width: 1280, height: 720, ready \}/);
  assert.match(cam, /video\.currentTime = Math\.min\(Math\.max\(t, 0\), 7\.983\)/);
  assert.match(cam, /const PATH = \[\[1,/);
});

test('moments: each mark and click, in the take and on the film, once per clip that shows it', async () => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { moments } = await import('../skills/app-demo/scripts/record-app.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'app-demo-moments-'));
  try {
    mkdirSync(join(dir, 'assets'));
    const events = [{ t: 0.4, type: 'move', x: 1, y: 1 }, { t: 1, type: 'down', x: 5, y: 5 }, { t: 2.5, type: 'mark', name: 'saved' }, { t: 4, type: 'down', x: 9, y: 9 }];
    writeFileSync(join(dir, 'assets', 'excel.record.json'), JSON.stringify({ take: { duration: 6, events } }));
    // The camera page from 0.5 s placed at 10 s, at double speed; a cursor page over a part that has no click
    writeFileSync(join(dir, 'film.html'), `<section>
  <iframe src="assets/excel.camera.html#t=0.5,5" at="10" speed="2"></iframe>
  <!-- <video src="assets/excel.mp4#t=0,6" at="40"></video> -->
  <iframe src="assets/excel.cursor.html#t=5,6" at="30"></iframe>
  <video src="assets/other.mp4" at="0"></video>
</section>`);
    const lines = moments(join(dir, 'assets', 'excel.mp4'));
    assert.match(lines[0], /6 s, placed by/);
    assert.deepEqual(lines.slice(1), [
      '  click 1: take 1 s, film 10.25 s',
      '  mark "saved": take 2.5 s, film 11 s',
      '  click 2: take 4 s, film 11.75 s',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('guide: a heading for each mark, a picture of each click with the spot outlined, at the take\'s px size', { skip: noFfmpeg }, async () => {
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { guide, guideRows } = await import('../skills/app-demo/scripts/record-app.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'app-demo-guide-'));
  try {
    // A take filmed at screen scale 2: 1280 x 720 video, 640 x 360 in the take's px
    const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=1280x720:r=30:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'app.mp4')], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    const events = [{ t: 0.2, type: 'move', x: 1, y: 1 }, { t: 1, type: 'down', x: 100, y: 100 }, { t: 2.5, type: 'mark', name: 'saved' }, { t: 4, type: 'down', x: 635, y: 355 }];
    const record = { app: { window: 'Book1 - Excel' }, size: '640x360', scale: 2, fps: 30, take: { duration: 6, events } };
    writeFileSync(join(dir, 'app.record.json'), JSON.stringify(record));
    assert.deepEqual(guideRows(record), [{ n: 1, at: 1, x: 100, y: 100 }, { heading: 'saved' }, { n: 2, at: 4, x: 635, y: 355 }]);
    const lines = guide(join(dir, 'app.mp4'));
    assert.match(lines[0], /2 steps, 1 headings/);
    const md = readFileSync(join(dir, 'app.guide.md'), 'utf8');
    for (const s of ['2 clicks in Book1 - Excel', '### 1. Click', '## saved', '](app.guide/02.png)']) assert.ok(md.includes(s), s);
    // The second spot sits against the corner: outlined inside the picture
    const px = spawnSync('ffmpeg', ['-v', 'error', '-i', join(dir, 'app.guide', '02.png'), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 }).stdout;
    assert.equal(px.length, 640 * 360 * 3);
    let orange = 0;
    for (let i = 0; i < px.length; i += 3) if (Math.abs(px[i] - 242) < 30 && Math.abs(px[i + 1] - 84) < 30 && Math.abs(px[i + 2] - 45) < 30) orange++;
    assert.ok(orange > 600, `${orange} outline pixels`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
