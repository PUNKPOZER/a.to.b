import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const L = createRequire(import.meta.url)("../audio/library-tools.js");
const NOW = new Date(2026, 9, 15, 14, 30).getTime();   // 15 Oct 2026 14:30 local
const day = (d, h = 12) => new Date(2026, 9, d, h).getTime();

test("date presets: today / yesterday / 7 days / 30 days / months / custom", () => {
  const r = (p, c) => L.dateRange(p, NOW, c);
  assert.ok(L.inRange(day(15, 1), r("today"))); assert.ok(!L.inRange(day(14, 23), r("today")));
  assert.ok(L.inRange(day(14), r("yesterday"))); assert.ok(!L.inRange(day(15), r("yesterday")));
  assert.ok(L.inRange(day(9, 0), r("7d"))); assert.ok(!L.inRange(day(8, 23), r("7d")));
  assert.ok(L.inRange(day(1), r("thisMonth"))); assert.ok(L.inRange(new Date(2026, 8, 30).getTime(), r("lastMonth")));
  assert.ok(L.inRange(day(5), r("custom", { from: day(5), to: day(7) }))); assert.ok(L.inRange(day(7, 23), r("custom", { from: day(5), to: day(7) })));
  assert.ok(!L.inRange(null, r("7d")), "a track without a date is never 'recent'");
});
test("Camelot selections: single, ranges, wrap-around, both letters", () => {
  assert.deepEqual([...L.parseCamelot("8A")], ["8A"]);
  assert.deepEqual([...L.parseCamelot("4A-7A")].sort(), ["4A", "5A", "6A", "7A"]);
  assert.deepEqual([...L.parseCamelot("11A-2A")].sort(), ["11A", "12A", "1A", "2A"].sort());
  assert.equal(L.parseCamelot("4-5").size, 4);
  assert.deepEqual([...L.parseCamelot("8A, 9B")].sort(), ["8A", "9B"]);
  assert.equal(L.parseCamelot("13A").size, 0);
});
const T = (o) => ({ ...o, id: o.id, artist: o.artist || "Artist", title: o.title || "Title", album: o.album || "", genre: { primary: o.genre || "House" }, bpm: o.bpm || 126, key: { camelot: o.key || "8A" }, profile: { energy: o.energy ?? 60 }, filename: o.filename || o.id + ".mp3" });
test("one engine: structured filters + free text + field prefixes", () => {
  const lib = [T({ id: "a", artist: "Sully", title: "Heat", genre: "UK Garage", bpm: 130, key: "5A", energy: 70, dateAddedToAToB: day(14) }), T({ id: "b", artist: "Burial", title: "Archangel", genre: "Dubstep", bpm: 138, key: "9A", dateAddedToAToB: day(1) }), T({ id: "c", artist: "Four Tet", title: "Heat Haze", genre: "House", bpm: 120, key: "5A", dateAddedToAToB: null })];
  const ids = (f) => L.filterTracks(lib, f).map((t) => t.id);
  assert.deepEqual(ids({ genres: ["UK Garage", "Dubstep"] }), ["a", "b"]);
  assert.deepEqual(ids({ bpmMin: 125, bpmMax: 135 }), ["a"]);
  assert.deepEqual(ids({ keys: L.parseCamelot("4A-7A") }), ["a", "c"]);
  assert.deepEqual(ids({ energyMin: 65 }), ["a"]);
  assert.deepEqual(ids({ query: "heat" }), ["a", "c"]);
  assert.deepEqual(ids({ query: "artist:burial" }), ["b"]);
  assert.deepEqual(ids({ query: "bpm:128-140 key:9A" }), ["b"]);
  assert.deepEqual(ids({ query: "130" }), ["a"]);
  assert.deepEqual(ids({ dateFrom: day(10), dateTo: day(16) }), ["a"]);
  assert.deepEqual(ids({ genres: ["House"], dateFrom: day(1) }), [], "unknown date never matches a date filter");
  assert.deepEqual(ids({}), ["a", "b", "c"]);
});
test("migration fills missing fields, never invents a date, never overwrites", () => {
  const lib = [{ id: "a", analyzedAt: 1700000000000 }, { id: "b" }, { id: "c", analyzedAt: 1, dateAddedToAToB: 5, importBatchId: "x" }];
  const r = L.migrate(lib);
  assert.equal(lib[0].dateAddedToAToB, 1700000000000); assert.equal(lib[0].dateAddedKind, "analyzedAt");
  assert.equal(lib[1].dateAddedToAToB, null); assert.equal(lib[1].dateAddedKind, "unknown");
  assert.equal(lib[2].dateAddedToAToB, 5); assert.equal(lib[2].importBatchId, "x");
  assert.deepEqual(r, { filled: 1, unknown: 1 });
  assert.deepEqual(L.migrate(lib), { filled: 0, unknown: 0 }, "idempotent");
});
test("folder grouping keeps original folder names and dates; sorting handles unknown dates", () => {
  const lib = [T({ id: "a", relPath: "UK GARAGE/a.mp3", dateAddedToAToB: day(14), sourceType: "folder" }), T({ id: "b", relPath: "UK GARAGE/sub/b.mp3", dateAddedToAToB: day(13) }), T({ id: "c", relPath: "BREAKBEAT/c.mp3", dateAddedToAToB: day(15) }), T({ id: "d", filename: "d.mp3", dateAddedToAToB: null })];
  const g = L.groupFolders(lib);
  assert.equal(g[0].name, "BREAKBEAT"); assert.equal(g.find((x) => x.name === "UK GARAGE").count, 1); assert.equal(g.find((x) => x.name === "sub").count, 1);
  assert.equal(g[g.length - 1].name, null, "no folder known -> its own group, last");
  assert.deepEqual(L.sortTracks(lib, "added", -1).map((t) => t.id), ["c", "a", "b", "d"]);
  assert.equal(L.dayBucket(NOW, NOW), "today"); assert.equal(L.dayBucket(day(14), NOW), "yesterday"); assert.equal(L.dayBucket(null, NOW), "unknown");
});
