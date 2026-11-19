/* =================== Library sections: Tracks (the original table) · Recently added · Import history · Folders =================== */
const LIB_SECTIONS = ["tracks", "recent", "history", "folders"];   // "rekordbox" is appended by ui/rekordbox-ui.js
function libSectionTabs() {
  const secs = typeof RB_SECTION !== "undefined" ? [...LIB_SECTIONS, "rekordbox"] : LIB_SECTIONS;
  return `<nav class="tabs libtabs" role="tablist" style="margin-top:0;border-top:none;padding-top:0">${secs.map((k) => `<button role="tab" aria-selected="${state.libSection === k}" class="${state.libSection === k ? "active" : ""}" data-libsec="${k}">${t("lib.sec." + k)}</button>`).join("")}</nav>`;
}
function fmtAdded(ms) {
  if (ms == null) return t("hist.unknown");
  const d = new Date(ms), b = LibraryTools.dayBucket(ms), hm = d.toLocaleTimeString(LANG === "ru" ? "ru-RU" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  return b === "today" ? t("hist.today") + " " + hm : b === "yesterday" ? t("hist.yesterday") + " " + hm : d.toLocaleDateString(LANG === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}
const bucketLabel = (b) => (b === "today" ? t("hist.today") : b === "yesterday" ? t("hist.yesterday") : b === "unknown" ? t("hist.unknown") : new Date(b.date).toLocaleDateString(LANG === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: new Date(b.date).getFullYear() === new Date().getFullYear() ? undefined : "numeric" }));
const sourceLabel = (type) => t("hist.src." + (["folder", "files", "rekordbox", "unknown"].includes(type) ? type : "files"));

function renderLibraryView(root) {
  const sec = state.libSection;
  if (sec === "tracks") { renderLibraryTracks(root); const p = root.querySelector("#libraryRoot .panel"); if (p) p.insertAdjacentHTML("afterbegin", libSectionTabs()); return; }
  const body = sec === "recent" ? recentSection() : sec === "history" ? historySection() : sec === "folders" ? foldersSection() : typeof rekordboxSection === "function" ? rekordboxSection() : "";
  root.innerHTML = `<div id="libraryRoot" class="col"><section class="panel">${libSectionTabs()}${body}</section></div>`;
}

/* ---- Recently added ---- */
function recentRange() { const r = state.recent; return LibraryTools.dateRange(r.preset, Date.now(), { from: r.from, to: r.to }); }
function recentTracks() {
  const rg = recentRange(), r = state.recent;
  return LibraryTools.sortTracks(state.library.filter((x) => LibraryTools.inRange(x.dateAddedToAToB, rg)), "added", r.dir);
}
const toDateInput = (ms) => (ms == null ? "" : new Date(ms).toISOString().slice(0, 10));
function bulkBar(ids) {
  return `<div class="toolbar bulk"><span class="label">${t("lib.selected", { n: ids.length })}</span>
    <button class="btn sm" data-bulk="crate">${t("add.crate")}</button><button class="btn sm" data-bulk="set">${t("add.currentSet")}</button><button class="btn sm" data-bulk="newset">${t("add.newSet")}</button><button class="btn sm" data-bulk="smart">${UI.icon("bolt")}${t("smart.fromSelection")}</button></div>`;
}
function recentSection() {
  const r = state.recent, rows = recentTracks(), sel = state.selected, selIds = rows.filter((x) => sel.has(x.id)).map((x) => x.id), allSel = rows.length > 0 && selIds.length === rows.length, unknown = state.library.filter((x) => x.dateAddedToAToB == null).length;
  return `<div class="hd" style="margin-top:12px"><div><h1>${t("lib.sec.recent")}</h1><div class="mono dim" style="margin-top:6px">${t("hist.shown", { n: rows.length, total: state.library.length })}${unknown ? " · " + t("hist.unknownN", { n: unknown }) : ""}</div></div>
      <div class="toolbar">${rows.length ? `<button class="btn" data-recselall="${allSel ? "none" : "all"}">${allSel ? t("hist.clearSel") : t("hist.selectAll", { n: rows.length })}</button>` : ""}${UI.seg([[-1, t("hist.newest")], [1, t("hist.oldest")]], r.dir, "data-recdir")}</div></div>
    <div class="tagrow" style="margin:14px 0">${LibraryTools.PRESETS.map((p) => `<button class="chip ${r.preset === p ? "on" : ""}" data-recpreset="${p}">${t("hist.p." + p)}</button>`).join("")}
      ${r.preset === "custom" ? `<input type="date" id="recFrom" value="${toDateInput(r.from)}" style="width:auto"><span class="dim">—</span><input type="date" id="recTo" value="${toDateInput(r.to)}" style="width:auto">` : ""}</div>
    ${selIds.length ? bulkBar(selIds) : ""}
    ${rows.length ? `<div style="overflow-x:auto"><table class="t"><thead><tr><th style="width:28px"><input type="checkbox" data-recselall="${allSel ? "none" : "all"}" ${allSel ? "checked" : ""} style="width:auto" aria-label="${UI.esc(t("hist.selectAll", { n: rows.length }))}"></th><th>${t("col.track")}</th><th>BPM</th><th>${t("col.key")}</th><th>${t("col.genre")}</th><th>${t("hist.added")}</th><th>${t("hist.source")}</th></tr></thead><tbody>${rows.map((x) => `<tr class="row ${sel.has(x.id) ? "sel" : ""}" data-id="${x.id}"><td><input type="checkbox" data-recsel="${x.id}" ${sel.has(x.id) ? "checked" : ""} style="width:auto" aria-label="${UI.esc(x.title)}"></td>
      <td><div style="display:flex;gap:10px;align-items:center;min-width:0">${UI.art(x, "xs")}<div style="min-width:0"><div class="dim" style="font-size:11px">${UI.esc(dispArtist(x))}</div><div>${UI.esc(x.title)}</div></div></div></td>
      <td class="num">${x.bpm.toFixed(1)}</td><td>${UI.keyBadge(x.key.camelot)}</td><td class="dim">${UI.esc(x.genre.primary)}</td><td class="mono dim">${UI.esc(fmtAdded(x.dateAddedToAToB))}</td><td class="dim">${UI.esc(x.sourceName || sourceLabel(x.sourceType))}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">${t("hist.noneInRange")}</div>`}`;
}

/* ---- Import history ---- */
const expandedBatches = new Set();
function historySection() {
  const batches = state.imports.slice().sort((a, b) => b.at - a.at);
  if (!batches.length) return `<div class="empty" style="margin-top:16px"><b>${t("hist.emptyTitle")}</b>${t("hist.emptyText")}</div>`;
  let lastBucket = null, html = `<div class="hd" style="margin-top:12px"><div><h1>${t("lib.sec.history")}</h1><div class="mono dim" style="margin-top:6px">${t("hist.batches", { n: batches.length })}</div></div></div>`;
  for (const b of batches) {
    const bk = LibraryTools.dayBucket(b.at), key = typeof bk === "object" ? "d" + bk.date : bk, tracks = batchTracks(b), open = expandedBatches.has(b.id);
    if (key !== lastBucket) { html += `<div class="sectionhead"><span class="label">${UI.esc(bucketLabel(bk))}</span></div>`; lastBucket = key; }
    html += `<div class="batch" data-batch="${b.id}"><div class="batchhead"><button class="batchmain" data-batchtoggle="${b.id}" aria-expanded="${open}"><b>${UI.esc(batchName(b))}</b><span class="mono dim">${t("hist.tracksN", { n: b.trackIds.length })}${b.knownIds.length ? " · " + t("hist.knownN", { n: b.knownIds.length }) : ""} · ${UI.esc(sourceLabel(b.type))} · ${new Date(b.at).toLocaleTimeString(LANG === "ru" ? "ru-RU" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</span></button>
      <div class="toolbar"><button class="btn sm" data-batchact="crate:${b.id}">${t("hist.addCrate")}</button><button class="btn sm" data-batchact="set:${b.id}">${t("hist.createSet")}</button><button class="btn sm" data-batchact="smart:${b.id}">${UI.icon("bolt")}${t("hist.smart")}</button><button class="btn sm" data-batchact="filter:${b.id}">${t("hist.filter")}</button></div></div>
      ${open ? `<div class="batchtracks">${tracks.length ? tracks.map((x) => `<div class="sim-row" data-open-track="${x.id}" tabindex="0" role="button" style="grid-template-columns:36px minmax(0,1fr) auto"><span class="artplay">${UI.art(x, "xs")}</span><div class="nm"><div class="t1">${UI.esc(x.title)}</div><div class="t2">${UI.esc(dispArtist(x))}</div></div><span class="mono dim">${x.bpm.toFixed(0)} · ${UI.esc(x.key.camelot)}</span></div>`).join("") : `<div class="empty" style="padding:12px">${t("hist.batchEmpty")}</div>`}</div>` : ""}</div>`;
  }
  return html;
}

/* ---- Folders ---- */
function foldersSection() {
  const groups = LibraryTools.groupFolders(state.library, state.imports);
  if (!groups.length) return `<div class="empty" style="margin-top:16px"><b>${t("hist.emptyTitle")}</b>${t("hist.emptyText")}</div>`;
  return `<div class="hd" style="margin-top:12px"><div><h1>${t("lib.sec.folders")}</h1><div class="mono dim" style="margin-top:6px">${t("hist.foldersN", { n: groups.length })}</div></div></div>
    <div class="sim-list" style="margin-top:12px">${groups.map((g, i) => `<div class="batch"><div class="batchhead"><div class="batchmain" style="cursor:default"><b>${g.name != null ? UI.esc(g.name) : t("hist.noFolder")}</b><span class="mono dim">${t("hist.imported")}: ${UI.esc(fmtAdded(g.at))} · ${t("hist.tracksN", { n: g.count })} · ${UI.esc(sourceLabel(g.sourceType))}</span></div>
      <div class="toolbar"><button class="btn sm" data-folderact="filter:${i}">${t("hist.filter")}</button><button class="btn sm" data-folderact="crate:${i}">${t("hist.addCrate")}</button><button class="btn sm" data-folderact="smart:${i}">${UI.icon("bolt")}${t("hist.smart")}</button></div></div></div>`).join("")}</div>`;
}

/* ---- actions ---- */
function openSmartBuild(source) { state.currentSet.smart = { ...(state.currentSet.smart || {}), source }; persistCurrentSet(); setActiveTab("setbuilder"); }
function showInLibrary(f) { resetFilters(); Object.assign(state.filters, f); state.libSection = "tracks"; renderActiveView(); }
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#libraryRoot")) return;
  const sec = e.target.closest("[data-libsec]"); if (sec) { state.libSection = sec.dataset.libsec; renderActiveView(); return; }
  const rp = e.target.closest("[data-recpreset]"); if (rp) { state.recent.preset = rp.dataset.recpreset; renderActiveView(); return; }
  const rd = e.target.closest("[data-recdir]"); if (rd) { state.recent.dir = +rd.dataset.recdir; renderActiveView(); return; }
  const sa = e.target.closest("[data-recselall]"); if (sa) { const rows = recentTracks(); sa.dataset.recselall === "all" ? rows.forEach((x) => state.selected.add(x.id)) : rows.forEach((x) => state.selected.delete(x.id)); renderActiveView(); return; }
  const rs = e.target.closest("[data-recsel]"); if (rs) { const id = rs.dataset.recsel; state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id); renderActiveView(); return; }
  const bk = e.target.closest("[data-bulk]");
  if (bk) { const ids = recentTracks().filter((x) => state.selected.has(x.id)).map((x) => x.id), k = bk.dataset.bulk;
    if (k === "crate") addToCrate(ids); else if (k === "set") ids.forEach((i) => addToSet(i)); else if (k === "newset") addToNewSet(ids); else if (k === "smart") openSmartBuild({ type: "ids", ids });
    return; }
  const bt = e.target.closest("[data-batchtoggle]"); if (bt) { const id = bt.dataset.batchtoggle; expandedBatches.has(id) ? expandedBatches.delete(id) : expandedBatches.add(id); renderActiveView(); return; }
  const ba = e.target.closest("[data-batchact]");
  if (ba) { const [k, id] = ba.dataset.batchact.split(":"), b = state.imports.find((x) => x.id === id); if (!b) return; const ids = batchTracks(b).map((x) => x.id);
    if (k === "crate") addToCrate(ids); else if (k === "set") addToNewSet(ids); else if (k === "smart") openSmartBuild({ type: "batch", id }); else if (k === "filter") showInLibrary({ batchId: id });
    return; }
  const fa = e.target.closest("[data-folderact]");
  if (fa) { const [k, i] = fa.dataset.folderact.split(":"), g = LibraryTools.groupFolders(state.library, state.imports)[+i]; if (!g) return;
    if (k === "crate") addToCrate(g.ids); else if (k === "smart") openSmartBuild({ type: "folder", folder: g.name }); else if (k === "filter") showInLibrary({ folder: g.name == null ? "" : g.name, ids: undefined });
    return; }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "recFrom" || e.target.id === "recTo") { const v = e.target.value ? new Date(e.target.value + "T00:00:00").getTime() : null; state.recent[e.target.id === "recFrom" ? "from" : "to"] = v; renderActiveView(); }
});
