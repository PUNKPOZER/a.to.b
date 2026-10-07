import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), LG = require("../audio/local-grid.js");

// synthetic 4/4 track: kick on every beat (louder on beat 1 of each bar), quiet first 8 bars and last 8 bars
function synth({ bpm = 120, offset = 0.37, dur = 100, sr = 22050 } = {}) {
  const n = Math.floor(sr * dur), x = new Float32Array(n), beat = 60 / bpm, bar = beat * 4;
  for (let k = 0; ; k++) {
    const t0 = offset + k * beat; if (t0 >= dur - 0.3) break;
    const barIdx = Math.floor((t0 - offset) / bar), quiet = barIdx < 8 || t0 > dur - 8 * bar, amp = (quiet ? 0.25 : 0.8) * (k % 4 === 0 ? 1 : 0.6);
    for (let i = 0; i < sr * 0.18; i++) { const idx = Math.floor(t0 * sr) + i; if (idx < n) x[idx] += amp * Math.sin(2 * Math.PI * (45 + 90 * Math.exp(-i / sr * 30)) * (i / sr)) * Math.exp(-i / sr * 14); }
  }
  return x;
}
test("finds the beat phase, the bar line and the quiet intro/outro", () => {
  const sr = 22050, r = LG.analyze(synth({ bpm: 120, offset: 0.37 }), sr, 120);
  assert.ok(r, "analysis returned");
  const d = r.downbeats; assert.ok(d.length > 20);
  const ph = (((d[0] - 0.37) % 2) + 2) % 2; assert.ok(Math.min(ph, 2 - ph) < 0.05, "first downbeat " + d[0]);
  const bar = (d[d.length - 1] - d[0]) / (d.length - 1); assert.ok(Math.abs(bar - 2) < 0.02, "bar " + bar);
  assert.equal(r.segments[0].label, "intro"); assert.equal(r.segments[r.segments.length - 1].label, "outro");
  assert.ok(r.segments.some((s) => s.label === "high"));
});
test("follows a slightly wrong BPM without drifting off the kicks", () => {
  const r = LG.analyze(synth({ bpm: 126, offset: 0.2 }), 22050, 125.6);
  const d = r.downbeats, expect = (i) => 0.2 + i * (240 / 126), i = d.length - 3;
  assert.ok(Math.abs(d[i] - (expect(i) + 0)) < 0.12 || Math.abs((d[i] - 0.2) % (240 / 126)) < 0.12 || Math.abs((d[i] - 0.2) % (240 / 126) - 240 / 126) < 0.12, "late downbeat off the grid: " + d[i]);
});
test("too short or no tempo -> null (nothing invented)", () => {
  assert.equal(LG.analyze(new Float32Array(22050 * 5), 22050, 120), null);
  assert.equal(LG.analyze(synth(), 22050, 0), null);
});
