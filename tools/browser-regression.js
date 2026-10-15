// Paste into the browser console of a running a.to.b (http://localhost:8765) that has a few analysed tracks in the library.
// Walks the features that existed before 2.0 and prints a pass/fail table. Not a replacement for `npm test` (pure logic).
(async () => {
  const R = [], ok = (n, c, d) => R.push([n, !!c, d || ""]), w = (ms) => new Promise((r) => setTimeout(r, ms)), errs = [];
  window.addEventListener("error", (e) => errs.push(e.message)); window.addEventListener("unhandledrejection", (e) => errs.push(String(e.reason)));
  state.currentSet.build.mode = "manual";
  state.currentTrackId = state.library[0].id; setActiveTab("analyze"); await w(150);
  for (const tt of TRACK_TABS) { state.trackTab = tt; renderActiveView(); await w(60); }
  ok("Analyze: track tabs", !!document.querySelector("#tabPane")); ok("Analyze: 4 stage pills", document.querySelectorAll(".stage").length === 4); ok("Analyze: waveform", !!document.querySelector("canvas.wave"));
  state.libSection = "tracks"; setActiveTab("library"); await w(150);
  ok("Library: rows", document.querySelectorAll("#libTable tbody tr").length === state.library.length);
  state.filters.genres.add("Nothing"); renderLibraryTable(); ok("Library: filter", document.querySelectorAll("#libTable tbody tr").length === 0); resetFilters(); renderLibraryTable();
  state.crate = state.library.map((x) => x.id); state.currentSet = newSet(); state.currentSet.build.length = 3; state.currentSet.build.mode = "auto"; setActiveTab("setbuilder"); await w(150);
  await buildSetNow(false); await w(200); ok("Set Builder: auto build", state.currentSet.trackIds.length >= 2);
  const ids = state.currentSet.trackIds.slice(); state.currentSet.locked = [ids[0]];
  ok("Set Builder: locked track refuses a shift", applyOrder([ids[1], ids[0], ...ids.slice(2)]) === false); state.currentSet.locked = [];
  ok("Set Builder: reorder", applyOrder([ids[1], ids[0], ...ids.slice(2)]) === true); optimizeNow();
  const n0 = state.sets.length; saveCurrentSet(); ok("Sets: save", state.sets.length === n0 + 1); state.sets.pop(); persistSets();
  const [a, b] = state.currentSet.trackIds; await prepareGrids([a, b]); openTransitionGuide(a, b, false); await w(300);
  ok("Transition guide", !!document.getElementById("gwA")); await playTransition(); await w(500); ok("Preview plays", guideAudio.playing); stopTransition(); closeModal();
  const ex = {}; for (const f of ["rekordbox", "m3u8", "txt", "sheet", "sheetjson"]) { exportOpts.format = f; ex[f] = buildExport().text.length > 20; } ok("Export x5", Object.values(ex).every(Boolean));
  playTrack(state.library[0].id); pausePlayer(); await w(500); ok("Player: pause wins", player.audio.paused); stopPlayer();
  setActiveTab("explore"); await w(100); ok("Explore", !!document.getElementById("exploreRoot"));
  setActiveTab("settings"); await w(100); ok("Settings", !!document.getElementById("apiUrlInput"));
  ok("No runtime errors", errs.length === 0, errs.join(" | "));
  console.table(R.map(([n, c, d]) => ({ check: n, pass: c ? "PASS" : "FAIL", note: d })));
  return { pass: R.filter((r) => r[1]).length, total: R.length };
})();
