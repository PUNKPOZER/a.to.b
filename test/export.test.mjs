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
