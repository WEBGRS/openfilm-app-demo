// Real takes of a test window on Windows: the record bar hidden, the input scripted (APP_DEMO_FAKE)
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const HOME = mkdtempSync(join(tmpdir(), 'app-demo-home-'));
const DIR = mkdtempSync(join(tmpdir(), 'app-demo-test-'));
process.env.APP_DEMO_HOME = HOME;
const A = await import('../skills/app-demo/scripts/record-app.mjs');
const SCRIPT = join(import.meta.dirname, '..', 'skills', 'app-demo', 'scripts', 'record-app.mjs');

const ff = process.platform === 'win32' ? A.captureFfmpeg() : null;
const skip = process.platform !== 'win32' ? 'Windows only' : !ff ? 'no FFmpeg with gfxcapture' : process.env.CI ? 'no desktop to film on CI' : false;

after(async () => {
  // The helper of the last take quits a moment after it; its exe can't be removed while it runs
  await new Promise((r) => setTimeout(r, 3500));
  for (const d of [HOME, DIR]) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // Left in the temp folder
    }
  }
});

// A test window that paints its own clock as 24 black and white cells, so each frame says when it was drawn
async function testWindow(kind = 'anim', secs = 30) {
  const p = spawn(A.helperExe(), ['testwin', '640', '360', String(secs), kind]);
  const info = await new Promise((ok) => p.stdout.once('data', (d) => ok(JSON.parse(String(d)))));
  return { hwnd: info.hwnd, close: () => p.kill() };
}
function paintTimes(file) {
  const raw = spawnSync(ff, ['-v', 'error', '-i', file, '-vf', 'crop=384:16:16:328,scale=24:1:flags=area,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 }).stdout;
  const out = [];
  for (let i = 0; i < raw.length / 24; i++) {
    let v = 0;
    for (let b = 0; b < 24; b++) v = v * 2 + (raw[i * 24 + b] > 128 ? 1 : 0);
    out.push(v);
  }
  return out;
}
const wrap = (d) => (d > 1 << 23 ? d - (1 << 24) : d < -(1 << 23) ? d + (1 << 24) : d);
const fake = (name, lines) => {
  const f = join(DIR, `${name}.txt`);
  writeFileSync(f, lines.join('\n'));
  process.env.APP_DEMO_FAKE = f;
};
const waitDone = async (take) => {
  for (let i = 0; i < 10; i++) {
    const r = await A.wait(take, { timeout: 20 });
    if (!/^still /.test(r.text)) return r;
  }
  throw new Error('the take never finished');
};
// The command line in a child process, without blocking this one
const cli = (args) => new Promise((done) => {
  const child = spawn(process.execPath, [SCRIPT, ...args], { env: process.env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  child.on('close', (status) => done({ status, stdout, stderr }));
});

test('a window is filmed at 30 fps from the countdown, its clicks in the take\'s px, frames in step with the log', { skip, timeout: 120_000 }, async () => {
  const w = await testWindow();
  try {
    fake('clicks', ['move 100 100', 'wait 400', 'down 320 180', 'up 320 180', 'wait 300', 'mark', 'wait 500', 'move 600 300', 'wait 600', 'stop']);
    const take = join(DIR, 'assets', 'app.mp4');
    const said = await A.start(take, { hwnd: String(w.hwnd), marks: 'clicked' });
    assert.match(said, /record bar is on the person's screen/);
    const r = await waitDone(take);
    assert.equal(r.code, 0, r.text);
    for (const f of ['app.mp4', 'app.record.json', 'app.cursor.html', 'app.camera.html']) assert.ok(existsSync(join(DIR, 'assets', f)), f);
    const rec = JSON.parse(readFileSync(join(DIR, 'assets', 'app.record.json'), 'utf8'));
    assert.deepEqual([rec.take.width, rec.take.height], [640, 360]);
    const [cw, ch] = rec.size.split('x').map(Number);
    assert.deepEqual([cw, ch], [Math.round(640 / rec.scale), Math.round(360 / rec.scale)]);
    assert.ok(rec.take.duration > 1.5 && rec.take.duration < 3.5, `duration ${rec.take.duration}`);
    const down = rec.take.events.find((e) => e.type === 'down');
    assert.deepEqual([down.x, down.y], [Math.round((320 / rec.scale) * 10) / 10, Math.round((180 / rec.scale) * 10) / 10]);
    assert.ok(down.t > 0.3 && down.t < 0.8, `click at ${down.t}`);
    assert.deepEqual(rec.take.marks.map((m) => m.name), ['clicked']);
    assert.match(r.text, /1 click/);
    assert.match(r.text, /camera: 1\.7x/);
    // Frame i was painted at about startedAt + i/30 s
    const times = paintTimes(take);
    assert.ok(Math.abs(times.length - rec.take.duration * 30) <= 2, `${times.length} frames for ${rec.take.duration} s`);
    const off = times.map((v, i) => wrap(v - ((rec.take.startedAt + (i * 1000) / 30) % (1 << 24)))).sort((a, b) => a - b);
    assert.ok(Math.abs(off[off.length >> 1]) < 80, `median paint offset ${off[off.length >> 1]} ms`);
    // The camera page again, closer, without filming
    const lines = A.camera(take, { zoom: '2.5' });
    assert.match(lines.join('\n'), /camera: 2\.5x/);
    assert.equal(JSON.parse(readFileSync(join(DIR, 'assets', 'app.record.json'), 'utf8')).zoom, 2.5);
  } finally {
    w.close();
  }
});

test('from the command line: start returns, the take goes on without it, stop ends it, wait gives it', { skip, timeout: 120_000 }, async () => {
  const w = await testWindow('still');
  try {
    // No stop in the script: the take runs until stop is asked for
    fake('long', ['move 50 50', 'wait 200', 'move 60 60']);
    const take = join(DIR, 'cli', 'long.mp4');
    const s = await cli(['start', take, '--hwnd', String(w.hwnd)]);
    assert.equal(s.status, 0, s.stderr);
    const still = await cli(['wait', take, '--timeout', '2']);
    assert.match(still.stdout, /^still (filming|waiting)/);
    const asked = await cli(['stop', take]);
    assert.match(asked.stdout, /asked to stop/);
    const r = await cli(['wait', take, '--timeout', '60']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /long\.mp4 {2}640 x 360/);
    // A window that never changes still gives the whole length: the last picture is held
    const rec = JSON.parse(readFileSync(join(DIR, 'cli', 'long.record.json'), 'utf8'));
    assert.ok(Math.abs(paintTimes(take).length - rec.take.duration * 30) <= 2);
    const again = await cli(['wait', take]);
    assert.match(again.stdout, /was filmed already/);
  } finally {
    w.close();
  }
});

test('cancel keeps nothing; a window that is not open is an error, not a wait', { skip, timeout: 120_000 }, async () => {
  const w = await testWindow('still');
  try {
    fake('cancel', ['move 50 50', 'wait 200']);
    const take = join(DIR, 'cancel', 'gone.mp4');
    await A.start(take, { hwnd: String(w.hwnd) });
    await new Promise((r) => setTimeout(r, 1500));
    assert.match((await cli(['cancel', take])).stdout, /asked to cancel/);
    const r = await waitDone(take);
    assert.equal(r.code, 1);
    assert.match(r.text, /cancelled/);
    assert.ok(!existsSync(take), 'nothing kept');
  } finally {
    w.close();
  }
  fake('none', ['wait 100', 'stop']);
  const take = join(DIR, 'none', 'none.mp4');
  await A.start(take, { window: 'no-such-window-3f9a' }).catch(() => undefined);
  const r = await waitDone(take);
  assert.equal(r.code, 1);
  assert.match(r.text, /no window matches no-such-window-3f9a/);
});

test('windows lists open windows and the screens', { skip, timeout: 60_000 }, async () => {
  const w = await testWindow('still');
  try {
    const r = await cli(['windows', 'capture test']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /"app-demo capture test" · .* · 640 x 360/);
    assert.match(r.stdout, /Screens:\n {2}1/);
  } finally {
    w.close();
  }
});
