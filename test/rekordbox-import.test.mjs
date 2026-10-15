import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), R = require("../audio/rekordbox-import.js"), X = require("../audio/export.js");

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0"><PRODUCT Name="rekordbox" Version="6.8.5" Company="AlphaTheta"/>
<COLLECTION Entries="4">
 <TRACK TrackID="101" Name="Archangel &amp; Co" Artist="Burial" Album="Untrue" Genre="Dubstep" Kind="MP3 File" Size="7340032" TotalTime="238" AverageBpm="139.50" DateAdded="2026-10-12" Tonality="Am" Location="file://localhost/Users/dj/Music/UKG/Burial%20-%20Archangel.mp3">
  <TEMPO Inizio="0.040" Bpm="139.50" Metro="4/4" Battito="1"/><POSITION_MARK Name="Drop" Type="0" Start="32.5" Num="0"/><POSITION_MARK Name="" Type="0" Start="64.0" Num="-1"/></TRACK>
 <TRACK TrackID="102" Name="Heat" Artist="Sully" Genre="UK Garage" Size="5000" TotalTime="300" AverageBpm="130" Tonality="8B" DateAdded="2026-10-14" Location="file://localhost/C:/Music/Sully%20-%20Heat.wav"/>
 <TRACK TrackID="103" Name="Новый трек" Artist="Артист" Size="9000" TotalTime="200" AverageBpm="126" Tonality="F#m" Location="file://localhost/Users/dj/Music/%D0%BD%D0%BE%D0%B2%D1%8B%D0%B9.flac"/>
 <TRACK TrackID="104" Name="No file" Artist="X"/>
</COLLECTION>
<PLAYLISTS><NODE Type="0" Name="ROOT" Count="2">
 <NODE Name="October" Type="0" Count="1"><NODE Name="UKG Set" Type="1" KeyType="0" Entries="3"><TRACK Key="102"/><TRACK Key="101"/><TRACK Key="103"/></NODE></NODE>
 <NODE Name="Loose" Type="1" KeyType="0" Entries="2"><TRACK Key="101"/><TRACK Key="104"/></NODE>
</NODE></PLAYLISTS></DJ_PLAYLISTS>`;

test("parses collection, playlists, folders, order, cues and converts Tonality / Location", () => {
  const r = R.parse(XML); assert.ok(r.ok);
  assert.equal(r.tracks.size, 4); assert.equal(r.declaredEntries, 4); assert.equal(r.playlistCount, 2);
  const a = r.tracks.get("101");
  assert.equal(a.name, "Archangel & Co"); assert.equal(a.artist, "Burial"); assert.equal(a.bpm, 139.5); assert.equal(a.totalTime, 238); assert.equal(a.camelot, "8A");
  assert.equal(a.path, "/Users/dj/Music/UKG/Burial - Archangel.mp3"); assert.equal(a.dateAdded, new Date(2026, 9, 12).getTime());
  assert.equal(a.cues.length, 2); assert.equal(a.cues[0].num, 0); assert.equal(a.cues[1].num, -1); assert.equal(a.tempo[0].bpm, 139.5);
  assert.equal(r.tracks.get("102").path, "C:\\Music\\Sully - Heat.wav"); assert.equal(r.tracks.get("102").camelot, "8B");
  assert.equal(r.tracks.get("103").path, "/Users/dj/Music/новый.flac"); assert.equal(r.tracks.get("103").camelot, "11A");
  assert.equal(r.tracks.get("104").path, null);
  const folder = r.tree[0], pl = r.tree[1];
  assert.equal(folder.type, "folder"); assert.equal(folder.children[0].name, "UKG Set"); assert.deepEqual(folder.children[0].trackIds, ["102", "101", "103"], "playlist order preserved");
  assert.equal(pl.type, "playlist"); assert.deepEqual(pl.trackIds, ["101", "104"]);
  assert.deepEqual(R.trackIdsFor(r.tree, [folder.id]), ["102", "101", "103"]);
  assert.deepEqual(R.trackIdsFor(r.tree, [folder.id, pl.id]), ["102", "101", "103", "104"], "de-duplicated, order kept");
});
test("not a Rekordbox file / broken input fails cleanly", () => {
  assert.equal(R.parse("<html></html>").ok, false); assert.equal(R.parse("").ok, false);
});
test("round trip: what a.to.b exports, a.to.b imports", () => {
  const tracks = [{ id: "a", artist: "A & B", title: "T <1>", durationSec: 200, bpm: 124, key: { tonic: "A", mode: "min", camelot: "8A" }, filename: "t.mp3", path: "/Music/t 1.mp3", format: "MP3" }, { id: "b", artist: "C", title: "U", durationSec: 180, bpm: 128, key: { tonic: "C", mode: "maj", camelot: "8B" }, filename: "u.mp3", path: "/Music/u.mp3", format: "MP3" }];
  const r = R.parse(X.rekordboxXml(tracks, [null], { name: "My Set", baseDir: "/Music" }));
  assert.ok(r.ok); assert.equal(r.tracks.size, 2);
  const pl = R.flattenPlaylists(r.tree); assert.equal(pl.length, 1); assert.equal(pl[0].name, "My Set"); assert.equal(pl[0].trackIds.length, 2);
  const t1 = r.tracks.get(pl[0].trackIds[0]); assert.equal(t1.artist, "A & B"); assert.equal(t1.name, "T <1>"); assert.equal(t1.path, "/Music/t 1.mp3"); assert.equal(t1.camelot, "8A");
});
test("matching: path / Rekordbox id / name+size are trusted differently; artist+title alone is only 'ambiguous'", () => {
  const r = R.parse(XML), rb = [...r.tracks.values()];
  const lib = [
    { id: "L1", path: "/Users/dj/Music/UKG/Burial - Archangel.mp3", filename: "Burial - Archangel.mp3", artist: "Burial", title: "Archangel & Co", durationSec: 238 },
    { id: "L2", filename: "Sully - Heat.wav", sizeBytes: 5000, artist: "?", title: "?", durationSec: 300 },
    { id: "L3", artist: "Артист", title: "Новый трек", durationSec: 201, filename: "other.flac", sizeBytes: 1 },
    { id: "L4", rekordbox: { trackId: "104", signature: r.signature }, artist: "q", title: "q" },
  ];
  const m = R.matchTracks(rb, lib, r.signature);
  assert.deepEqual(m.get("101"), { status: "linked", by: "path", libraryId: "L1" });
  assert.deepEqual(m.get("102"), { status: "probable", by: "nameSize", libraryId: "L2" });
  assert.equal(m.get("103").status, "ambiguous"); assert.deepEqual(m.get("103").candidates, ["L3"]);
  assert.deepEqual(m.get("104"), { status: "linked", by: "rekordboxId", libraryId: "L4" });
  const other = R.matchTracks(rb, lib, "another-collection"); assert.equal(other.get("104").status, "new", "a TrackID from a different collection is not trusted");
  const s = R.summarize(["101", "102", "103", "104"], r.tracks, m, { "/Users/dj/Music/UKG/Burial - Archangel.mp3": true, "C:\\Music\\Sully - Heat.wav": false });
  assert.deepEqual({ sel: s.selected, linked: s.linked, probable: s.probable, amb: s.ambiguous, newT: s.new, missing: s.missing, already: s.already }, { sel: 4, linked: 2, probable: 1, amb: 1, newT: 0, missing: 1, already: 3 });
  assert.equal(R.summarize(["101"], r.tracks, m, null).missing, null, "availability unknown (browser) is not reported as 0");
});
