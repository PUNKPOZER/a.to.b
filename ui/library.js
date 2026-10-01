/* =================== Library view =================== */
const LIB_COLS = [["track", "Track"], ["bpm", "BPM"], ["key", "Key"], ["genre", "Genre"], ["energy", "Energy"], ["sonic", "Sonic"], ["dj", "DJ"], ["status", "Status"]];

function libRows() {
  const ref = findTrack(state.libRef) || null, A = ref ? trackToEngineShape(ref) : null;
  let rows = state.library.filter((t) => passFilters(t)).map((t) => {
    const isRef = ref && ref.id === t.id;
    const sonic = ref && !isRef ? sonicScore(ref, t) : null;
    const dj = ref && !isRef ? computeDjCompatibility(A, trackToEngineShape(t), state.weights.dj, KEY_WEIGHTS) : null;
    return { t, sonic: sonic ? sonic.overall : null, dj: dj ? dj.overall : null, isRef };
  });
  if (state.filters.minSim != null && ref) rows = rows.filter((r) => r.isRef || (r.sonic ?? 0) >= state.filters.minSim);
  const k = state.sort.key, d = state.sort.dir;
  const val = { track: (r) => (r.t.artist + " " + r.t.title).toLowerCase(), bpm: (r) => r.t.bpm, key: (r) => parseInt(r.t.key.camelot) * 2 + (r.t.key.camelot.endsWith("B") ? 1 : 0) || 99, genre: (r) => r.t.genre.primary,
    energy: (r) => r.t.profile.energy, sonic: (r) => r.sonic ?? -1, dj: (r) => r.dj ?? -1, status: (r) => (r.t.analysis ? { COMPLETE: 4, SONIC_EMBEDDING: 3, STRUCTURE_ANALYSIS: 2, ADVANCED_ANALYSIS: 1 }[r.t.analysis.status] || 0 : -1), analyzedAt: (r) => r.t.analyzedAt }[k] || (() => 0);
  rows.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * d; });
  return rows;
}

