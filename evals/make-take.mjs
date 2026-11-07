#!/usr/bin/env node
// Films a take of the repo's test window with scripted pointer input: node evals/make-take.mjs evals/takes/take1.json <out dir>
// Windows, FFmpeg 8 or later. The pointer is scripted, so no real mouse or desktop is driven. The window opens at the
// bottom right of the main screen, at the bottom of the stack.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [scenarioFile, outDir] = process.argv.slice(2);
if (!scenarioFile || !outDir) throw new Error('usage: make-take.mjs <scenario.json> <out dir>');
const sc = JSON.parse(readFileSync(scenarioFile, 'utf8'));
process.env.APP_DEMO_HOME ??= join(tmpdir(), 'app-demo-eval');
const A = await import(pathToFileURL(resolve(import.meta.dirname, '..', 'skills', 'app-demo', 'scripts', 'record-app.mjs')).href);

// Seeded noise, so a hand's jitter is the same on every run
let seed = sc.seed ?? 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k));

// Scenario steps to the helper's scripted input lines
const lines = [];
let at = [sc.start[0], sc.start[1]];
const emit = (x, y) => lines.push(`move ${Math.round(x)} ${Math.round(y)}`);
lines.push(`move ${at[0]} ${at[1]}`);
for (const s of sc.steps) {
  if (s.wait) lines.push(`wait ${s.wait}`);
  else if (s.mark) lines.push('mark');
  else if (s.go) {
    const [tx, ty] = s.go;
    const n = Math.max(2, Math.round((s.over ?? 700) / 28));
    // A slight arc, so the path is not a ruler line
    const nx = -(ty - at[1]);
    const ny = tx - at[0];
    const len = Math.hypot(nx, ny) || 1;
    const bend = Math.min(60, len * 0.08) * (s.bend ?? 1);
    for (let i = 1; i <= n; i++) {
      const k = ease(i / n);
      const arc = Math.sin(Math.PI * k) * bend;
      emit(at[0] + (tx - at[0]) * k + (nx / len) * arc + rnd() * 1.2, at[1] + (ty - at[1]) * k + (ny / len) * arc + rnd() * 1.2);
      lines.push('wait 28');
    }
    at = [tx, ty];
  } else if (s.click) lines.push(`down ${at[0]} ${at[1]}`, 'wait 90', `up ${at[0]} ${at[1]}`);
  else if (s.jiggle) {
    for (let i = 0; i < s.jiggle; i++) {
      emit(at[0] + rnd() * 6, at[1] + rnd() * 6);
      lines.push('wait 60');
    }
  }
}
lines.push('wait 600', 'stop');
mkdirSync(outDir, { recursive: true });
const fakeFile = join(tmpdir(), `app-demo-eval-${sc.name}.txt`);
writeFileSync(fakeFile, lines.join('\n'));
process.env.APP_DEMO_FAKE = fakeFile;

// The test window, closed by its own pid at the end
const win = spawn(A.helperExe(), ['testwin', String(sc.w), String(sc.h), '240', sc.kind ?? 'anim']);
const info = await new Promise((ok) => win.stdout.once('data', (d) => ok(JSON.parse(String(d)))));
try {
  const take = join(resolve(outDir), `${sc.name}.mp4`);
  await A.start(take, { hwnd: String(info.hwnd), marks: sc.marks.join(',') });
  for (;;) {
    const r = await A.wait(take, { timeout: 30 });
    if (!/^still /.test(r.text)) {
      console.log(r.text);
      break;
    }
  }
} finally {
  win.kill();
}
