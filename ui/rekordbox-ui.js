/* =================== Library → Rekordbox: import preview, catalog of imported playlists =================== */
const RB_SECTION = true;
const rbFileInput = Object.assign(document.createElement("input"), { type: "file", accept: ".xml,application/xml,text/xml", hidden: true });
const rbAudioInput = Object.assign(document.createElement("input"), { type: "file", accept: "audio/*,.mp3,.wav,.aif,.aiff,.flac,.m4a", multiple: true, hidden: true });
const rbFolderInput = Object.assign(document.createElement("input"), { type: "file", multiple: true, hidden: true }); rbFolderInput.setAttribute("webkitdirectory", ""); rbFolderInput.setAttribute("directory", "");
document.body.append(rbFileInput, rbAudioInput, rbFolderInput);
rbFileInput.addEventListener("change", async () => { const f = rbFileInput.files[0]; rbFileInput.value = ""; if (f) await rbLoadFile(f); });
rbFolderInput.addEventListener("change", () => { const fs = [...rbFolderInput.files].filter((f) => /\.(mp3|wav|aiff?|flac|m4a)$/i.test(f.name)); rbFolderInput.value = ""; rbAttachFiles(fs); });
rbAudioInput.addEventListener("change", () => { const fs = [...rbAudioInput.files]; rbAudioInput.value = ""; rbAttachFiles(fs); });

