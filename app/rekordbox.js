/* =================== Rekordbox import: catalog, linking, analysis of the new tracks =================== */
// Rekordbox source metadata lives apart from a.to.b analysis: library tracks get `track.rekordbox`, everything else is kept in `state.rb`.
const LS_RB = "atob_rekordbox";
state.rb = loadJSON(LS_RB, { sources: [] });
const persistRb = () => saveJSON(LS_RB, state.rb);
const rbDesktop = () => !!(window.atobDesktop && window.atobDesktop.rekordbox);
const rbPending = { parsed: null, fileName: "", matches: null, exists: null, selected: new Set(["*"]), resolve: {}, confirmProbable: true };

async function rbLoadFile(file) {
  const text = await file.text(), parsed = RekordboxImport.parse(text);
  if (!parsed.ok) { toast(t("rb.err." + parsed.error)); return; }
  rbPending.parsed = parsed; rbPending.fileName = file.name.replace(/\.xml$/i, "");
  rbPending.matches = RekordboxImport.matchTracks([...parsed.tracks.values()], state.library, parsed.signature);
  rbPending.selected = new Set(["*"]); rbPending.resolve = {}; rbPending.confirmProbable = true; rbPending.exists = null;
  if (rbDesktop()) { try { rbPending.exists = await atobDesktop.rekordbox.exists([...parsed.tracks.values()].map((x) => x.path).filter(Boolean)); } catch (e) {} }
  openRbPreview();
}
// ids of tracks covered by the current selection ("*" = the whole collection)
function rbSelectedIds() {
  const p = rbPending.parsed; if (!p) return [];
  return rbPending.selected.has("*") ? [...p.tracks.keys()] : RekordboxImport.trackIdsFor(p.tree, [...rbPending.selected]);
}
function rbSelectionSummary() {
  const p = rbPending.parsed, ids = rbSelectedIds(), s = RekordboxImport.summarize(ids, p.tracks, rbPending.matches, rbPending.exists);
  s.unresolved = ids.filter((id) => { const m = rbPending.matches.get(id); return m.status === "ambiguous" && !rbPending.resolve[id]; }).length;
  return s;
}
function pruneTree(tree, sel) {   // keep selected playlists and the folders that lead to them
  const out = [];
  for (const n of tree) {
    if (sel.has(n.id)) { out.push(n); continue; }
    if (n.type === "folder") { const c = pruneTree(n.children, sel); if (c.length) out.push({ ...n, children: c }); }
  }
  return out;
}
function rbCommit() {
  const p = rbPending.parsed, all = rbPending.selected.has("*"), ids = rbSelectedIds(), tree = all ? p.tree : pruneTree(p.tree, rbPending.selected), now = Date.now();
  const links = {}; let linked = 0, created = 0;
  beginImport({ type: "rekordbox", name: rbPending.fileName });
  for (const id of ids) {
    const m = rbPending.matches.get(id), r = p.tracks.get(id); let libId = null;
    if (m.status === "linked" || (m.status === "probable" && rbPending.confirmProbable)) libId = m.libraryId;
    else if (m.status === "ambiguous") { const c = rbPending.resolve[id]; if (c && c !== "new" && c !== "skip") libId = c; }
    if (libId) {
      const l = findTrack(libId); if (!l) continue;
      l.rekordbox = { trackId: r.id, signature: p.signature, location: r.location, path: r.path, dateAdded: r.dateAdded, tonality: r.tonality, bpm: r.bpm, cues: r.cues, importedAt: now };
      if (l.sourceDateAdded == null && r.dateAdded != null) l.sourceDateAdded = r.dateAdded;
      links[id] = libId; linked++; stampKnownTrack(l);
    } else created++;
  }
  endImport();
  const keep = new Set(ids), tracks = {}; for (const id of keep) { const r = p.tracks.get(id); tracks[id] = { ...r, tempo: undefined }; }
  const src = { id: p.signature, name: rbPending.fileName, product: p.product, importedAt: now, trackCount: ids.length, tree, tracks, links: { ...((state.rb.sources.find((s) => s.id === p.signature) || {}).links || {}), ...links } };
  state.rb.sources = [src, ...state.rb.sources.filter((s) => s.id !== p.signature)];
  persistRb(); persistLibrary();
  return { linked, created, total: ids.length, sourceId: src.id };
}
// new tracks in the catalog = not linked to a library track yet
const rbPendingIds = (src, ids) => (ids || Object.keys(src.tracks)).filter((id) => !(src.links[id] && findTrack(src.links[id])));
function rbPlaylistTrackIds(node) { return node.type === "playlist" ? node.trackIds : node.children.flatMap(rbPlaylistTrackIds); }
function rbLibraryIds(src, ids) { return ids.map((id) => src.links[id]).filter((x) => x && findTrack(x)); }

