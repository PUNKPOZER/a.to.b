import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { parse } = createRequire(import.meta.url)("../audio/id3.js");

function ss(n) { return [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]; }
function frame(id, body, v4 = true) { const sz = body.length; return [...Buffer.from(id), ...(v4 ? ss(sz) : [(sz >>> 24) & 255, (sz >>> 16) & 255, (sz >>> 8) & 255, sz & 255]), 0, 0, ...body]; }
const text = (s, enc = 3) => [enc, ...Buffer.from(s, "utf8")];
function tag(frames, major = 4) { const body = frames.flat(); return Uint8Array.from([0x49, 0x44, 0x33, major, 0, 0, ...ss(body.length), ...body]); }

test("reads title / artist (utf-8) and cover", () => {
  const img = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
  const apic = [3, ...Buffer.from("image/jpeg"), 0, 3, ...Buffer.from("cover"), 0, ...img];
  const r = parse(tag([frame("TIT2", text("Тропинка")), frame("TPE1", text("Ilya")), frame("APIC", apic)]));
  assert.equal(r.title, "Тропинка"); assert.equal(r.artist, "Ilya");
  assert.equal(r.picture.mime, "image/jpeg"); assert.deepEqual([...r.picture.data], img);
});
test("v2.3 frame sizes and latin-1", () => {
  const r = parse(tag([frame("TIT2", [0, ...Buffer.from("Flat Beat", "latin1")], false)], 3));
  assert.equal(r.title, "Flat Beat");
});
test("no tag / garbage -> nulls, never throws", () => {
  assert.deepEqual(parse(new Uint8Array([1, 2, 3])), { title: null, artist: null, album: null, picture: null });
  assert.equal(parse(new Uint8Array(40)).title, null);
});
