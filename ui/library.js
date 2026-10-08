/* =================== Library: sortable, filterable, comparable =================== */
const LIB_COLS = ["track", "bpm", "key", "genre", "energy", "sonic", "dj", "status"];

function libRows() {
  const ref = findTrack(state.libRef) || null;
  let rows = state.library.filter((x) => passFilters(x)).map((tr) => {
    const isRef = ref && ref.id === tr.id;
    const sonic = ref && !isRef ? sonicScore(ref, tr) : null;
    const dj = ref && !isRef ? transitionOf(ref, tr).compat : null;
    return { t: tr, sonic: sonic ? sonic.overall : null, dj: dj ? dj.overall : null, isRef, conf: dj ? dj.confidence : null };
  });
  if (state.filters.minSim != null && ref) rows = rows.filter((r) => r.isRef || (r.sonic ?? 0) >= state.filters.minSim);
  const k = state.sort.key, d = state.sort.dir;
  const val = { track: (r) => (r.t.artist + " " + r.t.title).toLowerCase(), bpm: (r) => r.t.bpm, key: (r) => parseInt(r.t.key.camelot) * 2 + (r.t.key.camelot.endsWith("B") ? 1 : 0) || 99, genre: (r) => r.t.genre.primary,
    energy: (r) => r.t.profile.energy, sonic: (r) => r.sonic ?? -1, dj: (r) => r.dj ?? -1, status: (r) => (r.t.analysis ? { COMPLETE: 4, SONIC_EMBEDDING: 3, STRUCTURE_ANALYSIS: 2, ADVANCED_ANALYSIS: 1 }[r.t.analysis.status] || 0 : -1), analyzedAt: (r) => r.t.analyzedAt }[k] || (() => 0);
  rows.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * d; });
  return rows;
}