/* ---- import preview ---- */
function rbTreeHtml(nodes, depth) {
  return nodes.map((n) => {
    const on = rbPending.selected.has(n.id), count = n.type === "playlist" ? n.trackIds.length : RekordboxImport.trackIdsFor([n], [n.id]).length;
    return `<label class="rbnode" style="padding-left:${depth * 18}px"><input type="checkbox" data-rbnode="${UI.esc(n.id)}" ${on ? "checked" : ""} ${rbPending.selected.has("*") ? "disabled" : ""} style="width:auto">
      <span class="${n.type === "folder" ? "rbfolder" : ""}">${n.type === "folder" ? UI.icon("folder") : ""}${UI.esc(n.name)}</span><span class="mono faint">${count}</span></label>${n.type === "folder" ? rbTreeHtml(n.children, depth + 1) : ""}`;
  }).join("");
}
function openRbPreview() {
  const dlg = openModal("", "wide"); renderRbPreview(dlg);
}
function renderRbPreview(dlg) {
  dlg = dlg || document.querySelector("#modalRoot .dialog"); if (!dlg || !rbPending.parsed) return;
  const p = rbPending.parsed, s = rbSelectionSummary(), ids = rbSelectedIds();
  const amb = ids.filter((id) => rbPending.matches.get(id).status === "ambiguous");
  const row = (k, v, cls = "") => `<div class="rbrow ${cls}"><span>${k}</span><b class="num">${v}</b></div>`;
  dlg.innerHTML = `<div class="dhead"><h3>${t("rb.title")}</h3><button class="iconbtn" data-close-modal aria-label="${UI.esc(t("common.close"))}">${UI.icon("close")}</button></div>
    <div class="mono dim" style="margin-bottom:12px">${UI.esc(rbPending.fileName)}${p.product ? " · " + UI.esc(p.product.name + " " + p.product.version) : ""}</div>
    ${p.unreadablePlaylists.length ? `<div class="warnbox">${t("rb.unreadable", { n: p.unreadablePlaylists.length })}</div>` : ""}
    <div class="rbcols"><div>
      ${row(t("rb.collection"), t("rb.tracksN", { n: p.tracks.size }))}${row(t("rb.playlists"), p.playlistCount)}
      <div class="rbtree"><label class="rbnode"><input type="checkbox" data-rbnode="*" ${rbPending.selected.has("*") ? "checked" : ""} style="width:auto"><b>${t("rb.entire")}</b><span class="mono faint">${p.tracks.size}</span></label>${rbTreeHtml(p.tree, 0)}</div></div>
    <div>
      ${row(t("rb.selected"), t("rb.tracksN", { n: s.selected }))}${row(t("rb.new"), s.new)}${row(t("rb.already"), s.already)}
      <div class="mono faint" style="margin:-2px 0 6px 0;font-size:11px">${t("rb.alreadyDetail", { l: s.linked, p: s.probable })}</div>
      ${row(t("rb.ambiguous"), s.ambiguous, s.unresolved ? "bad" : "")}
      ${row(t("rb.missing"), s.missing == null ? t("rb.cantCheck") : s.missing, s.missing ? "bad" : "")}
      ${s.noLocation ? row(t("rb.noLocation"), s.noLocation) : ""}
      ${s.probable ? `<label class="rbconfirm"><input type="checkbox" id="rbProbable" ${rbPending.confirmProbable ? "checked" : ""} style="width:auto"> ${t("rb.linkProbable", { n: s.probable })}</label>` : ""}
    </div></div>
    ${amb.length ? `${UI.sectionHead(t("rb.resolveTitle"), t("rb.resolveHint"))}<div class="rbamb">${amb.slice(0, 40).map((id) => { const r = p.tracks.get(id), m = rbPending.matches.get(id); return `<div class="rbambrow"><div style="min-width:0"><b>${UI.esc(r.artist)}</b> — ${UI.esc(r.name)}</div>
        <select data-rbresolve="${id}"><option value="">${t("rb.decide")}</option><option value="skip" ${rbPending.resolve[id] === "skip" ? "selected" : ""}>${t("rb.skip")}</option><option value="new" ${rbPending.resolve[id] === "new" ? "selected" : ""}>${t("rb.asNew")}</option>${m.candidates.map((c) => { const l = findTrack(c); return l ? `<option value="${c}" ${rbPending.resolve[id] === c ? "selected" : ""}>${t("rb.linkTo", { name: UI.esc(l.artist + " — " + l.title) })}</option>` : ""; }).join("")}</select></div>`; }).join("")}${amb.length > 40 ? `<div class="mono faint">+${amb.length - 40}</div>` : ""}</div>` : ""}
    <div class="row"><button class="btn" data-close-modal>${t("common.cancel")}</button>
      ${s.unresolved ? `<button class="btn" id="rbSkipAmb">${t("rb.skipAll", { n: s.unresolved })}</button>` : ""}
      <button class="btn primary" id="rbDoImport" ${s.selected === 0 || s.unresolved ? "disabled" : ""}>${t("rb.importSelected")}</button></div>`;
}
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#modalRoot") || !rbPending.parsed) return;
  if (e.target.closest("#rbSkipAmb")) { rbSelectedIds().forEach((id) => { if (rbPending.matches.get(id).status === "ambiguous" && !rbPending.resolve[id]) rbPending.resolve[id] = "skip"; }); renderRbPreview(); return; }
  if (e.target.closest("#rbDoImport")) {
    const r = rbCommit(); closeModal(); rbPending.parsed = null; state.libSection = "rekordbox"; state.rbOpen = r.sourceId;
    toast(t("rb.done", { linked: r.linked, created: r.created })); renderActiveView();
    const src = state.rb.sources.find((s) => s.id === r.sourceId);
    if (src && rbDesktop() && r.created && (await askConfirm(t("rb.analyzeAsk", { n: r.created }), t("rb.analyze"), false))) rbAnalyze(src, rbPendingIds(src));
  }
});
document.addEventListener("change", (e) => {
  if (!e.target.closest || !e.target.closest("#modalRoot") || !rbPending.parsed) return;
  if (e.target.dataset && e.target.dataset.rbnode != null) { const id = e.target.dataset.rbnode; if (id === "*") { rbPending.selected = new Set(e.target.checked ? ["*"] : []); } else { e.target.checked ? rbPending.selected.add(id) : rbPending.selected.delete(id); } renderRbPreview(); }
  if (e.target.id === "rbProbable") { rbPending.confirmProbable = e.target.checked; renderRbPreview(); }
  if (e.target.dataset && e.target.dataset.rbresolve) { rbPending.resolve[e.target.dataset.rbresolve] = e.target.value || undefined; renderRbPreview(); }
});

