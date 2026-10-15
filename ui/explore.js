/* =================== Explore: Discover · Next Track · Bridge Finder · Search =================== */
// Everything runs on the local library. Search uses the same engine as the Library (LibraryTools.matchTrack); scores are the existing
// similarity / DJ-compatibility calculations, never new numbers.
const EXPLORE_SECTIONS = ["discover", "next", "bridge", "search"];
state.explore = { section: "discover", ref: null, refB: null, nextMode: "groove", two: false, query: "", f: { bpmMin: null, bpmMax: null, keys: "", genres: [], energyMin: null, energyMax: null, datePreset: "" }, sort: "primary" };
const exploreFilter = () => { const f = state.explore.f, o = { bpmMin: f.bpmMin, bpmMax: f.bpmMax, keys: LibraryTools.parseCamelot(f.keys), genres: f.genres, energyMin: f.energyMin, energyMax: f.energyMax, query: state.explore.section === "search" ? state.explore.query : "" };
  if (f.datePreset) { const r = LibraryTools.dateRange(f.datePreset, Date.now(), {}); o.dateFrom = r.from; o.dateTo = r.to; } return o; };
const exploreFilterActive = () => { const f = state.explore.f; return f.bpmMin != null || f.bpmMax != null || f.keys || f.genres.length || f.energyMin != null || f.energyMax != null || f.datePreset; };
function exploreRef(which) {
  const id = which === "b" ? state.explore.refB : state.explore.ref;
  const t0 = findTrack(id) || (which === "b" ? null : findTrack(player.id) || findTrack(state.currentTrackId) || state.library[0]);
  return t0 || null;
}
const trackOptions = (sel) => state.library.slice().sort((a, b) => (a.artist + a.title).localeCompare(b.artist + b.title)).map((x) => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${UI.esc(dispArtist(x))} — ${UI.esc(x.title)} · ${x.bpm.toFixed(0)} · ${UI.esc(x.key.camelot)}</option>`).join("");
function exploreFilterBar() {
  const f = state.explore.f, genres = [...new Set(state.library.map((x) => x.genre.primary))].sort(), n = (v) => (v == null ? "" : v);
  return `<div class="filters" style="margin:12px 0 8px"><label>BPM ${t("lib.min")}<input type="number" data-exf="bpmMin" value="${n(f.bpmMin)}"></label><label>BPM ${t("lib.max")}<input type="number" data-exf="bpmMax" value="${n(f.bpmMax)}"></label>
      <label>${t("smart.camelot")}<input data-exf="keys" placeholder="4A-7A, 9B" value="${UI.esc(f.keys)}"></label>
      <label>${t("metric.energy")} ${t("lib.min")}<input type="number" data-exf="energyMin" value="${n(f.energyMin)}"></label><label>${t("metric.energy")} ${t("lib.max")}<input type="number" data-exf="energyMax" value="${n(f.energyMax)}"></label>
      <label>${t("smart.dateAdded")}<select data-exf="datePreset"><option value="">${t("smart.anyDate")}</option>${LibraryTools.PRESETS.filter((p) => p !== "custom").map((p) => `<option value="${p}" ${f.datePreset === p ? "selected" : ""}>${t("hist.p." + p)}</option>`).join("")}</select></label></div>
    <div class="tagrow">${genres.map((g) => `<button class="chip ${f.genres.includes(g) ? "on" : ""}" data-exgenre="${UI.esc(g)}">${UI.esc(g)}</button>`).join("")}${exploreFilterActive() ? `<button class="linkbtn" id="exReset" style="margin-left:auto">${t("lib.reset")}</button>` : ""}</div>`;
}
const exRowActions = (x) => `<button class="iconbtn" data-addset="${x.id}" aria-label="${UI.esc(t("add.currentSet"))}" data-tip="${UI.esc(t("add.currentSet"))}">${UI.icon("plus")}</button><button class="iconbtn" data-crate-add="${x.id}" aria-label="${UI.esc(t("add.crate"))}" data-tip="${UI.esc(t("add.crate"))}">${UI.icon("folder")}</button>`;
const exTrackCell = (x) => `<div style="display:flex;gap:10px;align-items:center;min-width:0"><span class="artplay">${UI.art(x, "xs")}<button class="ov" data-simplay="${x.id}" aria-label="${UI.esc(t("player.play"))}">${UI.icon("play")}</button></span><div style="min-width:0;cursor:pointer" data-open-track="${x.id}"><div class="dim" style="font-size:11px">${UI.esc(dispArtist(x))}</div><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px">${UI.esc(x.title)}</div></div></div>`;
const exMeta = (x) => `<td class="num">${x.bpm.toFixed(1)}</td><td>${UI.keyBadge(x.key.camelot)}</td><td class="dim">${UI.esc(x.genre.primary)}</td><td class="num">${Math.round(x.profile.energy)}</td>`;

function renderExploreView(root) {
  const x = state.explore;
  const body = x.section === "discover" ? exploreDiscover() : x.section === "next" ? exploreNext() : x.section === "bridge" ? exploreBridge() : exploreSearch();
  root.innerHTML = `<div id="exploreRoot" class="col"><section class="panel">
    <nav class="tabs" role="tablist" style="margin-top:0;border-top:none;padding-top:0">${EXPLORE_SECTIONS.map((k) => `<button role="tab" aria-selected="${x.section === k}" class="${x.section === k ? "active" : ""}" data-exsec="${k}">${t("ex.sec." + k)}</button>`).join("")}</nav>
    ${state.library.length ? body : `<div class="empty"><b>${t("lib.emptyTitle")}</b>${t("ex.needLibrary")}</div>`}</section>
    <section class="panel"><details><summary class="label" style="cursor:pointer">${t("ex.about")}</summary>${exploreAboutHtml()}</details></section></div>`;
  ensureSonicThen(exploreRef(), () => { if (state.tab === "explore") renderActiveView(); });
}

/* ---- DISCOVER: related tracks in the library; sonic similarity and DJ compatibility side by side ---- */
function exploreDiscover() {
  const ref = exploreRef(); if (!ref) return "";
  const f = exploreFilter();
  let rows = similarRows(ref, { useFilters: false }).filter((r) => LibraryTools.matchTrack(r.track, f));
  if (state.explore.sort === "dj") rows.sort((a, b) => b.dj.overall - a.dj.overall);
  rows = rows.slice(0, 60);
  return `<div class="hd" style="margin-top:12px"><div><h1>${t("ex.sec.discover")}</h1><div class="mono dim" style="margin-top:6px">${t("ex.discoverSub")}</div></div></div>
    <div class="toolbar" style="margin-top:12px"><label class="lab" style="display:flex;gap:8px;align-items:center;grid-auto-flow:column">${t("ex.reference")}<select id="exRef" style="min-width:260px">${trackOptions(ref.id)}</select></label>
      ${UI.seg([["primary", t("ex.sortSimilar")], ["dj", t("ex.sortDj")]], state.explore.sort, "data-exsort")}</div>
    ${exploreFilterBar()}
    ${rows.length ? `<div style="overflow-x:auto"><table class="t" style="margin-top:12px"><thead><tr><th>${t("col.track")}</th><th>BPM</th><th>${t("col.key")}</th><th>${t("col.genre")}</th><th>${t("col.energy")}</th><th>${t("ex.sonic")}${UI.help("exsonic")}</th><th>${t("ex.djcompat")}${UI.help("dj")}</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="row"><td>${exTrackCell(r.track)}</td>${exMeta(r.track)}
        <td>${r.sonic ? UI.score("sonic", r.sonic.overall) : `<span data-tip="${UI.esc(t("sim.basisFeature"))}">${UI.score("sim", r.sim.overall)}</span>`}</td>
        <td>${UI.score("dj", r.dj.overall)} ${r.dj.confidence.level !== "high" ? `<span class="badge ${r.dj.confidence.level}">${t("conf." + r.dj.confidence.level)}</span>` : ""}</td><td style="white-space:nowrap">${exRowActions(r.track)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">${t("similar.noMatch")}</div>`}`;
}

/* ---- NEXT TRACK: what to play after this one, and why ---- */
const NEXT_UI = { groove: "groove", energyUp: "energyUp", energyDown: "energyDown", genreSwitch: "genreSwitch", surprise: "surprise" };
function nextWhy(ref, row, mode) {
  const c = row.dj, out = [];
  const f = (k) => (c[k] == null ? null : Math.round(c[k]));
  if (mode === "groove") out.push(t("ex.why.groove", { g: f("groove") ?? UI.NA, r: f("rhythm") ?? UI.NA, tp: f("tempo") ?? UI.NA }));
  else if (mode === "energyUp" || mode === "energyDown") out.push(t("ex.why.energy", { d: (row.energyDelta >= 0 ? "+" : "") + row.energyDelta }));
  else if (mode === "genreSwitch") out.push(t(row.sameGenre ? "ex.why.sameGenre" : "ex.why.otherGenre", { g: row.track.genre.primary }));
  else out.push(t("ex.why.creative"));
  c.notes.filter((n) => n.level === "good" || n.level === "ok" || n.code === "keyUnknown" || n.code === "structureNone").slice(0, 3).forEach((n) => out.push(noteText(n)));
  return out;
}
function exploreNext() {
  const ref = exploreRef(); if (!ref) return "";
  const mode = state.explore.nextMode, f = exploreFilter();
  const pool = state.library.filter((x) => x.id !== ref.id && LibraryTools.matchTrack(x, f));
  const sonic = (a, b) => { const p = sonicPair(findTrack(a.id), findTrack(b.id)); return p ? p.ui : null; };
  const rows = SetTools.nextCandidates(trackToEngineShape(ref), pool.map(trackToEngineShape), mode, { djWeights: state.weights.dj, keyWeights: KEY_WEIGHTS, sonic, seed: Date.now() % 997 }).slice(0, 10);
  const playing = player.id && findTrack(player.id) ? findTrack(player.id) : null;
  return `<div class="hd" style="margin-top:12px"><div><h1>${t("ex.sec.next")}</h1><div class="mono dim" style="margin-top:6px">${t("ex.nextSub")}</div></div></div>
    <div class="toolbar" style="margin-top:12px"><label class="lab" style="display:flex;gap:8px;align-items:center;grid-auto-flow:column">${playing && playing.id === ref.id ? t("ex.nowPlaying") : t("ex.reference")}<select id="exRef" style="min-width:260px">${trackOptions(ref.id)}</select></label></div>
    <div class="tagrow" style="margin:12px 0">${Object.keys(NEXT_UI).map((m) => `<button class="chip ${mode === m ? "on" : ""}" data-exnext="${m}" data-tip="${UI.esc(t("ex.nextmode." + m + ".tip"))}">${t("ex.nextmode." + m)}</button>`).join("")}</div>
    ${exploreFilterBar()}
    ${rows.length ? rows.map((r) => { const x = findTrack(r.track.id); return `<div class="djrow"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">${exTrackCell(x)}<div class="mchips"><span>${x.bpm.toFixed(0)} BPM</span>${UI.keyBadge(x.key.camelot)}<span>${UI.esc(x.genre.primary)}</span><span>${Math.round(x.profile.energy)} ${t("chip.energy")}</span></div>
        <span style="margin-left:auto;display:flex;gap:10px;align-items:center"><b class="${UI.tone(r.score)} num" data-tip="${UI.esc(t("ex.matchTip"))}">${Math.round(r.score)}%</b>${UI.score("dj", r.dj.overall)}${confidenceBadge(r.dj.confidence)}${exRowActions(x)}</span></div>
        <ul class="why">${nextWhy(ref, r, mode).map((w) => `<li class="ok">${UI.esc(w)}</li>`).join("")}</ul></div>`; }).join("") : `<div class="empty">${t("next.none")}</div>`}`;
}

/* ---- BRIDGE FINDER: A -> C -> B, both steps judged ---- */
function exploreBridge() {
  const A = exploreRef("a"), B = exploreRef("b") || state.library.find((x) => x.id !== (A && A.id));
  if (!A || !B || A.id === B.id) return `<div class="empty">${t("ex.bridgeNeedTwo")}</div>`;
  const f = exploreFilter(), cands = state.library.filter((x) => x.id !== A.id && x.id !== B.id && LibraryTools.matchTrack(x, f));
  const cmp = (a, b) => { const ta = findTrack(a.id), tb = findTrack(b.id); return ta && tb ? transitionCache.get(ta, tb).overall : null; };
  const rows = SmartBuild.findBridges(trackToEngineShape(A), trackToEngineShape(B), cands.map(trackToEngineShape), { compat: cmp, two: state.explore.two, max: 8 });
  const direct = cmp(trackToEngineShape(A), trackToEngineShape(B));
  const step = (v) => `<span class="${UI.tone(v)} num" style="font-weight:700">${Math.round(v)}%</span>`;
  return `<div class="hd" style="margin-top:12px"><div><h1>${t("ex.sec.bridge")}</h1><div class="mono dim" style="margin-top:6px">${t("ex.bridgeSub")}</div></div></div>
    <div class="toolbar" style="margin-top:12px"><label class="lab" style="display:flex;gap:8px;align-items:center;grid-auto-flow:column">A<select id="exRef" style="min-width:230px">${trackOptions(A.id)}</select></label><span class="dim">→</span>
      <label class="lab" style="display:flex;gap:8px;align-items:center;grid-auto-flow:column">B<select id="exRefB" style="min-width:230px">${trackOptions(B.id)}</select></label>
      ${UI.seg([[false, t("ex.oneBridge")], [true, t("ex.twoBridges")]], state.explore.two, "data-extwo")}</div>
    <div class="mono dim" style="margin:10px 0">${t("ex.direct")}: ${direct == null ? UI.NA : step(direct)}</div>
    ${exploreFilterBar()}
    ${rows.length ? rows.map((r, k) => { const path = [A, ...r.path.map((p) => findTrack(p.id)), B];
      return `<div class="djrow"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${path.map((x, i) => `${i ? `<span class="dim" style="display:inline-flex;gap:4px;align-items:center">→ ${step(r.steps[i - 1])} →</span>` : ""}<span class="bridgechip ${i === 0 || i === path.length - 1 ? "end" : ""}" data-open-track="${x.id}">${UI.esc(x.title)}<small>${x.bpm.toFixed(0)} · ${UI.esc(x.key.camelot)}</small></span>`).join("")}
        <span style="margin-left:auto;display:flex;gap:8px;align-items:center"><span class="mono dim">${t("ex.weakest")} ${step(Math.min(...r.steps))}</span><button class="btn sm" data-exbridgeadd="${k}">${t("ex.addPath")}</button></span></div></div>`; }).join("") : `<div class="empty">${t("bridge.none")}</div>`}`;
}
function exploreBridgeAdd(k) {
  const A = exploreRef("a"), B = exploreRef("b"); if (!A || !B) return;
  const f = exploreFilter(), cands = state.library.filter((x) => x.id !== A.id && x.id !== B.id && LibraryTools.matchTrack(x, f));
  const cmp = (a, b) => { const ta = findTrack(a.id), tb = findTrack(b.id); return ta && tb ? transitionCache.get(ta, tb).overall : null; };
  const r = SmartBuild.findBridges(trackToEngineShape(A), trackToEngineShape(B), cands.map(trackToEngineShape), { compat: cmp, two: state.explore.two, max: 8 })[k]; if (!r) return;
  const ids = state.currentSet.trackIds.slice(), pids = r.path.map((p) => p.id), ia = ids.indexOf(A.id);
  const insert = (arr, at) => arr.filter((id) => !ids.includes(id)).forEach((id, j) => ids.splice(at + j, 0, id));
  if (ia >= 0) insert(pids, ia + 1); else { [A.id, ...pids, B.id].filter((id) => !ids.includes(id)).forEach((id) => ids.push(id)); }
  state.currentSet.trackIds = ids; persistCurrentSet(); toast(t("ex.pathAdded", { n: pids.length }));
}

/* ---- SEARCH: the Library's engine ---- */
function exploreSearch() {
  const f = exploreFilter(), rows = LibraryTools.sortTracks(LibraryTools.filterTracks(state.library, f), "added", -1), shown = rows.slice(0, 100);
  return `<div class="hd" style="margin-top:12px"><div><h1>${t("ex.sec.search")}</h1><div class="mono dim" style="margin-top:6px">${t("ex.searchSub")}</div></div><div class="mono dim">${t("hist.shown", { n: rows.length, total: state.library.length })}</div></div>
    <input type="search" id="exQuery" value="${UI.esc(state.explore.query)}" placeholder="${UI.esc(t("ex.searchPh"))}" style="margin-top:12px" autocomplete="off">
    ${exploreFilterBar()}
    ${shown.length ? `<div style="overflow-x:auto"><table class="t" style="margin-top:12px"><thead><tr><th>${t("col.track")}</th><th>BPM</th><th>${t("col.key")}</th><th>${t("col.genre")}</th><th>${t("col.energy")}</th><th>${t("hist.added")}</th><th></th></tr></thead><tbody>${shown.map((x) => `<tr class="row"><td>${exTrackCell(x)}</td>${exMeta(x)}<td class="mono dim">${UI.esc(fmtAdded(x.dateAddedToAToB))}</td><td style="white-space:nowrap">${exRowActions(x)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">${t("lib.noMatch")}</div>`}`;
}

/* ---- events ---- */
document.addEventListener("click", (e) => {
  if (!e.target.closest("#exploreRoot")) return;
  const x = state.explore, go = () => renderActiveView();
  const s = e.target.closest("[data-exsec]"); if (s) { x.section = s.dataset.exsec; go(); return; }
  const g = e.target.closest("[data-exgenre]"); if (g) { const a = x.f.genres, v = g.dataset.exgenre; a.includes(v) ? a.splice(a.indexOf(v), 1) : a.push(v); go(); return; }
  if (e.target.closest("#exReset")) { x.f = { bpmMin: null, bpmMax: null, keys: "", genres: [], energyMin: null, energyMax: null, datePreset: "" }; go(); return; }
  const so = e.target.closest("[data-exsort]"); if (so) { x.sort = so.dataset.exsort; go(); return; }
  const nm = e.target.closest("[data-exnext]"); if (nm) { x.nextMode = nm.dataset.exnext; go(); return; }
  const tw = e.target.closest("[data-extwo]"); if (tw) { x.two = tw.dataset.extwo === "true"; go(); return; }
  const ba = e.target.closest("[data-exbridgeadd]"); if (ba) { exploreBridgeAdd(+ba.dataset.exbridgeadd); return; }
});
document.addEventListener("change", (e) => {
  if (!e.target.closest || !e.target.closest("#exploreRoot")) return;
  const x = state.explore;
  if (e.target.id === "exRef") x.ref = e.target.value; else if (e.target.id === "exRefB") x.refB = e.target.value;
  else if (e.target.dataset && e.target.dataset.exf) { const k = e.target.dataset.exf, v = e.target.value; x.f[k] = ["keys", "datePreset"].includes(k) ? v : (v === "" ? null : parseFloat(v)); }
  else return;
  renderActiveView();
});
let _exQ = 0;
document.addEventListener("input", (e) => {
  if (e.target.id !== "exQuery") return;
  state.explore.query = e.target.value; clearTimeout(_exQ);
  _exQ = setTimeout(() => { const pos = e.target.selectionStart; renderActiveView(); const n = document.getElementById("exQuery"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 150);
});
