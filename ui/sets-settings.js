/* =================== Sets, Explore, Settings =================== */
function renderSetsView(root) {
  const rows = state.sets.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  root.innerHTML = `<section class="panel" id="setsRoot"><div class="hd"><div><h1>${t("sets.title")}</h1><div class="mono dim" style="margin-top:6px">${t("sets.saved", { n: rows.length })}</div></div></div>
    ${rows.length ? `<div style="overflow-x:auto"><table class="t" style="margin-top:16px"><thead><tr><th>${t("sets.set")}</th><th>${t("sb.tracks")}</th><th>${t("sb.duration")}</th><th>BPM</th><th>${t("sets.updated")}</th><th></th></tr></thead><tbody>${rows.map((s) => {
      const tr = s.trackIds.map(findTrack).filter(Boolean), bpms = tr.map((x) => x.bpm);
      return `<tr class="row" data-set="${s.id}"><td style="font-size:16px">${UI.esc(s.name)}</td><td class="num">${tr.length}</td><td class="num">${fmtDur(effectiveSeconds(tr))}</td><td class="num">${bpms.length ? Math.min(...bpms).toFixed(0) + "–" + Math.max(...bpms).toFixed(0) : UI.NA}</td><td class="mono dim">${new Date(s.updatedAt).toLocaleDateString(LANG === "ru" ? "ru-RU" : "en-GB")}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-set-open="${s.id}">${t("sets.open")}</button> <button class="btn sm" data-set-export="${s.id}">${t("sb.export")}</button> <button class="btn sm" data-set-dup="${s.id}">${t("sets.duplicate")}</button> <button class="btn sm danger" data-set-del="${s.id}">${t("common.delete")}</button></td></tr>`; }).join("")}</tbody></table></div>` :
    UI.empty("sets.emptyTitle", "sets.emptyText", `<button class="btn primary" onclick="setActiveTab('setbuilder')">${t("nav.setbuilder")}</button>`)}</section>`;
}
function openSavedSet(id) {
  const s = state.sets.find((x) => x.id === id); if (!s) return false;
  state.currentSet = hydrateSet({ ...JSON.parse(JSON.stringify(s)), trackIds: s.trackIds.filter(findTrack) }); persistCurrentSet(); return true;
}
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#setsRoot")) return;
  const open = e.target.closest("[data-set-open]"), del = e.target.closest("[data-set-del]"), dup = e.target.closest("[data-set-dup]"), exp = e.target.closest("[data-set-export]");
  if (open) { if (openSavedSet(open.dataset.setOpen)) setActiveTab("setbuilder"); return; }
  if (exp) { if (openSavedSet(exp.dataset.setExport)) openExportDialog(); return; }
  if (dup) { const s = state.sets.find((x) => x.id === dup.dataset.setDup); if (s) { const now = Date.now(); state.sets.push({ ...JSON.parse(JSON.stringify(s)), id: uid("s_"), name: s.name + " " + t("sets.copySuffix"), createdAt: now, updatedAt: now }); persistSets(); renderActiveView(); } return; }
  if (del) { if (!(await askConfirm(t("sets.deleteAsk"), t("common.delete")))) return; state.sets = state.sets.filter((x) => x.id !== del.dataset.setDel); persistSets(); renderActiveView(); }
});

function renderExploreView(root) {
  root.innerHTML = `<section class="panel"><div class="hd"><div><h1>${t("explore.title")}</h1></div></div>
    <p class="dim" style="max-width:62ch;margin:16px 0">${t("explore.text")}</p>
    <dl class="kv" style="max-width:720px"><dt>${t("explore.local")}</dt><dd>${t("explore.localText")}</dd><dt>${t("explore.external")}</dt><dd>${t("explore.externalText")}</dd><dt>${t("explore.journey")}</dt><dd>${t("explore.journeyText")}</dd></dl></section>`;
}

