// What the helper reports, as a take; the pointer, the camera and the pages; no window is filmed
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraPath, captureFilter, finishFilter, pointerPath, takePage, toEvents, ZOOM, zoomPlan } from '../skills/app-demo/scripts/record-app.mjs';

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