function renderLibraryView() {
  const root = document.getElementById("libraryView");
  const rows = libRows(), ref = findTrack(state.libRef), sel = state.selected;
  const arrow = (k) => (state.sort.key === k ? (state.sort.dir > 0 ? " ↑" : " ↓") : "");
  const allSel = rows.length && rows.every((r) => sel.has(r.t.id));
  root.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:end;gap:var(--s5);flex-wrap:wrap;margin-bottom:var(--s5)">
      <div><h1 class="h2">Library</h1><div class="mono dim" style="margin-top:6px">${rows.length} of ${state.library.length} tracks${filtersActive() ? " · filtered" : ""}</div></div>
      <div style="display:flex;gap:var(--s4);align-items:center;flex-wrap:wrap">
        <label class="label" style="display:flex;gap:8px;align-items:center">Compare with
          <select class="field" id="libRefSel" style="width:220px"><option value="">— none —</option>${state.library.map((t) => `<option value="${t.id}" ${t.id === state.libRef ? "selected" : ""}>${UI.esc(t.title.slice(0, 40))}</option>`).join("")}</select></label>
      </div></div>
    ${sel.size ? `<div style="display:flex;gap:var(--s3);align-items:center;padding:10px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-bottom:var(--s3)"><span class="label">${sel.size} selected</span><button class="btn sm" id="selAddTo">Add to…</button><button class="btn sm" id="selEmbed">Compute missing embeddings</button><button class="btn sm danger" id="selDelete">Delete</button><button class="linkbtn" id="selClear" style="margin-left:auto">Clear</button></div>` : ""}
    ${state.library.length ? `<table class="t" aria-label="Library"><thead><tr>
      <th style="width:28px"><input type="checkbox" id="selAll" aria-label="Select all" ${allSel ? "checked" : ""}></th>
      ${LIB_COLS.map(([k, l]) => `<th class="sortable" data-sort="${k}" aria-sort="${state.sort.key === k ? (state.sort.dir > 0 ? "ascending" : "descending") : "none"}">${l}${arrow(k)}</th>`).join("")}<th></th></tr></thead>
      <tbody>${rows.map(({ t, sonic, dj, isRef }) => `<tr class="row ${sel.has(t.id) ? "sel" : ""}" data-id="${t.id}">
        <td><input type="checkbox" data-sel="${t.id}" ${sel.has(t.id) ? "checked" : ""} aria-label="Select ${UI.esc(t.title)}"></td>
        <td><div style="display:flex;gap:var(--s3);align-items:center;min-width:0"><span class="artplay">${UI.art(t, "xs")}<button class="ov ${player.id === t.id && !player.audio.paused ? "on" : ""}" data-simplay="${t.id}" aria-label="Play">${UI.icon("play")}</button></span>
          <div style="min-width:0"><div class="dim" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px">${UI.esc(t.artist)}</div><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px">${UI.esc(t.title)}</div></div></div></td>
        <td class="num">${t.bpm.toFixed(1)}</td><td class="num">${UI.esc(t.key.camelot)}</td><td class="dim">${UI.esc(t.genre.primary)}</td><td class="num">${Math.round(t.profile.energy)}</td>
        <td>${isRef ? `<span class="label">reference</span>` : UI.score("sonic", sonic)}</td><td>${isRef ? "" : UI.score("dj", dj)}</td>
        <td><span class="label">${UI.statusWord(t)}</span></td>
        <td><button class="iconbtn" data-rowmore="${t.id}" aria-label="More">${UI.icon("more")}</button></td></tr>`).join("")}</tbody></table>` : `<div class="empty" style="padding-left:0">The library is empty — analyze tracks in <button class="linkbtn" onclick="setActiveTab('analyze')">Analyze</button>.</div>`}`;
  ensureSonicThen(ref, renderLibraryView);
}

document.getElementById("libraryView").addEventListener("click", (e) => {
  const sort = e.target.closest("[data-sort]");
  if (sort) { const k = sort.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === "track" || k === "genre" ? 1 : -1) }; renderLibraryView(); return; }
  if (e.target.closest("#selAll")) { const rows = libRows(); const all = rows.every((r) => state.selected.has(r.t.id)); rows.forEach((r) => (all ? state.selected.delete(r.t.id) : state.selected.add(r.t.id))); renderLibraryView(); return; }
  const cb = e.target.closest("[data-sel]"); if (cb) { e.stopPropagation(); state.selected.has(cb.dataset.sel) ? state.selected.delete(cb.dataset.sel) : state.selected.add(cb.dataset.sel); renderLibraryView(); return; }
  if (e.target.closest("#selClear")) { state.selected.clear(); renderLibraryView(); return; }
  if (e.target.closest("#selAddTo")) { addToMenu(e.target.closest("#selAddTo"), [...state.selected]); return; }
  if (e.target.closest("#selEmbed")) { [...state.selected].forEach((id) => { const t = findTrack(id); if (t && t.analysis && (!sonicIdOf(t) || sonicStale(t))) runSonicOnly(id); }); toast("Embeddings queued"); return; }
  if (e.target.closest("#selDelete")) { (async () => { if (!(await askConfirm(`Delete ${state.selected.size} tracks from the library?`, "Delete"))) return; for (const id of [...state.selected]) { AudioStore.del(id); sessionFiles.delete(id); state.library = state.library.filter((t) => t.id !== id); state.sets.forEach((s) => (s.trackIds = s.trackIds.filter((x) => x !== id))); state.currentSet.trackIds = state.currentSet.trackIds.filter((x) => x !== id); if (player.id === id) stopPlayer(); if (state.currentTrackId === id) state.currentTrackId = null; } state.selected.clear(); persistLibrary(); persistSets(); invalidateSonic(); renderFilterTags(); renderActiveView(); })(); return; }
  const more = e.target.closest("[data-rowmore]"); if (more) { e.stopPropagation(); trackMoreMenu(more, more.dataset.rowmore); return; }
  if (e.target.closest("[data-simplay]") || e.target.closest("input")) return;
  const row = e.target.closest("tr.row"); if (row) openTrack(row.dataset.id);
});
document.getElementById("libraryView").addEventListener("change", (e) => { if (e.target.id === "libRefSel") { state.libRef = e.target.value || null; renderLibraryView(); renderContext(); } });

function ctxLibrary() {
  const n = state.library.length, c = (f) => state.library.filter(f).length;
  const stats = [["Tracks", n], ["Structure", c((t) => structureOf(t))], ["Embeddings", c((t) => sonicIdOf(t))], ["Audio stored", c((t) => t.hasAudio)]];
  const ref = findTrack(state.libRef);
  const rows = ref ? similarRows(ref, { useFilters: false }).slice(0, 8) : [];
  return `<div class="ctx-head"><span class="label">Library</span></div><div class="metrics" style="margin:0 var(--s5);grid-template-columns:1fr 1fr">${stats.map(([l, v]) => UI.metric(l, v, "")).join("")}</div>
    <div class="ctx-sec" style="margin-top:var(--s5)"><div class="ctx-head"><span class="label">${ref ? "Closest to “" + UI.esc(ref.title.slice(0, 22)) + "”" : "Pick a reference track"}</span></div>
    <div class="tlist">${rows.length ? rows.map(similarRowHtml).join("") : `<div class="empty">Choose “Compare with” to rank the library by sonic similarity and DJ compatibility.</div>`}</div></div>`;
}