/* ---- the Rekordbox section of the Library ---- */
const rbOpenNodes = new Set();
function rbNodeHtml(src, n, depth) {
  const ids = rbPlaylistTrackIds(n), done = rbLibraryIds(src, ids).length, key = src.id + ":" + n.id;
  if (n.type === "folder") return `<div class="rbline" style="padding-left:${depth * 18}px"><button class="batchmain" data-rbfold="${UI.esc(key)}">${UI.icon("folder")}<b>${UI.esc(n.name)}</b><span class="mono dim">${t("rb.playlistsIn", { n: RekordboxImport.flattenPlaylists([n]).length })}</span></button></div>${rbOpenNodes.has(key) || depth === 0 ? n.children.map((c) => rbNodeHtml(src, c, depth + 1)).join("") : ""}`;
  return `<div class="rbline" style="padding-left:${depth * 18}px"><div class="batchmain" style="cursor:default"><b>${UI.esc(n.name)}</b><span class="mono dim">${t("rb.analyzedOf", { a: done, n: ids.length })}</span></div>
    <div class="toolbar"><button class="btn sm" data-rbact="set:${UI.esc(src.id)}:${UI.esc(n.id)}" ${done ? "" : "disabled"}>${t("rb.openAsSet")}</button><button class="btn sm" data-rbact="crate:${UI.esc(src.id)}:${UI.esc(n.id)}" ${done ? "" : "disabled"}>${t("add.crate")}</button><button class="btn sm" data-rbact="smart:${UI.esc(src.id)}:${UI.esc(n.id)}" ${done ? "" : "disabled"}>${UI.icon("bolt")}${t("hist.smart")}</button>${done < ids.length && rbDesktop() ? `<button class="btn sm" data-rbact="analyze:${UI.esc(src.id)}:${UI.esc(n.id)}">${t("rb.analyze")}</button>` : ""}</div></div>`;
}
let rbPaths = null;
async function rbRefreshPaths() { if (rbDesktop()) { try { rbPaths = await atobDesktop.rekordbox.paths(); } catch (e) { rbPaths = null; } if (state.tab === "library" && state.libSection === "rekordbox") { const el = document.getElementById("rbExchange"); if (el) el.outerHTML = rbExchangeHtml(); } } }
function rbExchangeHtml() {
  const P = rbPaths || {}, sets = rbAllSetsForExport(), desk = rbDesktop(), short = (p) => (p ? UI.esc(p.length > 58 ? "…" + p.slice(-57) : p) : "");
  return `<div class="rbexch" id="rbExchange">
    <div class="rbcard"><div class="label">${t("rb.exch.in")}</div><b>Rekordbox → a.to.b</b><p class="dim">${t("rb.exch.inText")}</p>
      ${desk && P.importPath ? `<div class="mono faint" style="margin-bottom:8px">${short(P.importPath)}${P.importExists ? "" : " · " + t("rb.exch.gone")}</div>` : ""}
      <div class="toolbar"><button class="btn primary" id="rbPick">${UI.icon("download")}${t("rb.importXml")}</button>${desk && P.importPath && P.importExists ? `<button class="btn" id="rbRefresh">${t("rb.exch.refresh")}</button>` : ""}</div></div>
    <div class="rbcard"><div class="label">${t("rb.exch.out")}</div><b>a.to.b → Rekordbox</b><p class="dim">${t("rb.exch.outText", { n: sets.length })}</p>
      ${desk && P.exportPath ? `<div class="mono faint" style="margin-bottom:8px">${short(P.exportPath)}</div>` : ""}
      <div class="toolbar"><button class="btn primary" id="rbExportAll" ${sets.length ? "" : "disabled"}>${UI.icon("upload")}${desk && P.exportPath ? t("rb.exch.update") : t("rb.exch.exportAll", { n: sets.length })}</button>${desk && P.exportPath ? `<button class="btn" id="rbExportNew">${t("rb.exch.otherFile")}</button>` : ""}</div>
      ${desk ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:10px"><input type="checkbox" id="rbAuto" ${P.auto ? "checked" : ""} style="width:auto"> ${t("rb.exch.auto")}</label>` : ""}
      <details style="margin-top:10px"><summary class="label" style="cursor:pointer">${t("exp.guideTitle")}</summary><ol class="mono dim" style="line-height:1.6;padding-left:18px">${[1, 2, 3, 4, 5].map((n) => `<li>${t("exp.guide." + n)}</li>`).join("")}</ol></details></div></div>`;
}
function rekordboxSection() {
  if (rbPaths === null && rbDesktop()) rbRefreshPaths();
  const head = `<div class="hd" style="margin-top:12px"><div><h1>${t("lib.sec.rekordbox")}</h1><div class="mono dim" style="margin-top:6px">${t("rb.sub")}</div></div></div>${rbExchangeHtml()}`;
  if (!state.rb.sources.length) return head + `<div class="empty"><b>${t("rb.emptyTitle")}</b>${t("rb.emptyText")}</div><details style="margin-top:12px"><summary class="label" style="cursor:pointer">${t("rb.howExport")}</summary><ol class="mono dim" style="line-height:1.6;padding-left:18px">${[1, 2, 3].map((n) => `<li>${t("rb.howExport." + n)}</li>`).join("")}</ol></details>`;
  return head + state.rb.sources.map((src) => {
    const all = Object.keys(src.tracks), pend = rbPendingIds(src), done = all.length - pend.length;
    return `<div class="batch"><div class="batchhead"><div class="batchmain" style="cursor:default"><b>${UI.esc(src.name)}</b><span class="mono dim">${new Date(src.importedAt).toLocaleDateString(LANG === "ru" ? "ru-RU" : "en-GB")} · ${t("rb.analyzedOf", { a: done, n: all.length })}${src.product ? " · " + UI.esc(src.product.name + " " + src.product.version) : ""}</span></div>
      <div class="toolbar">${pend.length && !rbDesktop() ? `<button class="btn sm" id="rbAttach" data-rbsrc="${UI.esc(src.id)}">${t("rb.attachFolder")}</button>` : ""}${pend.length && rbDesktop() ? `<button class="btn sm" data-rbact="analyze:${UI.esc(src.id)}:*">${t("rb.analyzeAll", { n: pend.length })}</button>` : ""}<button class="linkbtn" data-rbact="forget:${UI.esc(src.id)}:*">${t("rb.forget")}</button></div></div>
      <div class="batchtracks">${src.tree.map((n) => rbNodeHtml(src, n, 0)).join("") || `<div class="mono faint" style="padding:8px">${t("rb.noPlaylists")}</div>`}</div></div>`;
  }).join("");
}
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#libraryRoot")) return;
  if (e.target.closest("#rbPick")) { rbDesktop() ? rbImportFromRemembered(true) : rbFileInput.click(); return; }
  if (e.target.closest("#rbRefresh")) { rbImportFromRemembered(false); return; }
  if (e.target.closest("#rbExportAll")) { await rbExportAll(); await rbRefreshPaths(); return; }
  if (e.target.closest("#rbExportNew")) { await rbExportAll({ pickNew: true }); await rbRefreshPaths(); return; }
  if (e.target.closest("#rbAttach")) { rbFolderInput.click(); return; }
  const fold = e.target.closest("[data-rbfold]"); if (fold) { const k = fold.dataset.rbfold; rbOpenNodes.has(k) ? rbOpenNodes.delete(k) : rbOpenNodes.add(k); renderActiveView(); return; }
  const a = e.target.closest("[data-rbact]"); if (!a) return;
  const [k, sid, ...rest] = a.dataset.rbact.split(":"), nid = rest.join(":"), src = state.rb.sources.find((s) => s.id === sid); if (!src) return;
  if (k === "forget") { if (await askConfirm(t("rb.forgetAsk"), t("rb.forget"))) { rbForget(sid); renderActiveView(); } return; }
  const find = (ns) => { for (const n of ns) { if (n.id === nid) return n; if (n.type === "folder") { const f = find(n.children); if (f) return f; } } return null; };
  const node = nid === "*" ? null : find(src.tree), ids = node ? rbPlaylistTrackIds(node) : Object.keys(src.tracks), lib = rbLibraryIds(src, ids);
  if (k === "analyze") rbAnalyze(src, ids);
  else if (k === "crate") addToCrate(lib);
  else if (k === "set") { state.currentSet = Object.assign(newSet(node ? node.name : src.name), { trackIds: lib }); persistCurrentSet(); if (lib.length < ids.length) toast(t("rb.setPartial", { a: lib.length, n: ids.length })); setActiveTab("setbuilder"); }
  else if (k === "smart") openSmartBuild({ type: "ids", ids: lib, label: node ? node.name : src.name });
});
document.addEventListener("change", async (e) => { if (e.target.id === "rbAuto" && rbDesktop()) { await atobDesktop.rekordbox.setAuto(e.target.checked); await rbRefreshPaths(); } });