// analyze catalog tracks: desktop reads the file from the path in the XML; the browser needs the file (see rbAttachFiles)
async function rbAnalyze(src, ids) {
  if (!rbDesktop()) { toast(t("rb.needFiles")); return; }
  const todo = rbPendingIds(src, ids).filter((id) => src.tracks[id].path); let ok = 0, fail = 0, missing = 0;
  beginImport({ type: "rekordbox", name: src.name });
  for (let i = 0; i < todo.length; i++) {
    const r = src.tracks[todo[i]];
    renderBatchProgress(i, todo.length, r.name);
    try {
      const buf = await atobDesktop.rekordbox.read(r.path), name = RekordboxImport.baseName(r.path);
      const file = new File([buf], name, { type: "audio/" + (name.split(".").pop() || "").toLowerCase() });
      Object.defineProperty(file, "_abs", { value: r.path });
      const res = await analyzeAndStoreFile(file), tr = res.track;
      tr.rekordbox = { trackId: r.id, signature: src.id, location: r.location, path: r.path, dateAdded: r.dateAdded, tonality: r.tonality, bpm: r.bpm, cues: r.cues, importedAt: Date.now() };
      if (r.dateAdded != null) tr.sourceDateAdded = r.dateAdded;
      if (r.album && !tr.album) tr.album = r.album;
      if ((!tr.artist || tr.artist === UNKNOWN_ARTIST) && r.artist) tr.artist = r.artist;
      src.links[r.id] = tr.id; ok++;
    } catch (e) { console.warn("rekordbox analyze", r.path, e); (String(e).includes("ENOENT") ? missing++ : fail++); }
    await tick(40);
  }
  endImport(); document.getElementById("analyzeProgress").classList.add("hidden");
  persistRb(); persistLibrary(); renderActiveView();
  toast([t("import.summaryOk", { n: ok }), missing ? t("rb.missingN", { n: missing }) : "", fail ? t("import.summaryFail", { n: fail }) : ""].filter(Boolean).join(" · "));
}
// browser: the user picks files / a folder; those matching a pending catalog track by file name (+ size) are analyzed and linked
async function rbAttachFiles(files) {
  const pend = []; for (const s of state.rb.sources) for (const id of rbPendingIds(s)) { const r = s.tracks[id]; if (r.path) pend.push({ s, r, base: RekordboxImport.baseName(r.path).toLowerCase() }); }
  const todo = []; for (const f of files) { const hit = pend.find((p) => p.base === f.name.toLowerCase() && (p.r.size == null || p.r.size === f.size)); if (hit) todo.push({ f, hit }); }
  if (!todo.length) { toast(t("rb.noneMatched")); return; }
  beginImport({ type: "rekordbox", name: todo[0].hit.s.name }); let ok = 0;
  for (let i = 0; i < todo.length; i++) {
    const { f, hit } = todo[i]; renderBatchProgress(i, todo.length, f.name);
    try {
      const tr = (await analyzeAndStoreFile(f)).track, r = hit.r;
      tr.rekordbox = { trackId: r.id, signature: hit.s.id, location: r.location, path: r.path, dateAdded: r.dateAdded, tonality: r.tonality, bpm: r.bpm, cues: r.cues, importedAt: Date.now() };
      if (r.dateAdded != null) tr.sourceDateAdded = r.dateAdded;
      hit.s.links[r.id] = tr.id; ok++;
    } catch (e) { console.warn(e); }
    await tick(40);
  }
  endImport(); document.getElementById("analyzeProgress").classList.add("hidden"); persistRb(); persistLibrary(); renderActiveView(); toast(t("import.summaryOk", { n: ok }));
}
function rbForget(id) { state.rb.sources = state.rb.sources.filter((s) => s.id !== id); state.library.forEach((l) => { if (l.rekordbox && l.rekordbox.signature === id) delete l.rekordbox; }); persistRb(); persistLibrary(); }

