/* Rekordbox XML import: parses the interchange file AlphaTheta documents as "XML file format for playlists sharing" (v1.0.0)
 * — COLLECTION/TRACK, TEMPO, POSITION_MARK and the PLAYLISTS/NODE tree — and matches its tracks against the a.to.b library.
 * Pure functions (browser global `RekordboxImport` + Node tests). Nothing here touches Rekordbox's own database.
 *
 * Matching never merges on artist/title alone:
 *   linked    — same file path, or same Rekordbox TrackID inside the same collection (`signature`)         -> safe to link
 *   probable  — same file name AND same size                                                                -> link after confirmation
 *   ambiguous — artist + title (+ similar duration) only                                                    -> the user decides
 *   new       — nothing in the library matches                                                              -> import as a new track        */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RekordboxImport = factory();
})(typeof self !== "undefined" ? self : this, function () {
  /* ---------- tiny tolerant XML parser (elements + attributes; entities decoded) ---------- */
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m));
  function parseXml(text) {
    const rootEl = { name: "#root", attrs: {}, children: [] }, stack = [rootEl];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
      if (!m[2]) continue;
      const attrs = {}; for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
      const el = { name: m[2], attrs, children: [] }; stack[stack.length - 1].children.push(el);
      if (!m[4]) stack.push(el);
    }
    return rootEl;
  }
  const kids = (el, name) => el.children.filter((c) => c.name === name);

  /* ---------- value converters ---------- */
  const FLAT = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
  const MAJ = { 0: 8, 1: 3, 2: 10, 3: 5, 4: 12, 5: 7, 6: 2, 7: 9, 8: 4, 9: 11, 10: 6, 11: 1 }, MIN = { 0: 5, 1: 12, 2: 7, 3: 2, 4: 9, 5: 4, 6: 11, 7: 6, 8: 1, 9: 8, 10: 3, 11: 10 };
  function tonalityToCamelot(s) {
    if (!s) return null; s = String(s).trim();
    const c = /^(\d{1,2})([ABab])$/.exec(s); if (c && +c[1] >= 1 && +c[1] <= 12) return +c[1] + c[2].toUpperCase();
    const m = /^([A-G][#b]?)(m|min|minor)?$/.exec(s); if (!m || FLAT[m[1]] == null) return null;
    return m[2] ? MIN[FLAT[m[1]]] + "A" : MAJ[FLAT[m[1]]] + "B";
  }
  // file://localhost/Users/me/Music/a%20b.mp3  ->  /Users/me/Music/a b.mp3 ;  file://localhost/C:/Music/x.mp3 -> C:\Music\x.mp3
  function locationToPath(loc) {
    if (!loc) return null;
    let p = String(loc).replace(/^file:\/\/(localhost)?/i, ""); try { p = decodeURIComponent(p); } catch (e) {}
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1).replace(/\//g, "\\");
    else if (/^\/\//.test(p)) p = "\\\\" + p.slice(2).replace(/\//g, "\\");
    return p || null;
  }
  const baseName = (p) => String(p || "").split(/[\\/]/).pop();
  const normPath = (p) => (p ? String(p).replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase() : null);
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const dateMs = (s) => { if (!s) return null; const d = Date.parse(String(s).length === 10 ? s + "T00:00:00" : s); return Number.isFinite(d) ? d : null; };

  /* ---------- parse ---------- */
  function parse(text) {
    let doc; try { doc = parseXml(String(text)); } catch (e) { return { ok: false, error: "xml" }; }
    const dj = doc.children.find((c) => c.name === "DJ_PLAYLISTS");
    if (!dj) return { ok: false, error: "notRekordbox" };
    const product = kids(dj, "PRODUCT")[0], coll = kids(dj, "COLLECTION")[0], pls = kids(dj, "PLAYLISTS")[0];
    const tracks = new Map();
    for (const el of coll ? kids(coll, "TRACK") : []) {
      const a = el.attrs, id = a.TrackID; if (id == null) continue;
      const loc = a.Location || null, tempo = kids(el, "TEMPO").map((x) => ({ inizio: num(x.attrs.Inizio), bpm: num(x.attrs.Bpm), metro: x.attrs.Metro || null, battito: num(x.attrs.Battito) }));
      tracks.set(String(id), {
        id: String(id), name: a.Name || "", artist: a.Artist || "", album: a.Album || "", genre: a.Genre || "", kind: a.Kind || "", label: a.Label || "", remixer: a.Remixer || "", year: num(a.Year), comments: a.Comments || "",
        size: num(a.Size), totalTime: num(a.TotalTime), bpm: num(a.AverageBpm), tonality: a.Tonality || null, camelot: tonalityToCamelot(a.Tonality) || (a.Comments && /^\s*(\d{1,2}[AB])\b/i.exec(a.Comments) ? tonalityToCamelot(/^\s*(\d{1,2}[AB])\b/i.exec(a.Comments)[1]) : null),
        dateAdded: dateMs(a.DateAdded), sampleRate: num(a.SampleRate), bitRate: num(a.BitRate), location: loc, path: locationToPath(loc),
        tempo, cues: kids(el, "POSITION_MARK").map((x) => ({ name: x.attrs.Name || "", type: num(x.attrs.Type), start: num(x.attrs.Start), end: num(x.attrs.End), num: num(x.attrs.Num) })),
      });
    }
    const unreadable = [];
    const walk = (node, path) => {
      const t = node.attrs.Type;
      if (t === "1") { // playlist
        const ids = kids(node, "TRACK").map((x) => x.attrs.Key).filter((k) => k != null).map(String);
        const keyType = node.attrs.KeyType;
        if (keyType === "1") unreadable.push(node.attrs.Name);   // location keys: not supported, reported instead of guessed
        return { type: "playlist", id: path.concat(node.attrs.Name || "").join("/"), name: node.attrs.Name || "", trackIds: keyType === "1" ? [] : ids, keyType: keyType || "0" };
      }
      return { type: "folder", id: path.concat(node.attrs.Name || "").join("/"), name: node.attrs.Name || "", children: kids(node, "NODE").map((c) => walk(c, path.concat(node.attrs.Name || ""))) };
    };
    const rootNode = pls ? kids(pls, "NODE")[0] : null;
    const tree = rootNode ? kids(rootNode, "NODE").map((n) => walk(n, ["ROOT"])) : [];
    let playlistCount = 0; (function c(ns) { for (const n of ns) { if (n.type === "playlist") playlistCount++; else c(n.children); } })(tree);
    // signature of this collection: stable across re-exports of the same library, so TrackIDs can be trusted within it
    const sample = [...tracks.values()].slice(0, 25).map((t) => normPath(t.path) || t.id).join("|");
    let h = 5381; for (let i = 0; i < sample.length; i++) h = ((h << 5) + h + sample.charCodeAt(i)) >>> 0;
    return { ok: true, product: product ? { name: product.attrs.Name || "", version: product.attrs.Version || "" } : null, tracks, tree, playlistCount, unreadablePlaylists: unreadable,
      signature: "rb" + h.toString(16) + "_" + tracks.size, declaredEntries: coll ? num(coll.attrs.Entries) : null };
  }

  const flattenPlaylists = (tree) => { const out = []; (function c(ns, parents) { for (const n of ns) { if (n.type === "playlist") out.push({ ...n, parents }); else c(n.children, parents.concat(n.name)); } })(tree, []); return out; };
  // all track ids under a selection of tree node ids (folders include their playlists), in playlist order, de-duplicated
  function trackIdsFor(tree, nodeIds) {
    const want = new Set(nodeIds), seen = new Set(), out = [];
    const take = (n) => { if (n.type === "playlist") n.trackIds.forEach((id) => { if (!seen.has(id)) { seen.add(id); out.push(id); } }); else n.children.forEach(take); };
    (function c(ns) { for (const n of ns) { if (want.has(n.id)) take(n); else if (n.type === "folder") c(n.children); } })(tree);
    return out;
  }

  /* ---------- matching ---------- */
  // library track fields used: id, path, filename, sizeBytes, artist, title, durationSec, rekordbox:{trackId, signature, path}
  function matchTracks(rbTracks, library, signature) {
    const byPath = new Map(), byRb = new Map(), bySig = new Map(), byAT = new Map();
    for (const l of library) {
      for (const p of [l.path, l.rekordbox && l.rekordbox.path]) { const n = normPath(p); if (n) byPath.set(n, l); }
      if (l.rekordbox && l.rekordbox.signature === signature && l.rekordbox.trackId != null) byRb.set(String(l.rekordbox.trackId), l);
      if (l.filename && l.sizeBytes) bySig.set(l.filename.toLowerCase() + "|" + l.sizeBytes, l);
      const k = (String(l.artist || "").trim() + "|" + String(l.title || "").trim()).toLowerCase(); if (k !== "|") { if (!byAT.has(k)) byAT.set(k, []); byAT.get(k).push(l); }
    }
    const out = new Map();
    for (const r of rbTracks) {
      const p = normPath(r.path);
      let m = p && byPath.get(p);
      if (m) { out.set(r.id, { status: "linked", by: "path", libraryId: m.id }); continue; }
      m = byRb.get(r.id);
      if (m) { out.set(r.id, { status: "linked", by: "rekordboxId", libraryId: m.id }); continue; }
      m = r.size && r.path ? bySig.get(baseName(r.path).toLowerCase() + "|" + r.size) : null;
      if (m) { out.set(r.id, { status: "probable", by: "nameSize", libraryId: m.id }); continue; }
      const cands = (byAT.get((String(r.artist).trim() + "|" + String(r.name).trim()).toLowerCase()) || []).filter((c) => r.totalTime == null || c.durationSec == null || Math.abs(c.durationSec - r.totalTime) <= 3);
      if (cands.length) { out.set(r.id, { status: "ambiguous", by: "artistTitle", candidates: cands.map((c) => c.id) }); continue; }
      out.set(r.id, { status: "new" });
    }
    return out;
  }
  function summarize(ids, rbTracks, matches, exists) {
    const s = { selected: ids.length, new: 0, linked: 0, probable: 0, ambiguous: 0, missing: null, noLocation: 0 };
    for (const id of ids) {
      const m = matches.get(id); if (m) s[m.status === "new" ? "new" : m.status]++;
      const r = rbTracks.get(id); if (!r || !r.path) s.noLocation++;
    }
    if (exists) { s.missing = 0; for (const id of ids) { const r = rbTracks.get(id); if (r && r.path && exists[r.path] === false) s.missing++; } }
    s.already = s.linked + s.probable;
    return s;
  }
  return { parseXml, parse, tonalityToCamelot, locationToPath, flattenPlaylists, trackIdsFor, matchTracks, summarize, normPath, baseName };
});
