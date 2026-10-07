/* Set export: Rekordbox XML, M3U8, tracklist (TXT) and transition sheet (TXT / JSON). Pure functions (browser global
 * `SetExport` + Node tests). Nothing here touches Rekordbox's own database: the XML file is the interchange format
 * documented by AlphaTheta ("XML file format for playlists sharing", Version 1.0.0) and is imported by the user in Rekordbox
 * (Preferences > Advanced > Database > Imported Library: rekordbox xml, then drag the playlist into Playlists).
 *
 * export track: { id, artist, title, album, genre, filename, relPath, path, durationSec, bpm, key:{tonic,mode,camelot},
 *   format, sampleRate, sizeBytes, grid:{first,bpm}|null }
 * transition (per consecutive pair): { mixOutTime, mixInTime, bars, type, compatibility, confidence, mixOut:{section,bar}, mixIn:{section,bar} } | null */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SetExport = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const APP = "a.to.b";
  const xmlEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
  const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0"); };
  const hhmmss = (sec) => { sec = Math.round(sec); const h = Math.floor(sec / 3600); return (h ? h + ":" : "") + mmss(sec % 3600 + (h ? 0 : 0)); };
  const name = (t) => `${t.artist && t.artist !== "Unknown artist" ? t.artist + " — " : ""}${t.title}`;

  /* ---------- locations ---------- */
  const isWin = (p) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
  function joinPath(base, rel) {
    if (!base) return rel;
    const win = isWin(base), sep = win ? "\\" : "/";
    const b = base.replace(/[\\/]+$/, ""), r = rel.replace(/^[\\/]+/, "").replace(/[\\/]/g, sep);
    return b + sep + r;
  }
  // absolute path of a track, or null if it cannot be known
  function pathOf(t, baseDir) {
    if (t.path) return t.path;                                   // desktop app: real path
    const rel = t.relPath || t.filename;
    if (!rel) return null;
    return baseDir ? joinPath(baseDir, rel) : null;
  }
  // Rekordbox Location: file://localhost/<URI-encoded path>
  function rekordboxLocation(p) {
    const win = isWin(p), norm = p.replace(/\\/g, "/");
    const enc = norm.split("/").map((seg, i) => (win && i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg).replace(/%2F/g, "/"))).join("/");
    return "file://localhost" + (enc.startsWith("/") ? "" : "/") + enc;
  }

  /* ---------- validation ---------- */
  function validate(tracks, opts = {}) {
    const issues = [], seen = new Map();
    tracks.forEach((t, i) => {
      if (!t.filename && !t.path) issues.push({ index: i, id: t.id, code: "noFilename" });
      else if (!pathOf(t, opts.baseDir)) issues.push({ index: i, id: t.id, code: "noLocation" });
      if (!(t.durationSec > 0)) issues.push({ index: i, id: t.id, code: "noDuration" });
      if (seen.has(t.id)) issues.push({ index: i, id: t.id, code: "duplicate", first: seen.get(t.id) }); else seen.set(t.id, i);
      if (t.format && !/^(MP3|WAV|AIFF?|FLAC|M4A|AAC|ALAC)$/i.test(t.format)) issues.push({ index: i, id: t.id, code: "unsupportedFormat", format: t.format });
    });
    const bad = new Set(issues.filter((x) => x.code !== "duplicate").map((x) => x.index));
    return { ok: issues.length === 0, issues, needAttention: bad.size, ready: tracks.length - bad.size };
  }

  /* ---------- M3U8 ---------- */
  function m3u8(tracks, opts = {}) {
    const lines = ["#EXTM3U", `#PLAYLIST:${opts.name || APP}`];
    for (const t of tracks) {
      const p = pathOf(t, opts.baseDir) || t.filename || "";
      lines.push(`#EXTINF:${Math.round(t.durationSec || 0)},${name(t).replace(/[\r\n]+/g, " ")}`, p);
    }
    return lines.join("\n") + "\n"; // UTF-8, LF; paths are written as-is (spaces, Cyrillic, drive letters) — no URL-encoding in plain M3U8
  }

  /* ---------- tracklist TXT ---------- */
  function tracklist(tracks, transitions, opts = {}) {
    const L = opts.labels || {};
    const total = tracks.reduce((s, t) => s + (t.durationSec || 0), 0);
    const out = [`${APP} — ${opts.name || "Set"}`, ""];
    tracks.forEach((t, i) => {
      const meta = [t.bpm ? `${Math.round(t.bpm * 10) / 10} BPM` : null, t.key && t.key.camelot && t.key.camelot !== "unknown" ? t.key.camelot : null].filter(Boolean).join(" · ");
      out.push(`${String(i + 1).padStart(2, "0")}. ${name(t)}${meta ? ` [${meta}]` : ""}`);
      const tr = transitions && transitions[i];
      if (opts.withTransitions !== false && tr && i < tracks.length - 1) {
        const bits = [tr.bars ? `${tr.bars} ${L.bars || "bars"}` : (L.cut || "cut"), tr.mixOut && tr.mixOut.section && tr.mixIn && tr.mixIn.section ? `${tr.mixOut.section} → ${tr.mixIn.section}` : null].filter(Boolean);
        out.push(`    → ${bits.join(" · ")}`);
      }
      if (i < tracks.length - 1) out.push("");
    });
    out.push("", `${tracks.length} ${L.tracks || "tracks"} · ${hhmmss(total)}`);
    return out.join("\n") + "\n";
  }

  /* ---------- transition sheet ---------- */
  function transitionSheet(tracks, transitions, opts = {}) {
    const L = opts.labels || {};
    const rows = [];
    for (let i = 0; i < tracks.length - 1; i++) {
      const a = tracks[i], b = tracks[i + 1], tr = transitions && transitions[i];
      rows.push({ from: i + 1, to: i + 2, trackA: name(a), trackB: name(b),
        mixOutTime: tr && tr.mixOutTime != null ? Math.round(tr.mixOutTime * 100) / 100 : null, mixInTime: tr && tr.mixInTime != null ? Math.round(tr.mixInTime * 100) / 100 : null,
        mixOutBar: tr && tr.mixOut ? tr.mixOut.bar : null, mixInBar: tr && tr.mixIn ? tr.mixIn.bar : null,
        mixOutSection: tr && tr.mixOut ? tr.mixOut.section : null, mixInSection: tr && tr.mixIn ? tr.mixIn.section : null,
        bars: tr ? tr.bars : null, type: tr ? tr.type : null, compatibility: tr && tr.compatibility != null ? Math.round(tr.compatibility) : null,
        confidence: tr ? tr.confidence : null, confidenceLabel: tr ? (tr.confidenceLabel || tr.confidence) : null, manual: !!(tr && tr.manual) });
    }
    return { name: opts.name || "Set", rows };
  }
  function transitionSheetText(sheet, opts = {}) {
    const L = opts.labels || {};
    const out = [`${APP} — ${sheet.name} · ${L.transitions || "transitions"}`, ""];
    for (const r of sheet.rows) {
      out.push(`${String(r.from).padStart(2, "0")} → ${String(r.to).padStart(2, "0")}`, "",
        `${L.trackA || "Track A"}: ${r.trackA}`, `  ${L.mixOut || "mix out"} ${r.mixOutTime != null ? mmss(r.mixOutTime) : "—"}${r.mixOutBar ? ` (${L.bar || "bar"} ${r.mixOutBar})` : ""}${r.mixOutSection ? ` · ${r.mixOutSection}` : ""}`, "",
        `${L.trackB || "Track B"}: ${r.trackB}`, `  ${L.mixIn || "mix in"} ${r.mixInTime != null ? mmss(r.mixInTime) : "—"}${r.mixInBar ? ` (${L.bar || "bar"} ${r.mixInBar})` : ""}${r.mixInSection ? ` · ${r.mixInSection}` : ""}`, "",
        `${r.bars ? r.bars + " " + (L.bars || "bars") : (L.cut || "cut")}${r.type ? " · " + (L.typeNames && L.typeNames[r.type] || r.type) : ""}${r.compatibility != null ? " · " + r.compatibility + "%" : ""}${r.confidence ? " · " + (L.confidence || "confidence") + " " + (r.confidenceLabel || r.confidence) : ""}${r.manual ? " · " + (L.manual || "manual") : ""}`, "");
    }
    return out.join("\n");
  }

  /* ---------- Rekordbox XML ---------- */
  const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const tonality = (k) => (k && k.tonic && NOTE.includes(k.tonic) ? k.tonic + (k.mode === "min" ? "m" : "") : "");
  const kindOf = (t) => ({ MP3: "MP3 File", WAV: "WAV File", FLAC: "FLAC File", M4A: "M4A File", AIFF: "AIFF File", AIF: "AIFF File" }[(t.format || "").toUpperCase()] || (t.format ? t.format + " File" : ""));
  const num = (x, d) => (x == null || !isFinite(x) ? "" : (Math.round(x * 10 ** d) / 10 ** d).toString());

  function rekordboxXml(tracks, transitions, opts = {}) {
    const marks = opts.cues !== false, grid = !!opts.beatGrid, version = opts.version || "0.5.0";
    const uniq = []; const idOf = new Map();
    tracks.forEach((t) => { if (!idOf.has(t.id)) { idOf.set(t.id, uniq.length + 1); uniq.push(t); } });
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<DJ_PLAYLISTS Version="1.0.0">', `  <PRODUCT Name="${xmlEsc(APP)}" Version="${xmlEsc(version)}" Company="punk pozer"/>`, `  <COLLECTION Entries="${uniq.length}">`];
    // memory cues for the transitions, attached to the track they belong to
    const cues = new Map();
    if (marks && transitions) tracks.forEach((a, i) => {
      const tr = transitions[i], b = tracks[i + 1]; if (!tr || !b) return;
      const add = (t, nm, time) => { if (time == null) return; if (!cues.has(t.id)) cues.set(t.id, []); cues.get(t.id).push({ name: nm, time }); };
      add(a, `${APP} out → ${b.title}`.slice(0, 60), tr.mixOutTime); add(b, `${APP} in ← ${a.title}`.slice(0, 60), tr.mixInTime);
    });
    for (const t of uniq) {
      const p = pathOf(t, opts.baseDir);
      const attrs = [["TrackID", idOf.get(t.id)], ["Name", t.title], ["Artist", t.artist && t.artist !== "Unknown artist" ? t.artist : ""], ["Album", t.album || ""], ["Genre", t.genre || ""], ["Kind", kindOf(t)],
        ["Size", t.sizeBytes || ""], ["TotalTime", Math.round(t.durationSec || 0)], ["AverageBpm", num(t.bpm, 2)], ["SampleRate", t.sampleRate || ""], ["Tonality", tonality(t.key)],
        ["Comments", [t.key && t.key.camelot && t.key.camelot !== "unknown" ? t.key.camelot : "", opts.comment || ""].filter(Boolean).join(" · ")], ["Location", p ? rekordboxLocation(p) : ""]]
        .filter(([, v]) => v !== "" && v != null);
      const kids = [];
      if (grid && t.grid && t.grid.first != null && t.bpm) kids.push(`      <TEMPO Inizio="${num(t.grid.first, 3)}" Bpm="${num(t.bpm, 2)}" Metro="4/4" Battito="1"/>`);
      for (const c of cues.get(t.id) || []) kids.push(`      <POSITION_MARK Name="${xmlEsc(c.name)}" Type="0" Start="${num(c.time, 3)}" Num="-1"/>`); // memory cue
      lines.push(`    <TRACK ${attrs.map(([k, v]) => `${k}="${xmlEsc(v)}"`).join(" ")}${kids.length ? ">" : "/>"}`);
      if (kids.length) { lines.push(...kids, "    </TRACK>"); }
    }
    lines.push("  </COLLECTION>", "  <PLAYLISTS>", '    <NODE Type="0" Name="ROOT" Count="1">',
      `      <NODE Name="${xmlEsc(opts.name || APP)}" Type="1" KeyType="0" Entries="${tracks.length}">`);
    tracks.forEach((t) => lines.push(`        <TRACK Key="${idOf.get(t.id)}"/>`));
    lines.push("      </NODE>", "    </NODE>", "  </PLAYLISTS>", "</DJ_PLAYLISTS>");
    return lines.join("\n") + "\n";
  }

  const FORMATS = {
    rekordbox: { ext: "xml", mime: "application/xml", build: (c) => rekordboxXml(c.tracks, c.transitions, c) },
    m3u8: { ext: "m3u8", mime: "audio/x-mpegurl", build: (c) => m3u8(c.tracks, c) },
    txt: { ext: "txt", mime: "text/plain", build: (c) => tracklist(c.tracks, c.transitions, c) },
    sheet: { ext: "txt", mime: "text/plain", build: (c) => transitionSheetText(transitionSheet(c.tracks, c.transitions, c), c) },
    sheetjson: { ext: "json", mime: "application/json", build: (c) => { const sh = transitionSheet(c.tracks, c.transitions, c); sh.rows.forEach((r) => delete r.confidenceLabel); return JSON.stringify(sh, null, 2) + "\n"; } },
  };
  return { APP, m3u8, tracklist, transitionSheet, transitionSheetText, rekordboxXml, rekordboxLocation, joinPath, pathOf, validate, tonality, FORMATS, mmss, hhmmss };
});