/* ---------------- settings ---------------- */
const SIM_KEYS = ["rhythm", "timbre", "harmony", "energy", "structure", "tempo", "genre"], DJ_KEYS = ["tempo", "key", "rhythm", "groove", "energy", "structure", "genre"];
const SIM_PRESETS = {
  balanced: { ...SIM_WEIGHTS },
  rhythm: { rhythm: 0.40, timbre: 0.15, harmony: 0.10, energy: 0.15, structure: 0.05, tempo: 0.10, genre: 0.05 },
  sound: { rhythm: 0.15, timbre: 0.40, harmony: 0.15, energy: 0.10, structure: 0.05, tempo: 0.05, genre: 0.10 },
  harmony: { rhythm: 0.15, timbre: 0.15, harmony: 0.40, energy: 0.10, structure: 0.05, tempo: 0.10, genre: 0.05 },
};
const DJ_PRESETS = {
  balanced: { ...DJ_WEIGHTS },
  harmonic: { tempo: 0.18, key: 0.34, rhythm: 0.10, groove: 0.06, energy: 0.12, structure: 0.10, genre: 0.10 },
  tempo: { tempo: 0.36, key: 0.16, rhythm: 0.12, groove: 0.08, energy: 0.10, structure: 0.10, genre: 0.08 },
  energy: { tempo: 0.16, key: 0.14, rhythm: 0.12, groove: 0.08, energy: 0.30, structure: 0.12, genre: 0.08 },
};
const STEP_MAX = 50, STEP_COUNT = 10;
function weightRows(kind, weights, keys) {
  return keys.map((k) => { const pct = Math.round((weights[k] || 0) * 100), filled = Math.round((Math.min(pct, STEP_MAX) / STEP_MAX) * STEP_COUNT), lab = t((kind === "sim" ? "sim." : "dj.") + k);
    return `<div class="wrow"><span class="label">${lab}</span><div class="wsegs" data-wkind="${kind}" data-wkey="${k}" role="group" aria-label="${UI.esc(lab)}">${Array.from({ length: STEP_COUNT }, (_, i) => `<button class="wseg ${i < filled ? "f" : ""}" data-wstep="${i + 1}" aria-label="${(i + 1) * (STEP_MAX / STEP_COUNT)}%"></button>`).join("")}</div><span class="mono num" style="text-align:right">${pct}%</span></div>`; }).join("");
}
function presetRow(kind, presets, weights) {
  const active = Object.keys(presets).find((n) => Object.keys(presets[n]).every((k) => Math.round((weights[k] || 0) * 100) === Math.round(presets[n][k] * 100)));
  return `<div class="tagrow" style="margin-bottom:16px">${Object.keys(presets).map((n) => `<button class="chip ${n === active ? "on" : ""}" data-wpreset="${kind}|${n}">${t("preset." + n)}</button>`).join("")}</div>`;
}
function renderSettingsView(root) {
  const withA = state.library.filter((x) => x.analysis), ok = withA.filter((x) => sonicIdOf(x) && !sonicStale(x)).length, stale = withA.filter(sonicStale).length, missing = withA.length - ok - stale;
  const oldTracks = state.library.filter((x) => (x.analysisVersion || 0) < ANALYSIS_VERSION).length;
  let url = ""; try { url = localStorage.getItem("ts_api_url") || ""; } catch (e) {}
  const info = state.backendInfo;
  root.innerHTML = `<div id="settingsRoot" class="cols2" style="align-items:start"><div class="col">
      <section class="panel"><h2 style="margin:0 0 12px;font-size:17px">${t("set.language")}</h2><p class="dim" style="margin:0 0 12px">${t("set.languageText")}</p>${UI.seg([["ru", "Русский"], ["en", "English"]], LANG, "data-setlang")}</section>
      <section class="panel"><h2 style="margin:0 0 12px;font-size:17px">${t("onb.settingsTitle")}</h2><p class="dim" style="margin:0 0 12px">${t("onb.settingsText")}</p>
        <div class="toolbar"><button class="btn" id="onbShow">${t("onb.show")}</button><label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="onbSkip" ${state.ui.onboardingSkip ? "checked" : ""} style="width:auto"> ${t("onb.dontShow")}</label></div></section>
      <section class="panel"><h2 style="margin:0 0 12px;font-size:17px">${t("set.backend")}</h2><p class="dim" style="margin:0 0 12px">${t("set.backendText")}</p>
        <input id="apiUrlInput" placeholder="http://localhost:8000" value="${UI.esc(url || "http://localhost:8000")}" style="margin-bottom:12px">
        <div class="toolbar"><button class="btn primary" id="apiSave">${t("set.saveTest")}</button><button class="btn" id="apiClear">${t("common.clear")}</button></div><div class="mono dim" id="apiStatus" style="margin-top:12px">${info ? backendLine(info) : ""}</div></section>
      <section class="panel"><h2 style="margin:0 0 12px;font-size:17px">${t("set.embeddings")}</h2><p class="dim" style="margin:0 0 12px">${t("set.embeddingsText")}</p>
        <div class="mono dim">${t("set.embStatus", { ok, total: state.library.length, missing, stale })}${info && info.sonic ? `<br>${t("set.backendModel")}: ${UI.esc(info.sonic.model)} v${UI.esc(info.sonic.modelVersion)}` : `<br><span style="color:var(--error)">${t("status.offline")}</span>`}</div>
        <div class="toolbar" style="margin-top:12px"><button class="btn" id="sonicCompute">${t("set.computeMissing")}</button><button class="btn" id="sonicRecal" data-tip="${UI.esc(t("set.recalTip"))}">${t("set.recalibrate")}</button></div></section>
      <section class="panel"><h2 style="margin:0 0 12px;font-size:17px">${t("set.data")}</h2><p class="dim" style="margin:0 0 12px">${t("set.dataText")}</p><button class="btn danger" id="clearAllData">${t("set.clearAll")}</button></section></div>
    <div class="col">
      <section class="panel"><h2 style="margin:0 0 12px;font-size:17px">${t("set.simWeights")}</h2><p class="dim" style="margin:0 0 12px">${t("set.simWeightsText")}</p>${presetRow("sim", SIM_PRESETS, state.weights.sim)}${weightRows("sim", state.weights.sim, SIM_KEYS)}<button class="linkbtn" id="resetSimWeights">${t("set.reset")}</button></section>
      <section class="panel"><h2 style="margin:0 0 12px;font-size:17px">${t("set.djWeights")}</h2><p class="dim" style="margin:0 0 12px">${t("set.djWeightsText")}</p>${presetRow("dj", DJ_PRESETS, state.weights.dj)}${weightRows("dj", state.weights.dj, DJ_KEYS)}<button class="linkbtn" id="resetDjWeights">${t("set.reset")}</button></section>
      <section class="panel"><h2 style="margin:0 0 12px;font-size:17px">${t("set.about")}</h2>
        <dl class="kv"><dt>${t("set.version")}</dt><dd class="mono">${APP_VERSION}</dd><dt>${t("set.analysisVersion")}</dt><dd class="mono">${ANALYSIS_VERSION}${oldTracks ? ` <span class="faint">· ${t("set.olderTracks", { n: oldTracks })}</span>` : ""}</dd><dt>${t("set.calibration")}</dt><dd class="mono">${DjCalibration ? t("set.calibTracks", { n: DjCalibration.tracks }) : UI.NA}</dd></dl>
        <p class="dim" style="margin:12px 0 0">${t("set.privacy")}</p><p class="dim" style="margin:12px 0 0">${t("set.credits")}</p></section></div></div>`;
}
function backendLine(h) {
  return t("set.backendOnline", { e: UI.esc(h.essentia || t("set.portable")), s: h.structure && h.structure.available ? t("common.yes") : t("common.no"), so: h.sonic && h.sonic.available ? t("common.yes") + " (" + UI.esc(h.sonic.runtime || "?") + ")" : t("common.no") });
}
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#settingsRoot")) return;
  const lg = e.target.closest("[data-setlang]"); if (lg) { setLang(lg.dataset.setlang); return; }
  if (e.target.closest("#onbShow")) { startOnboarding(true); return; }
  const seg = e.target.closest("[data-wstep]");
  if (seg) { const g = seg.parentElement, w = state.weights[g.dataset.wkind]; w[g.dataset.wkey] = (+seg.dataset.wstep * STEP_MAX) / STEP_COUNT / 100; persistWeights(); renderActiveView(); return; }
  const pr = e.target.closest("[data-wpreset]");
  if (pr) { const [k, n] = pr.dataset.wpreset.split("|"); state.weights[k] = { ...(k === "sim" ? SIM_PRESETS : DJ_PRESETS)[n] }; persistWeights(); renderActiveView(); toast(t("set.presetApplied", { n: t("preset." + n) })); return; }
  if (e.target.closest("#resetSimWeights")) { state.weights.sim = { ...SIM_WEIGHTS }; persistWeights(); renderActiveView(); return; }
  if (e.target.closest("#resetDjWeights")) { state.weights.dj = { ...DJ_WEIGHTS }; persistWeights(); renderActiveView(); return; }
  if (e.target.closest("#apiSave")) {
    const v = document.getElementById("apiUrlInput").value.trim();
    try { v ? localStorage.setItem("ts_api_url", v) : localStorage.removeItem("ts_api_url"); } catch (er) {}
    const st = document.getElementById("apiStatus"); st.textContent = t("set.checking");
    const h = await refreshBackendPill();
    st.innerHTML = h.online ? backendLine(h.info) : `${t("set.offline", { r: UI.esc(h.reason) })}${h.reason === "unreachable" ? `<br>${t("set.startBackend")} <span style='color:var(--text)'>npm run dev</span>` : ""}`;
    return;
  }
  if (e.target.closest("#apiClear")) { try { localStorage.removeItem("ts_api_url"); } catch (er) {} document.getElementById("apiUrlInput").value = ""; document.getElementById("apiStatus").textContent = ""; refreshBackendPill(); return; }
  if (e.target.closest("#sonicCompute")) {
    const todo = state.library.filter((x) => x.analysis && (!sonicIdOf(x) || sonicStale(x)));
    if (!todo.length) { toast(t("set.allCurrent")); return; }
    let n = 0, noAudio = 0; for (const x of todo) { if (!(await getAudioBlob(x.id))) { noAudio++; continue; } n++; runSonicOnly(x.id); }
    toast(t("set.queued", { n }) + (noAudio ? " · " + t("set.noAudioN", { n: noAudio }) : "")); return;
  }
  if (e.target.closest("#sonicRecal")) { const r = await BackendClient.sonicRecalibrate(state.library.map(sonicIdOf).filter(Boolean)); if (!r.ok) { toast(t("set.recalFail", { r: r.reason })); return; } invalidateSonic(); toast(t("set.recalDone", { n: r.result.tracks })); return; }
  if (e.target.closest("#clearAllData")) {
    if (!(await askConfirm(t("set.clearAsk"), t("set.clearAllOk")))) return;
    stopPlayer(); AudioStore.clear(); sessionFiles.clear();
    state.library = []; state.sets = []; state.currentSet = newSet(); state.crate = []; state.currentTrackId = null; state.queue = []; state.selected.clear();
    transitionCache.invalidate(); persistLibrary(); persistSets(); persistCurrentSet(); persistCrate(); invalidateSonic(); renderActiveView(); toast(t("set.cleared"));
  }
});
document.addEventListener("change", (e) => { if (e.target.id === "onbSkip") { state.ui.onboardingSkip = e.target.checked; persistUi(); } });
