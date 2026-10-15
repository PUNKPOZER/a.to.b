import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const E = createRequire(import.meta.url)("../audio/export.js");

const T = (o) => ({ id: o.id, artist: o.artist ?? "Artist", title: o.title ?? "Track", filename: o.filename, relPath: o.relPath, path: o.path, durationSec: o.dur ?? 300, bpm: o.bpm ?? 128, key: o.key ?? { tonic: "A", mode: "min", camelot: "8A" }, format: o.format ?? "MP3", sampleRate: 44100 });
const tracks = [T({ id: "1", artist: "Лучший Друг", title: "Танцевать", filename: "Лучший Друг - Танцевать.mp3" }), T({ id: "2", artist: "Mr. Oizo", title: "Flat & Beat <edit>", filename: "Flat Beat (Radio Edit).mp3" }), T({ id: "3", filename: "c.mp3" })];
const tr = [{ mixOutTime: 270.5, mixInTime: 1.2, bars: 32, type: "long_blend", compatibility: 86.4, confidence: "high", mixOut: { section: "outro", bar: 129 }, mixIn: { section: "intro", bar: 1 } }, null];

test("M3U8 keeps order, spaces, Cyrillic and both path styles", () => {
  const mac = E.m3u8(tracks, { baseDir: "/Users/dj/Music/My Crate", name: "Set" }).split("\n");
  assert.equal(mac[0], "#EXTM3U"); assert.equal(mac[3], "/Users/dj/Music/My Crate/Лучший Друг - Танцевать.mp3"); assert.ok(mac[2].startsWith("#EXTINF:300,Лучший Друг — Танцевать"));
  assert.equal(mac[5], "/Users/dj/Music/My Crate/Flat Beat (Radio Edit).mp3"); assert.equal(mac.indexOf("/Users/dj/Music/My Crate/c.mp3") > mac.indexOf(mac[5]), true);
  const win = E.m3u8(tracks, { baseDir: "C:\\Users\\DJ\\Music" }).split("\n");
  assert.equal(win[3], "C:\\Users\\DJ\\Music\\Лучший Друг - Танцевать.mp3");
});
test("folder imports keep their sub-folders; the desktop app's real path wins", () => {
  const t = [T({ id: "9", filename: "x.mp3", relPath: "Crate/Techno/x.mp3" }), T({ id: "8", filename: "y.mp3", path: "/Volumes/SSD/y.mp3" })];
  const l = E.m3u8(t, { baseDir: "/Users/dj/Music" }).split("\n");
  assert.equal(l[3], "/Users/dj/Music/Crate/Techno/x.mp3"); assert.equal(l[5], "/Volumes/SSD/y.mp3");
});
test("Rekordbox Location is a file://localhost URI with every segment encoded", () => {
  assert.equal(E.rekordboxLocation("/Users/dj/Music/Лучший Друг.mp3"), "file://localhost/Users/dj/Music/%D0%9B%D1%83%D1%87%D1%88%D0%B8%D0%B9%20%D0%94%D1%80%D1%83%D0%B3.mp3");
  assert.equal(E.rekordboxLocation("C:\\Music\\a b.mp3"), "file://localhost/C:/Music/a%20b.mp3");
});
test("Rekordbox XML follows the documented structure and escapes text", () => {
  const x = E.rekordboxXml(tracks, tr, { baseDir: "/Users/dj/Music", name: "My <set>" });
  assert.ok(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<DJ_PLAYLISTS Version="1.0.0">'));
  assert.ok(x.includes('<COLLECTION Entries="3">')); assert.ok(x.includes('Name="Flat &amp; Beat &lt;edit&gt;"'));
  assert.ok(x.includes('<NODE Type="0" Name="ROOT" Count="1">')); assert.ok(x.includes('Name="My &lt;set&gt;" Type="1" KeyType="0" Entries="3"'));
  assert.equal((x.match(/<TRACK Key="/g) || []).length, 3);
  assert.ok(x.includes('Tonality="Am"')); assert.ok(x.includes('TotalTime="300"'));
  // transition mix points become memory cues (Type 0, Num -1) on the right tracks
  assert.ok(/<POSITION_MARK Name="a\.to\.b out → Flat &amp; Beat &lt;edit&gt;" Type="0" Start="270.5" Num="-1"\/>/.test(x));
  assert.ok(/<POSITION_MARK Name="a\.to\.b in ← Танцевать" Type="0" Start="1.2" Num="-1"\/>/.test(x));
  // balanced tags
  const open = (x.match(/<(?:DJ_PLAYLISTS|COLLECTION|PLAYLISTS|NODE)(?:\s[^>]*[^/])?>/g) || []).length, close = (x.match(/<\/(DJ_PLAYLISTS|COLLECTION|PLAYLISTS|NODE)>/g) || []).length;
  assert.equal(open, close);
});
test("the same track twice is listed once in the collection, twice in the playlist", () => {
  const x = E.rekordboxXml([tracks[0], tracks[1], tracks[0]], null, { baseDir: "/m" });
  assert.ok(x.includes('<COLLECTION Entries="2">')); assert.equal((x.match(/<TRACK Key="1"\/>/g) || []).length, 2);
});
test("beat grid and cues are optional", () => {
  const t = [{ ...tracks[0], grid: { first: 0.5 } }, tracks[1]];
  assert.ok(!E.rekordboxXml(t, tr, { baseDir: "/m" }).includes("<TEMPO"));
  assert.ok(E.rekordboxXml(t, tr, { baseDir: "/m", beatGrid: true }).includes('<TEMPO Inizio="0.5" Bpm="128" Metro="4/4" Battito="1"/>'));
  assert.ok(!E.rekordboxXml(t, tr, { baseDir: "/m", cues: false }).includes("POSITION_MARK"));
});
test("tracklist matches the requested layout; transition sheet carries the mix points", () => {
  const txt = E.tracklist(tracks, tr, { name: "Friday" }).split("\n");
  assert.equal(txt[0], "a.to.b — Friday"); assert.equal(txt[2], "01. Лучший Друг — Танцевать [128 BPM · 8A]"); assert.equal(txt[3], "    → 32 bars · outro → intro");
  const sheet = E.transitionSheetText(E.transitionSheet(tracks, tr, { name: "Friday" }));
  assert.ok(sheet.includes("01 → 02") && sheet.includes("mix out 04:31") && sheet.includes("32 bars · long_blend · 86%"));
  assert.equal(JSON.parse(E.FORMATS.sheetjson.build({ tracks, transitions: tr, name: "F" })).rows.length, 2);
});
test("validation: missing location, duplicates and unsupported formats are reported", () => {
  const v = E.validate([tracks[0], T({ id: "4", filename: "d.ogg", format: "OGG" }), tracks[0]], {});
  const codes = v.issues.map((i) => i.code);
  assert.ok(codes.includes("noLocation") && codes.includes("duplicate") && codes.includes("unsupportedFormat")); assert.equal(v.ok, false);
  assert.equal(E.validate(tracks, { baseDir: "/m" }).ok, true);
});

test("2.0: original Rekordbox cues, DateAdded and trusted paths survive an export; assumed paths are flagged", async () => {
  const req = (await import("node:module")).createRequire(import.meta.url), X = req("../audio/export.js"), R = req("../audio/rekordbox-import.js");
  const tracks = [
    { id: "a", artist: "A", title: "T", durationSec: 200, bpm: 124, key: { tonic: "A", mode: "min", camelot: "8A" }, filename: "t.mp3", path: "/Users/dj/Music/t.mp3", pathSource: "xml", sourceDateAdded: new Date(2026, 9, 12).getTime(), sourceCues: [{ name: "Drop", type: 0, start: 32.5, num: 0 }, { name: "", type: 4, start: 64, end: 72, num: -1 }] },
    { id: "b", artist: "B", title: "U", durationSec: 180, bpm: 128, key: { tonic: "C", mode: "maj", camelot: "8B" }, filename: "u.mp3", relPath: "set/u.mp3", pathSource: "base" },
  ];
  const xml = X.rekordboxXml(tracks, [null], { baseDir: "/Music", name: "S" }), p = R.parse(xml), t1 = p.tracks.get("1");
  assert.ok(p.ok); assert.equal(t1.cues.length, 2); assert.equal(t1.cues[0].num, 0); assert.equal(t1.cues[1].type, 4); assert.equal(t1.cues[1].end, 72);
  assert.equal(t1.dateAdded, new Date(2026, 9, 12).getTime()); assert.equal(t1.path, "/Users/dj/Music/t.mp3");
  assert.equal(R.parse(X.rekordboxXml(tracks, [null], { baseDir: "/Music", sourceCues: false })).tracks.get("1").cues.length, 0, "can be switched off");
  const v = X.validate(tracks, { baseDir: "/Music" });
  assert.ok(v.ok, "assumed paths do not block"); assert.deepEqual(v.issues.map((i) => [i.code, i.info === true]), [["pathAssumed", true]]);
});

test("2.0: several sets in one Rekordbox file: shared collection, one folder, every playlist in order", async () => {
  const req = (await import("node:module")).createRequire(import.meta.url), X = req("../audio/export.js"), R = req("../audio/rekordbox-import.js");
  const tr = (id, bpm) => ({ id, artist: "A" + id, title: "T" + id, durationSec: 200, bpm, key: { tonic: "A", mode: "min", camelot: "8A" }, filename: id + ".mp3", path: "/M/" + id + ".mp3", format: "MP3" });
  const a = tr("a", 120), b = tr("b", 122), c = tr("c", 124), mix = { mixOutTime: 150, mixInTime: 8, bars: 16, type: "long_blend" };
  const xml = X.rekordboxPlaylistsXml([{ name: "Set 1", tracks: [a, b, c], transitions: [mix, mix] }, { name: "Set 2", tracks: [c, a], transitions: [mix] }], { folder: "a.to.b" });
  const r = R.parse(xml); assert.ok(r.ok);
  assert.equal(r.tracks.size, 3, "a track used in two sets appears once"); assert.equal(r.playlistCount, 2);
  assert.equal(r.tree[0].type, "folder"); assert.equal(r.tree[0].name, "a.to.b");
  const pls = R.flattenPlaylists(r.tree), names = pls.map((p) => p.name); assert.deepEqual(names, ["Set 1", "Set 2"]);
  const art = (p) => p.trackIds.map((id) => r.tracks.get(id).artist); assert.deepEqual(art(pls[0]), ["Aa", "Ab", "Ac"]); assert.deepEqual(art(pls[1]), ["Ac", "Aa"]);
  const cuesA = r.tracks.get(pls[0].trackIds[0]).cues; assert.ok(cuesA.length >= 2, "memory cues from both sets, no exact duplicates");
  assert.equal(X.rekordboxXml([a], [null], { name: "One" }).includes('Name="a.to.b" Type="0"'), false, "the single-set file has no folder");
});
