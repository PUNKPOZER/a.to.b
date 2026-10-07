/* =================== Track actions: manual overrides, rename, delete, add-to =================== */
// Manual values always win: they are written into the flat fields every other part of the app reads and recorded
// in manualOverrides, which the backend/structure stages check before touching bpm/key/genre.
function afterTrackEdit(id) { touchTrack(id); persistLibrary(); renderActiveView(); }

async function editBpmPrompt(id) {
  const tr = findTrack(id); if (!tr) return;
  const f = await openForm(tx("edit.bpm"), [{ name: "bpm", label: tx("edit.bpmLabel"), value: tr.bpm.toFixed(1) }]);
  if (!f) return;
  const val = parseFloat(String(f.bpm).replace(",", "."));
  if (!isFinite(val) || val < 40 || val > 220) { toast(tx("edit.bpmRange")); return; }
  tr.manualOverrides = tr.manualOverrides || {};
  tr.manualOverrides.bpm = { value: Math.round(val * 10) / 10, setAt: Date.now() };
  tr.bpm = tr.manualOverrides.bpm.value; if (tr.profile) tr.profile.bpm = tr.bpm;
  if (tr.analysis) tr.analysis.bpm = { ...(tr.analysis.bpm || {}), value: tr.bpm, reliability: 100 };
  if (tr.genre.method !== "discogs-effnet" && tr.analysis && tr.analysis.genreInputs && !tr.manualOverrides.genre) { // rule-based genre follows the corrected tempo
    const gi = tr.analysis.genreInputs;
    tr.genre = classifyGenre(tr.bpm, tr.profile.rhythmicComplexity, gi.percussiveRatio, gi.bassEnergyNorm, gi.brightness, gi.vocalPresence);
  }
  toast(tx("edit.bpmSet")); afterTrackEdit(id);
}
async function editCamelotPrompt(id) {
  const tr = findTrack(id); if (!tr) return;
  const f = await openForm(tx("edit.key"), [{ name: "code", label: tx("edit.keyLabel"), value: tr.key.camelot === "unknown" ? "" : tr.key.camelot }]);
  if (!f) return;
  const code = String(f.code).trim().toUpperCase(), rev = REVERSE_CAMELOT[code];
  if (!rev) { toast(tx("edit.keyInvalid")); return; }
  const [tonic, mode] = rev.split("_");
  tr.manualOverrides = tr.manualOverrides || {};
  tr.manualOverrides.key = { value: code, setAt: Date.now() };
  tr.key = { tonic, mode, camelot: code, confidence: 100 };
  if (tr.analysis) tr.analysis.key = { ...(tr.analysis.key || {}), value: code, reliability: 100 };
  toast(tx("edit.keySet")); afterTrackEdit(id);
}
async function editGenrePrompt(id) {
  const tr = findTrack(id); if (!tr) return;
  const f = await openForm(tx("edit.genre"), [{ name: "genre", label: tx("edit.genreLabel"), value: tr.genre.primary }]);
  if (!f || !f.genre.trim()) return;
  tr.manualOverrides = tr.manualOverrides || {};
  tr.manualOverrides.genre = { value: f.genre.trim(), setAt: Date.now() };
  tr.genre = { ...tr.genre, primary: f.genre.trim(), confidence: 100, method: "manual", secondary: [] };
  toast(tx("edit.genreSet")); afterTrackEdit(id);
}
async function renameTrackPrompt(id) {
  const tr = findTrack(id); if (!tr) return;
  const f = await openForm(tx("edit.rename"), [{ name: "title", label: tx("edit.title"), value: tr.title }, { name: "artist", label: tx("edit.artist"), value: tr.artist }]);
  if (!f) return;
  tr.title = f.title.trim() || tr.title; tr.artist = f.artist.trim() || tr.artist;
  if (player.id === id) { document.getElementById("pbTitle").textContent = tr.title; document.getElementById("pbArtist").textContent = tr.artist; }
  toast(tx("edit.updated")); afterTrackEdit(id);
}
function removeTrackEverywhere(id) {
  if (player.id === id) stopPlayer();
  AudioStore.del(id); sessionFiles.delete(id);
  state.library = state.library.filter((x) => x.id !== id);
  state.sets.forEach((s) => { s.trackIds = s.trackIds.filter((x) => x !== id); });
  const cs = state.currentSet; cs.trackIds = cs.trackIds.filter((x) => x !== id); cs.locked = cs.locked.filter((x) => x !== id); delete cs.roles[id];
  Object.keys(cs.manualMix).forEach((k) => { if (k.split("|").includes(id)) delete cs.manualMix[k]; });
  state.crate = state.crate.filter((x) => x !== id); state.queue = state.queue.filter((x) => x !== id); state.selected.delete(id);
  if (state.currentTrackId === id) state.currentTrackId = null;
  if (state.libRef === id) state.libRef = null;
  touchTrack(id);
}
async function deleteTrackPrompt(id) {
  if (!(await askConfirm(tx("track.deleteAsk"), tx("common.delete")))) return;
  removeTrackEverywhere(id);
  persistLibrary(); persistSets(); persistCurrentSet(); persistCrate(); invalidateSonic(); toast(tx("track.deleted")); renderActiveView();
}
function saveNote(id, text) { const tr = findTrack(id); if (tr) { tr.notes = text; persistLibrary(); } }

