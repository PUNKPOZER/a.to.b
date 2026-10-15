/* =================== Import history: every import operation is a batch; tracks remember when / where they came from =================== */
const LS_IMPORTS = "atob_imports";
state.imports = loadJSON(LS_IMPORTS, []);
let activeImport = null;
const persistImports = () => saveJSON(LS_IMPORTS, state.imports);

// type: "folder" | "files" | "rekordbox" | "drop"; name: the original folder / playlist name when known (never an invented one)
function beginImport({ type, name, sourcePath }) {
  activeImport = { id: uid("imp_"), type, name: name || null, sourcePath: sourcePath || null, at: Date.now(), trackIds: [], knownIds: [] };
  return activeImport;
}
function endImport() {
  const b = activeImport; activeImport = null;
  if (b && (b.trackIds.length || b.knownIds.length)) { state.imports.unshift(b); persistImports(); }
  return b;
}
// a name for a batch from the files that were dropped / picked: the top-level folder(s) when the browser exposes them
function importNameFor(files) {
  const tops = [...new Set(files.map((f) => (f.webkitRelativePath || f._rel || "").split("/")).filter((p) => p.length > 1).map((p) => p[0]))];
  return tops.length ? tops.slice(0, 3).join(" + ") : null;
}
function stampNewTrack(track, file) {
  const now = Date.now(), b = activeImport;
  Object.assign(track, { dateAddedToAToB: now, dateAddedKind: "import", sourceDateAdded: null, lastImportedAt: now, importBatchId: b ? b.id : null,
    sourceType: b ? b.type : "files", sourceName: b ? b.name : null, sourcePath: track.path || (b && b.sourcePath) || null });
  if (b) b.trackIds.push(track.id);
}
// the same file imported again: remember it, but never touch the original "date added"
function stampKnownTrack(track) {
  track.lastImportedAt = Date.now();
  if (activeImport && !activeImport.knownIds.includes(track.id)) activeImport.knownIds.push(track.id);
}
function batchName(b) {
  return b.name || t({ folder: "import.batchFolder", files: "import.batchFiles", rekordbox: "import.batchRekordbox", drop: "import.batchFiles" }[b.type] || "import.batchFiles");
}
// tracks that came with a batch (deleted tracks drop out silently)
const batchTracks = (b) => b.trackIds.map(findTrack).filter(Boolean);
function forgetTrackInBatches(id) { state.imports.forEach((b) => { b.trackIds = b.trackIds.filter((x) => x !== id); b.knownIds = b.knownIds.filter((x) => x !== id); }); state.imports = state.imports.filter((b) => b.trackIds.length || b.knownIds.length); persistImports(); }

// data migration: tracks imported before this existed get a date only from a reliable timestamp, otherwise "unknown"
(function migrateLibrary() { const r = LibraryTools.migrate(state.library); if (r.filled || r.unknown) persistLibrary(); })();
