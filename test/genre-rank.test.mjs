import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const G = createRequire(import.meta.url)("../audio/genre-rank.js");
const st = (...a) => a.map(([l, s]) => ({ label: "Electronic---" + l, score: s }));

test("Halftime is a feel, not a filing genre: Drum n Bass wins a close call", () => {
  const r = G.rerank(st(["Halftime", 0.45], ["Drum n Bass", 0.40], ["Dubstep", 0.18]));
  assert.equal(G.name(r[0].label), "Drum n Bass"); assert.equal(r[1].rank, 0);
});
test("a clear Halftime track still reports Halftime", () => {
  assert.equal(G.name(G.rerank(st(["Halftime", 0.6], ["Drum n Bass", 0.2]))[0].label), "Halftime");
});
test("everything else keeps the model's order", () => {
  const r = G.rerank(st(["Techno", 0.5], ["House", 0.3], ["Trance", 0.2])); assert.deepEqual(r.map((x) => G.name(x.label)), ["Techno", "House", "Trance"]);
});
