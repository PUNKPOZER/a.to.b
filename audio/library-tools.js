/* Library tools: one filter / search engine shared by Library, Explore and the Smart Set Builder, plus import-date helpers,
 * folder grouping and the safe migration of tracks that were imported before import history existed.
 * Pure functions (browser global `LibraryTools` + Node tests). Nothing here invents data: a track without a reliable
 * timestamp keeps `dateAddedToAToB: null` and is reported as "import date unknown". */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LibraryTools = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const DAY = 86400000;
  const PRESETS = ["today", "yesterday", "7d", "30d", "thisMonth", "lastMonth", "custom"];
  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

  // [from, to) in local time; to = null means "no upper bound"
  function dateRange(preset, now = Date.now(), custom = {}) {
    const s = startOfDay(now), d = new Date(now);
    switch (preset) {
      case "today": return { from: s, to: s + DAY };
      case "yesterday": return { from: s - DAY, to: s };
      case "7d": return { from: s - 6 * DAY, to: s + DAY };
      case "30d": return { from: s - 29 * DAY, to: s + DAY };
      case "thisMonth": return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
      case "lastMonth": return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), to: new Date(d.getFullYear(), d.getMonth(), 1).getTime() };
      case "custom": return { from: custom.from != null ? startOfDay(custom.from) : null, to: custom.to != null ? startOfDay(custom.to) + DAY : null };
      default: return { from: null, to: null };
    }
  }
  const inRange = (ms, r) => ms != null && (r.from == null || ms >= r.from) && (r.to == null || ms < r.to);

  /* ---- Camelot selections: "8A", "4A-7A", "4-7" (both letters), comma / space separated ---- */
  const CODE = /^(\d{1,2})([AB])$/i;
  function parseCamelot(str) {
    const out = new Set(); if (!str) return out;
    for (const raw of String(str).split(/[,\s;]+/).filter(Boolean)) {
      const m = /^(\d{1,2})([AB])?\s*[-–—]\s*(\d{1,2})([AB])?$/i.exec(raw), one = CODE.exec(raw);
      if (m) {
        const a = +m[1], b = +m[3]; if (a < 1 || a > 12 || b < 1 || b > 12) continue;
        const letters = m[2] && m[4] ? (m[2].toUpperCase() === m[4].toUpperCase() ? [m[2].toUpperCase()] : ["A", "B"]) : m[2] ? [m[2].toUpperCase()] : m[4] ? [m[4].toUpperCase()] : ["A", "B"];
        for (let i = a, n = 0; n < 12; n++, i = (i % 12) + 1) { for (const L of letters) out.add(i + L); if (i === b) break; }   // wraps around: 11A-2A
      } else if (one && +one[1] >= 1 && +one[1] <= 12) out.add(+one[1] + one[2].toUpperCase());
      else if (/^\d{1,2}$/.test(raw) && +raw >= 1 && +raw <= 12) { out.add(+raw + "A"); out.add(+raw + "B"); }
    }
    return out;
  }

  /* ---- the one matching function ---- */
  const norm = (s) => String(s == null ? "" : s).toLowerCase();
  function parseQuery(q) {
    const f = { terms: [], artist: [], title: [], album: [], genre: [], bpm: null, key: null };
    for (const tok of String(q || "").trim().split(/\s+/).filter(Boolean)) {
      const m = /^(artist|title|album|genre|bpm|key|camelot):(.+)$/i.exec(tok);
      if (!m) { f.terms.push(norm(tok)); continue; }
      const k = m[1].toLowerCase(), v = m[2];
      if (k === "bpm") { const r = /^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/.exec(v); if (r) f.bpm = [+r[1], r[2] != null ? +r[2] : +r[1]]; }
      else if (k === "key" || k === "camelot") f.key = parseCamelot(v);
      else f[k].push(norm(v));
    }
    return f;
  }
  const folderOf = (t) => {
    const p = t.libRel || t.relPath || t.path || null; if (!p) return null;
    const parts = String(p).split(/[\\/]/).filter(Boolean); parts.pop();
    return parts.length ? parts[parts.length - 1] : null;
  };
  // f: { query, bpmMin, bpmMax, energyMin, energyMax, genres:Set|[], keys:Set|[], dateFrom, dateTo, batchId, folder, ids:Set|[] }
  function matchTrack(t, f) {
    if (!f) return true;
    if (f.bpmMin != null && !(t.bpm >= f.bpmMin)) return false;
    if (f.bpmMax != null && !(t.bpm <= f.bpmMax)) return false;
    const e = t.profile && t.profile.energy;
    if (f.energyMin != null && !(e >= f.energyMin)) return false;
    if (f.energyMax != null && !(e <= f.energyMax)) return false;
    const has = (c) => c && (c.size != null ? c.size : c.length) > 0, inC = (c, v) => (c.has ? c.has(v) : c.includes(v));
    if (has(f.genres) && !inC(f.genres, t.genre && t.genre.primary)) return false;
    if (has(f.keys) && !inC(f.keys, t.key && t.key.camelot)) return false;
    if (has(f.ids) && !inC(f.ids, t.id)) return false;
    if (f.batchId && t.importBatchId !== f.batchId) return false;
    if (f.folder != null && f.folder !== "" && folderOf(t) !== f.folder) return false;
    if (f.dateFrom != null || f.dateTo != null) { if (!inRange(t.dateAddedToAToB, { from: f.dateFrom, to: f.dateTo })) return false; }
    if (f.query) {
      const q = parseQuery(f.query), hay = norm([t.artist, t.title, t.album, t.genre && t.genre.primary, t.filename].join(" "));
      for (const w of q.terms) { if (/^\d+(\.\d+)?$/.test(w)) { if (!(Math.round(t.bpm) === Math.round(+w) || hay.includes(w))) return false; } else if (/^\d{1,2}[ab]$/.test(w)) { if (norm(t.key && t.key.camelot) !== w && !hay.includes(w)) return false; } else if (!hay.includes(w)) return false; }
      for (const w of q.artist) if (!norm(t.artist).includes(w)) return false;
      for (const w of q.title) if (!norm(t.title).includes(w)) return false;
      for (const w of q.album) if (!norm(t.album).includes(w)) return false;
      for (const w of q.genre) if (!norm(t.genre && t.genre.primary).includes(w)) return false;
      if (q.bpm && !(t.bpm >= q.bpm[0] - 0.5 && t.bpm <= q.bpm[1] + 0.5)) return false;
      if (q.key && q.key.size && !q.key.has(t.key && t.key.camelot)) return false;
    }
    return true;
  }
  const filterTracks = (tracks, f) => tracks.filter((t) => matchTrack(t, f));

  function sortTracks(tracks, key, dir = 1) {
    const val = { newest: (t) => t.dateAddedToAToB ?? -Infinity, added: (t) => t.dateAddedToAToB ?? -Infinity, title: (t) => norm(t.title), artist: (t) => norm(t.artist), bpm: (t) => t.bpm, energy: (t) => t.profile && t.profile.energy }[key] || ((t) => t.dateAddedToAToB ?? -Infinity);
    return tracks.slice().sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  }

  /* ---- migration: only fills what is missing; never rewrites a timestamp that exists ---- */
  function migrate(tracks) {
    let filled = 0, unknown = 0;
    for (const t of tracks) {
      if (t.dateAddedToAToB === undefined) {
        // `analyzedAt` is the moment the app analysed (= imported) the file: a reliable timestamp. Without it the date stays unknown.
        if (typeof t.analyzedAt === "number" && t.analyzedAt > 0) { t.dateAddedToAToB = t.analyzedAt; t.dateAddedKind = "analyzedAt"; filled++; }
        else { t.dateAddedToAToB = null; t.dateAddedKind = "unknown"; unknown++; }
      }
      if (t.sourceDateAdded === undefined) t.sourceDateAdded = null;
      if (t.lastImportedAt === undefined) t.lastImportedAt = t.dateAddedToAToB;
      if (t.importBatchId === undefined) t.importBatchId = null;
      if (t.sourceType === undefined) t.sourceType = t.libRel ? "folder" : "unknown";
      if (t.sourceName === undefined) t.sourceName = null;
      if (t.sourcePath === undefined) t.sourcePath = t.path || null;
    }
    return { filled, unknown };
  }

  /* ---- folder grouping (original folder names; no assumption about absolute paths) ---- */
  function groupFolders(tracks, batches = []) {
    const byBatch = new Map(batches.map((b) => [b.id, b])), groups = new Map();
    for (const t of tracks) {
      const name = folderOf(t) || t.sourceName || null, key = name == null ? "\u0000none" : name;
      if (!groups.has(key)) groups.set(key, { key: name, name, ids: [], at: null, sourceType: t.sourceType || "unknown", batchIds: new Set() });
      const g = groups.get(key); g.ids.push(t.id); if (t.importBatchId) g.batchIds.add(t.importBatchId);
      const at = t.dateAddedToAToB; if (at != null && (g.at == null || at > g.at)) g.at = at;
      if (t.sourceType && t.sourceType !== "unknown") g.sourceType = t.sourceType;
    }
    return [...groups.values()].map((g) => ({ ...g, count: g.ids.length, batchIds: [...g.batchIds] })).sort((a, b) => (b.at ?? -1) - (a.at ?? -1) || String(a.name).localeCompare(String(b.name)));
  }
  // day bucket for history headers: "today" | "yesterday" | { date } | "unknown"
  function dayBucket(ms, now = Date.now()) {
    if (ms == null) return "unknown"; const s = startOfDay(now), d = startOfDay(ms);
    return d === s ? "today" : d === s - DAY ? "yesterday" : { date: d };
  }
  return { PRESETS, dateRange, inRange, parseCamelot, parseQuery, matchTrack, filterTracks, sortTracks, migrate, folderOf, groupFolders, dayBucket, startOfDay };
});
