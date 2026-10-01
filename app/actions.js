/* =================== Track actions: manual overrides, rename, delete, add-to =================== */
// Manual values always win: they are written into the flat fields every other part of the app reads and recorded
// in manualOverrides, which the backend/structure stages check before touching bpm/key/genre.
function afterTrackEdit(id) { persistLibrary(); renderFilterTags(); refreshTrackViews(id); }

async function editBpmPrompt(id) {
  const t = findTrack(id); if (!t) return;
  const f = await openForm("Edit BPM", [{ name: "bpm", label: "BPM (40–220)", value: t.bpm.toFixed(1) }], "Save");
  if (!f) return;
  const val = parseFloat(String(f.bpm).replace(",", "."));
  if (!isFinite(val) || val < 40 || val > 220) { toast("BPM must be between 40 and 220"); return; }
  t.manualOverrides = t.manualOverrides || {};
  t.manualOverrides.bpm = { value: Math.round(val * 10) / 10, setAt: Date.now() };
  t.bpm = t.manualOverrides.bpm.value; if (t.profile) t.profile.bpm = t.bpm;
  if (t.analysis) t.analysis.bpm = { ...(t.analysis.bpm || {}), value: t.bpm, reliability: 100 };
  if (t.analysis && t.analysis.genreInputs && !t.manualOverrides.genre && t.genre.method !== "discogs-effnet") { // genre follows the corrected tempo
    const gi = t.analysis.genreInputs;
    t.genre = classifyGenre(t.bpm, t.profile.rhythmicComplexity, gi.percussiveRatio, gi.bassEnergyNorm, gi.brightness, gi.vocalPresence);
  }
  toast("BPM set manually"); afterTrackEdit(id);
}
async function editCamelotPrompt(id) {
  const t = findTrack(id); if (!t) return;
  const f = await openForm("Edit Camelot", [{ name: "code", label: "Camelot code (e.g. 8A, 5B)", value: t.key.camelot }], "Save");
  if (!f) return;
  const code = String(f.code).trim().toUpperCase(), rev = REVERSE_CAMELOT[code];
  if (!rev) { toast("Not a valid Camelot code"); return; }
  const [tonic, mode] = rev.split("_");
  t.manualOverrides = t.manualOverrides || {};
  t.manualOverrides.key = { value: code, setAt: Date.now() };
  t.key = { tonic, mode, camelot: code, confidence: 100 };
  if (t.analysis) t.analysis.key = { ...(t.analysis.key || {}), value: code, reliability: 100 };
  toast("Key set manually"); afterTrackEdit(id);
}
async function editGenrePrompt(id) {
  const t = findTrack(id); if (!t) return;
  const f = await openForm("Edit genre", [{ name: "genre", label: "Genre / style", value: t.genre.primary }], "Save");
  if (!f || !f.genre.trim()) return;
  t.manualOverrides = t.manualOverrides || {};
  t.manualOverrides.genre = { value: f.genre.trim(), setAt: Date.now() };
  t.genre = { ...t.genre, primary: f.genre.trim(), confidence: 100, method: "manual", secondary: [] };
  toast("Genre set manually"); afterTrackEdit(id);
}
async function renameTrackPrompt(id) {
  const t = findTrack(id); if (!t) return;
  const f = await openForm("Rename track", [{ name: "title", label: "Title", value: t.title }, { name: "artist", label: "Artist", value: t.artist }], "Save");
  if (!f) return;
  t.title = f.title.trim() || t.title; t.artist = f.artist.trim() || t.artist;
  if (player.id === id) { document.getElementById("pbTitle").textContent = t.title; document.getElementById("pbArtist").textContent = t.artist; }
  toast("Updated"); afterTrackEdit(id);
}
async function deleteTrackPrompt(id) {
  if (!(await askConfirm("Delete this track from the library?", "Delete"))) return;
  if (player.id === id) stopPlayer();
  AudioStore.del(id); sessionFiles.delete(id);
  state.library = state.library.filter((t) => t.id !== id);
  persistLibrary();
  state.sets.forEach((s) => { s.trackIds = s.trackIds.filter((x) => x !== id); }); persistSets();
  state.currentSet.trackIds = state.currentSet.trackIds.filter((x) => x !== id);
  state.queue = state.queue.filter((x) => x !== id); state.selected.delete(id);
  if (state.currentTrackId === id) state.currentTrackId = null;
  invalidateSonic(); toast("Deleted"); renderFilterTags(); renderActiveView();
}
function saveNote(id, text) { const t = findTrack(id); if (t) { t.notes = text; persistLibrary(); } }

/* ---- sets: add-to ---- */
function addToSet(trackId) {
  if (!findTrack(trackId)) return;
  state.currentSet.trackIds.push(trackId);
  toast("Added to current set");
  if (state.tab === "setbuilder") renderActiveView(); else renderContext();
}
async function addToNewSet(ids) {
  const f = await openForm("New set", [{ name: "name", label: "Name", value: "Untitled set" }], "Create");
  if (!f || !f.name.trim()) return;
  const now = Date.now();
  state.sets.push({ id: "s_" + Math.random().toString(36).slice(2, 10), name: f.name.trim(), trackIds: [...ids], createdAt: now, updatedAt: now });
  persistSets(); toast("Set created: " + f.name.trim()); if (state.tab === "sets") renderActiveView();
}
function addToMenu(anchor, ids) {
  ids = [].concat(ids);
  const items = [
    { label: "Queue", run: () => ids.forEach(enqueue) },
    { label: "Current set (Set Builder)", run: () => ids.forEach(addToSet) },
    { label: "New set…", run: () => addToNewSet(ids) },
    ...state.sets.map((s) => ({ label: "Set: " + s.name, run: () => { s.trackIds.push(...ids); s.updatedAt = Date.now(); persistSets(); toast("Added to " + s.name); } })),
  ];
  openMenu(anchor, items);
}
function trackMoreMenu(anchor, id) {
  openMenu(anchor, [
    { label: "Edit BPM", run: () => editBpmPrompt(id) }, { label: "Edit Camelot", run: () => editCamelotPrompt(id) },
    { label: "Edit genre", run: () => editGenrePrompt(id) }, { label: "Rename", run: () => renameTrackPrompt(id) }, { label: "Attach audio file…", run: () => attachAudioPicker(id) },
    { label: "Run advanced analysis", run: () => runAdvanced(id) }, { label: "Delete", run: () => deleteTrackPrompt(id) },
  ]);
}
