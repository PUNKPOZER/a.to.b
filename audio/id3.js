/* Minimal ID3v2.3/2.4 reader: title, artist, album and the embedded cover (APIC).
 * Reads only what is in the file; returns {} fields as null when absent. Browser global `Id3` + Node tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Id3 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

  function decode(bytes, enc) {
    if (!bytes.length) return "";
    const td = (label, arr) => new TextDecoder(label).decode(arr);
    let s;
    if (enc === 1) { // UTF-16 with BOM
      const le = !(bytes[0] === 0xfe && bytes[1] === 0xff);
      s = td(le ? "utf-16le" : "utf-16be", bytes.subarray(bytes[0] === 0xff || bytes[0] === 0xfe ? 2 : 0));
    } else if (enc === 2) s = td("utf-16be", bytes);
    else if (enc === 3) s = td("utf-8", bytes);
    else s = td("iso-8859-1", bytes);
    return s.replace(/\0+$/g, "").trim();
  }
  function nullEnd(b, from, enc) { // index of the terminator (1 or 2 bytes) starting at `from`
    if (enc === 1 || enc === 2) { for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i; return b.length; }
    for (let i = from; i < b.length; i++) if (b[i] === 0) return i; return b.length;
  }

  function parse(buffer) {
    const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const out = { title: null, artist: null, album: null, picture: null };
    if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return out; // "ID3"
    const major = b[3], flags = b[5];
    if (major !== 3 && major !== 4) return out;
    const total = Math.min(b.length, 10 + synchsafe(b, 6));
    let o = 10;
    if (flags & 0x40) o += major === 4 ? synchsafe(b, o) : u32(b, o) + 4; // extended header
    while (o + 10 <= total) {
      const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = major === 4 ? synchsafe(b, o + 4) : u32(b, o + 4);
      const body = b.subarray(o + 10, o + 10 + size);
      o += 10 + size;
      if (size <= 0 || body.length < size) continue;
      if (id === "TIT2" || id === "TPE1" || id === "TALB") {
        const v = decode(body.subarray(1), body[0]);
        if (v) out[id === "TIT2" ? "title" : id === "TPE1" ? "artist" : "album"] = v;
      } else if (id === "APIC" && !out.picture) {
        const enc = body[0];
        let p = 1; const mimeEnd = nullEnd(body, p, 0);
        const mime = String.fromCharCode(...body.subarray(p, mimeEnd)) || "image/jpeg";
        p = mimeEnd + 1 + 1; // terminator + picture type
        const dEnd = nullEnd(body, p, enc); p = dEnd + (enc === 1 || enc === 2 ? 2 : 1);
        if (p < body.length) out.picture = { mime: /^image\//.test(mime) ? mime : "image/jpeg", data: body.subarray(p) };
      }
    }
    return out;
  }
  return { parse };
});
