import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const G = createRequire(import.meta.url)("../audio/grid.js");

test("a steady grid round-trips within 10 ms and is tiny", () => {
  const d = Array.from({ length: 120 }, (_, i) => 2.59 + i * 3.25 + (i % 3) * 0.01);
  const enc = G.encode(d), back = G.decode(enc);
  assert.equal(back.length, d.length);
  assert.ok(Math.max(...d.map((x, i) => Math.abs(x - back[i]))) < 0.011);
  assert.ok(JSON.stringify(enc).length < 400, "compact: " + JSON.stringify(enc).length);
});
test("a drifting track falls back to the raw list", () => {
  const d = Array.from({ length: 40 }, (_, i) => i * 3 + (i > 20 ? 6 : 0));
  const enc = G.encode(d); assert.ok(enc.raw); assert.equal(G.decode(enc).length, 40);
});
test("synthesised grid and nearest lookup", () => {
  const g = G.synthesize(0.5, 120, 60); assert.ok(Math.abs(g[1] - g[0] - 2) < 1e-6);
  assert.equal(G.nearest([0, 2, 4, 6], 4.9), 2); assert.equal(G.nearest([0, 2, 4, 6], 5.1), 3);
  assert.equal(G.encode([1]), null); assert.equal(G.decode(null), null);
});