/* ---- crate + sets: add-to ---- */
function addToCrate(ids) {
  ids = [].concat(ids); let n = 0;
  ids.forEach((id) => { if (findTrack(id) && !state.crate.includes(id)) { state.crate.push(id); n++; } });
  persistCrate(); toast(n ? tn("toast.crateAdded", n) : tx("toast.crateHas")); if (state.tab === "setbuilder") renderActiveView();
}
function addToSet(trackId, at) {
  if (!findTrack(trackId)) return;
  const ids = state.currentSet.trackIds;
  if (ids.includes(trackId)) { toast(tx("toast.inSet")); return; }
  if (at == null && state.currentSet.build.mode === "auto" && typeof bestInsertIndex === "function") at = bestInsertIndex(trackId);
  at == null ? ids.push(trackId) : ids.splice(at, 0, trackId);
  persistCurrentSet(); toast(tx("toast.addedToSet"));
  if (state.tab === "setbuilder") renderActiveView();
}
async function addToNewSet(ids) {
  const f = await openForm(tx("set.new"), [{ name: "name", label: tx("set.name"), value: tx("set.untitled") }], tx("common.create"));
  if (!f || !f.name.trim()) return;
  const now = Date.now();
  state.sets.push({ ...hydrateSet({ name: f.name.trim(), trackIds: [].concat(ids) }), id: uid("s_"), createdAt: now, updatedAt: now });
  persistSets(); toast(tx("toast.setCreated", { name: f.name.trim() })); if (state.tab === "sets") renderActiveView();
}
function addToMenu(anchor, ids) {
  ids = [].concat(ids);
  openMenu(anchor, [
    { label: tx("add.queue"), run: () => ids.forEach(enqueue) },
    { label: tx("add.crate"), run: () => addToCrate(ids) },
    { label: tx("add.currentSet"), run: () => ids.forEach((i) => addToSet(i)) },
    { label: tx("add.newSet"), run: () => addToNewSet(ids) },
    ...state.sets.map((s) => ({ label: tx("add.set", { name: s.name }), run: () => { s.trackIds.push(...ids.filter((i) => !s.trackIds.includes(i))); s.updatedAt = Date.now(); persistSets(); toast(tx("toast.addedTo", { name: s.name })); } })),
  ]);
}
function trackMoreMenu(anchor, id) {
  openMenu(anchor, [
    { label: tx("edit.bpm"), run: () => editBpmPrompt(id) }, { label: tx("edit.key"), run: () => editCamelotPrompt(id) },
    { label: tx("edit.genre"), run: () => editGenrePrompt(id) }, { label: tx("edit.rename"), run: () => renameTrackPrompt(id) }, { label: tx("track.attachAudio"), run: () => attachAudioPicker(id) },
    { label: tx("track.runAdvanced"), run: () => runAdvanced(id) }, { sep: true }, { label: tx("common.delete"), run: () => deleteTrackPrompt(id) },
  ]);
}