function renderLibraryView(root) {
  const ref = findTrack(state.libRef);
  const f = state.filters, num = (v) => (v == null ? "" : v);
  root.innerHTML = `<div id="libraryRoot" class="col"><section class="panel">
    <div class="hd"><div><h1>${t("lib.title")}</h1><div class="mono dim" id="libCount" style="margin-top:6px"></div></div>
      <div class="toolbar"><label class="lab" style="display:flex;gap:8px;align-items:center;grid-auto-flow:column">${t("lib.compareWith")}${UI.help("compare")}
        <select id="libRefSel" style="width:220px"><option value="">${t("lib.none")}</option>${state.library.map((x) => `<option value="${x.id}" ${x.id === state.libRef ? "selected" : ""}>${UI.esc(x.title.slice(0, 40))}</option>`).join("")}</select></label>
      <button class="btn" data-pick-files>${UI.icon("plus")}${t("import.chooseFiles")}</button></div></div>
    ${libFolderPanel()}<div class="filters" style="margin-top:16px">
      <label>${t("lib.search")}<input type="search" id="fQuery" value="${UI.esc(f.query)}" placeholder="${UI.esc(t("lib.searchPh"))}"></label>
      <label>BPM ${t("lib.min")}<input type="number" id="fBpmMin" value="${num(f.bpmMin)}"></label><label>BPM ${t("lib.max")}<input type="number" id="fBpmMax" value="${num(f.bpmMax)}"></label>
      <label>${t("metric.energy")} ${t("lib.min")}<input type="number" id="fEnergyMin" value="${num(f.energyMin)}"></label><label>${t("metric.energy")} ${t("lib.max")}<input type="number" id="fEnergyMax" value="${num(f.energyMax)}"></label>
      <label>${t("lib.minSim")}<input type="number" id="fMinSim" value="${num(f.minSim)}" ${ref ? "" : "disabled"}></label>
      <label>${t("lib.status")}<select id="fStatus">${[["", "lib.statusAll"], ["COMPLETE", "lib.statusComplete"], ["STRUCTURE", "lib.statusStructure"], ["SONIC", "lib.statusSonic"], ["NOAUDIO", "lib.statusNoAudio"]].map(([v, k]) => `<option value="${v}" ${f.status === v ? "selected" : ""}>${t(k)}</option>`).join("")}</select></label></div>
    <div id="libTags"></div><div id="libTable"></div></section></div>`;
  renderLibraryTags(); renderLibraryTable();
  ensureSonicThen(ref, () => { if (state.tab === "library") renderLibraryTable(); });
}
function renderLibraryTags() {
  const genres = [...new Set(state.library.map((x) => x.genre.primary))].sort();
  const keys = [...new Set(state.library.map((x) => x.key.camelot))].filter((k) => k && k !== "unknown").sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
  const tags = (arr, set, attr) => arr.map((v) => `<button type="button" class="chip ${set.has(v) ? "on" : ""}" ${attr}="${UI.esc(v)}" aria-pressed="${set.has(v)}">${UI.esc(v)}</button>`).join("");
  const el = document.getElementById("libTags"); if (!el) return;
  el.innerHTML = state.library.length ? `<div class="tagrow" style="margin-top:12px"><span class="label">${t("lib.genre")}</span>${tags(genres, state.filters.genres, "data-fgenre")}</div>
    <div class="tagrow" style="margin-top:8px"><span class="label">${t("metric.key")}</span>${tags(keys, state.filters.keys, "data-fkey")}${filtersActive() ? `<button class="linkbtn" id="filtersReset" style="margin-left:auto">${t("lib.reset")}</button>` : ""}</div>` : "";
}
function renderLibraryTable() {
  const wrap = document.getElementById("libTable"); if (!wrap) return;
  const rows = libRows(), ref = findTrack(state.libRef), sel = state.selected;
  document.getElementById("libCount").textContent = t("lib.count", { n: rows.length, total: state.library.length }) + (filtersActive() ? " · " + t("lib.filtered") : "");
  const arrow = (k) => (state.sort.key === k ? (state.sort.dir > 0 ? " ↑" : " ↓") : "");
  const allSel = rows.length && rows.every((r) => sel.has(r.t.id));
  wrap.innerHTML = `${sel.size ? `<div class="toolbar" style="padding:10px 0;margin-top:12px;border-top:1px solid var(--border);border-bottom:1px solid var(--border)"><span class="label">${t("lib.selected", { n: sel.size })}</span><button class="btn sm" id="selAddTo">${t("add.to")}</button><button class="btn sm" id="selAdvanced">${t("lib.runAdvanced")}</button><button class="btn sm" id="selEmbed">${t("lib.computeEmbeddings")}</button><button class="btn sm danger" id="selDelete">${t("common.delete")}</button><button class="linkbtn" id="selClear" style="margin-left:auto">${t("common.clear")}</button></div>` : ""}
    ${state.library.length ? `<div style="overflow-x:auto"><table class="t" aria-label="${UI.esc(t("lib.title"))}" style="margin-top:8px"><thead><tr>
      <th style="width:28px"><input type="checkbox" id="selAll" aria-label="${UI.esc(t("lib.selectAll"))}" ${allSel ? "checked" : ""} style="width:auto"></th>
      ${LIB_COLS.map((k) => `<th class="sortable" data-sort="${k}" aria-sort="${state.sort.key === k ? (state.sort.dir > 0 ? "ascending" : "descending") : "none"}">${t("col." + k)}${arrow(k)}</th>`).join("")}<th></th></tr></thead>
      <tbody>${rows.map(({ t: tr, sonic, dj, isRef, conf }) => `<tr class="row ${sel.has(tr.id) ? "sel" : ""}" data-id="${tr.id}">
        <td><input type="checkbox" data-sel="${tr.id}" ${sel.has(tr.id) ? "checked" : ""} aria-label="${UI.esc(tr.title)}" style="width:auto"></td>
        <td><div style="display:flex;gap:12px;align-items:center;min-width:0"><span class="artplay">${UI.art(tr, "xs")}<button class="ov ${player.id === tr.id && !player.audio.paused ? "on" : ""}" data-simplay="${tr.id}" aria-label="${UI.esc(t("player.play"))}">${UI.icon("play")}</button></span>
          <div style="min-width:0"><div class="dim" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px">${UI.esc(dispArtist(tr))}</div><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px">${UI.esc(tr.title)}</div></div></div></td>
        <td class="num">${tr.bpm.toFixed(1)}</td><td>${UI.keyBadge(tr.key.camelot)}</td><td class="dim">${UI.esc(tr.genre.primary)}</td><td class="num">${Math.round(tr.profile.energy)}</td>
        <td>${isRef ? `<span class="label">${t("lib.reference")}</span>` : ref ? UI.score("sonic", sonic) : UI.NA}</td><td>${isRef || !ref ? "" : UI.score("dj", dj)}${conf && conf.level !== "high" ? ` <span class="badge ${conf.level}" data-tip="${UI.esc(t("conf.missing", { list: conf.missing.map((k) => t("dj." + k)).join(", ") || UI.NA }))}">${t("conf." + conf.level)}</span>` : ""}</td>
        <td><span class="label">${UI.esc(UI.statusWord(tr))}</span></td>
        <td><button class="iconbtn" data-rowmore="${tr.id}" aria-label="${UI.esc(t("common.more"))}">${UI.icon("more")}</button></td></tr>`).join("")}</tbody></table></div>
      ${rows.length ? "" : `<div class="empty">${t("lib.noMatch")}</div>`}` : UI.empty("lib.emptyTitle", "lib.emptyText", `<button class="btn primary" data-pick-files>${t("import.chooseFiles")}</button>`)}`;
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#libraryRoot")) return;
  const sort = e.target.closest("[data-sort]");
  if (sort) { const k = sort.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === "track" || k === "genre" ? 1 : -1) }; renderLibraryTable(); return; }
  if (e.target.closest("#selAll")) { const rows = libRows(), all = rows.every((r) => state.selected.has(r.t.id)); rows.forEach((r) => (all ? state.selected.delete(r.t.id) : state.selected.add(r.t.id))); renderLibraryTable(); return; }
  const cb = e.target.closest("[data-sel]"); if (cb) { e.stopPropagation(); state.selected.has(cb.dataset.sel) ? state.selected.delete(cb.dataset.sel) : state.selected.add(cb.dataset.sel); renderLibraryTable(); return; }
  if (e.target.closest("#selClear")) { state.selected.clear(); renderLibraryTable(); return; }
  if (e.target.closest("#selAddTo")) { addToMenu(e.target.closest("#selAddTo"), [...state.selected]); return; }
  if (e.target.closest("#selAdvanced")) { [...state.selected].forEach((id) => { advChain = advChain.then(() => runAdvanced(id)).catch(() => {}); }); toast(t("lib.advancedQueued")); return; }
  if (e.target.closest("#selEmbed")) { [...state.selected].forEach((id) => { const tr = findTrack(id); if (tr && tr.analysis && (!sonicIdOf(tr) || sonicStale(tr))) runSonicOnly(id); }); toast(t("lib.embeddingsQueued")); return; }
  if (e.target.closest("#selDelete")) { (async () => { if (!(await askConfirm(t("lib.deleteAsk", { n: state.selected.size }), t("common.delete")))) return; [...state.selected].forEach(removeTrackEverywhere); state.selected.clear(); persistLibrary(); persistSets(); persistCurrentSet(); persistCrate(); invalidateSonic(); renderActiveView(); })(); return; }
  const more = e.target.closest("[data-rowmore]"); if (more) { e.stopPropagation(); trackMoreMenu(more, more.dataset.rowmore); return; }
  const g = e.target.closest("[data-fgenre]"), k = e.target.closest("[data-fkey]");
  if (g || k) { const set = g ? state.filters.genres : state.filters.keys, v = g ? g.dataset.fgenre : k.dataset.fkey; set.has(v) ? set.delete(v) : set.add(v); renderLibraryTags(); renderLibraryTable(); return; }
  if (e.target.closest("#filtersReset")) { resetFilters(); renderActiveView(); return; }
  if (e.target.closest("[data-simplay],input,[data-pick-files]")) return;
  const row = e.target.closest("tr.row"); if (row) openTrack(row.dataset.id);
});
document.addEventListener("input", (e) => {
  if (!e.target.closest || !e.target.closest("#libraryRoot")) return;
  const f = state.filters, n = (id) => { const v = parseFloat(document.getElementById(id).value); return isFinite(v) ? v : null; };
  if (e.target.id === "fQuery") f.query = e.target.value.trim();
  else if (e.target.id === "fStatus") f.status = e.target.value;
  else { f.bpmMin = n("fBpmMin"); f.bpmMax = n("fBpmMax"); f.energyMin = n("fEnergyMin"); f.energyMax = n("fEnergyMax"); f.minSim = n("fMinSim"); }
  clearTimeout(renderLibraryTable._t); renderLibraryTable._t = setTimeout(() => { renderLibraryTable(); renderLibraryTags(); }, 120);
});
document.addEventListener("change", (e) => { if (e.target.id === "libRefSel") { state.libRef = e.target.value || null; renderActiveView(); } });