/* ---- two-way exchange with Rekordbox ----
 * IN : Rekordbox "Export Collection in xml format" -> a.to.b (desktop remembers the file: one click to refresh)
 * OUT: every a.to.b set as a playlist in ONE XML file (folder "a.to.b"); point Rekordbox's "Imported Library" at it and press Reload.
 * a.to.b never opens or writes Rekordbox's own database. */
function rbAllSetsForExport() {
  const sets = state.sets.map((s) => ({ name: s.name, ids: s.trackIds, manual: s.manualMix || {} }));
  const cs = state.currentSet; if (cs.trackIds.length && !state.sets.some((s) => s.id && s.id === cs.id)) sets.push({ name: cs.name, ids: cs.trackIds, manual: cs.manualMix || {} });
  return sets.map((s) => ({ name: s.name, tracks: s.ids.map(findTrack).filter(Boolean), manual: s.manual })).filter((s) => s.tracks.length);
}
function rbBuildAllXml() {
  const sets = rbAllSetsForExport(); if (!sets.length) return null;
  const playlists = sets.map((s) => { const tr = s.tracks; return { name: s.name, tracks: tr.map(exportTrack), transitions: exportTransitions(tr, s.manual) }; });
  return { xml: SetExport.rekordboxPlaylistsXml(playlists, { folder: "a.to.b", baseDir: exportBaseDir(), cues: exportOpts.cues, sourceCues: exportOpts.sourceCues, version: APP_VERSION }), sets: sets.length, tracks: new Set(sets.flatMap((s) => s.tracks.map((x) => x.id))).size };
}
async function rbExportAll({ pickNew = false, silent = false } = {}) {
  const built = rbBuildAllXml(); if (!built) { if (!silent) toast(t("rb.exch.noSets")); return false; }
  if (rbDesktop()) {
    const P = await atobDesktop.rekordbox.paths(); let path = P.exportPath;
    if (!path || pickNew) { if (silent) return false; path = await atobDesktop.rekordbox.pickSave("a.to.b.xml"); if (!path) return false; }
    await atobDesktop.rekordbox.writeText(path, built.xml);
    if (!silent) toast(t("rb.exch.written", { sets: built.sets, tracks: built.tracks }));
    state.rbExch = { ...(state.rbExch || {}), exportPath: path, at: Date.now() }; if (state.tab === "library" && state.libSection === "rekordbox") renderActiveView(); return true;
  }
  downloadText(built.xml, "a.to.b playlists.xml", "application/xml"); toast(t("rb.exch.downloaded", { sets: built.sets, tracks: built.tracks })); return true;
}
async function rbAutoExport() { if (!rbDesktop()) return; try { const P = await atobDesktop.rekordbox.paths(); if (P.auto && P.exportPath) await rbExportAll({ silent: true }); } catch (e) { console.warn("rekordbox auto export", e); } }
async function rbImportFromRemembered(pickNew) {
  if (!rbDesktop()) { rbFileInput.click(); return; }
  const P = await atobDesktop.rekordbox.paths(); let path = P.importPath;
  if (!path || pickNew || !P.importExists) { path = await atobDesktop.rekordbox.pickXml(); if (!path) return; }
  const text = await atobDesktop.rekordbox.readText(path);
  await rbLoadFile({ name: path.split(/[\\/]/).pop(), text: async () => text });
}
