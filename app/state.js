/* =================== a.to.b app state, engine glue, dialogs, routing =================== */
const LS_LIB = "ts_v2_library";   // keys kept as-is: existing libraries and sets keep loading after the rename
const LS_SETS = "ts_v2_sets";
const LS_WEIGHTS = "ts_v3_weights";
const LS_UI = "atob_ui";
const LS_UI_OLD = "noesis_ui";
const LS_CURRENT = "atob_current_set";
const LS_CRATE = "atob_crate";
const UNKNOWN_ARTIST = "Unknown artist";  // stored value; shown translated via dispArtist()
const APP_VERSION = "0.5.0";
const ANALYSIS_VERSION = 6;       // bump when stored analysis fields change shape; older tracks are migrated, never silently re-analysed

/* ---- engine glue: the similarity / compatibility engine lives in audio/dj-engine.js ---- */
const SIM_WEIGHTS = DjEngine.SIM_WEIGHTS, DJ_WEIGHTS = DjEngine.DJ_WEIGHTS, KEY_WEIGHTS = DjEngine.KEY_WEIGHTS;
const _shapeCache = new WeakMap();
function trackToEngineShape(t) {
  let s = _shapeCache.get(t); if (s) return s;
  const an = t.analysis || {}, st = an.structure && an.structure.status === "AVAILABLE" ? an.structure : null;
  const bk = an.backend && an.backend.status === "AVAILABLE" ? an.backend : null;
  const grid = trackGrid(t);
  s = {
    id: t.id, bpm: t.bpm, bpmReliability: an.bpm ? an.bpm.reliability : null, key: t.key, genre: t.genre, styles: genreStyles(t), profile: t.profile, featureGroups: t.featureGroups,
    energyCurve: t.structure && t.structure.energyCurve ? t.structure.energyCurve : null,
    introBars: st ? st.introBars : null, outroBars: st ? st.outroBars : null, durationSec: t.durationSec,
    beatCv: bk && bk.bpm.beatIntervalCv != null ? bk.bpm.beatIntervalCv : null,
    backendDance: bk && bk.rhythm && bk.rhythm.danceability != null ? bk.rhythm.danceability : null,
    mfcc: bk && bk.timbre && bk.timbre.mfccMean ? bk.timbre.mfccMean : null,
    downbeats: grid ? grid.downbeats : null, gridKind: grid ? grid.kind : null, segments: st ? st.segments : null,
  };
  _shapeCache.set(t, s); return s;
}
// bar grid of a track: analysed downbeats (All-In-One), else a constant-tempo grid from BPM + first beat (flagged "estimated"), else none
function trackGrid(t) {
  const an = t.analysis || {}, st = an.structure && an.structure.status === "AVAILABLE" ? an.structure : null;
  if (t._grid !== undefined && t._gridSrc === st) return t._grid;
  let g = null;
  if (st && st.grid) { const d = Grid.decode(st.grid); if (d && d.length > 7) g = { downbeats: d, kind: "analyzed" }; }
  if (!g) {
    const first = st && st.firstDownbeat != null ? st.firstDownbeat : an.backend && an.backend.status === "AVAILABLE" ? an.backend.bpm.firstBeatSec : null;
    const d = first != null ? Grid.synthesize(first, t.bpm, t.durationSec) : null;
    if (d && d.length > 7) g = { downbeats: d, kind: "estimated" };
  }
  Object.defineProperty(t, "_grid", { value: g, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(t, "_gridSrc", { value: st, writable: true, configurable: true, enumerable: false });
  return g;
}
function genreStyles(t) {
  const ts = t.analysis && t.analysis.sonic && t.analysis.sonic.status === "AVAILABLE" && t.analysis.sonic.topStyles;
  if (!ts || ts.length < 3) return null;
  const o = {}; ts.forEach((x) => (o[x.label] = x.score)); return o;
}
const computeSimilarity = (a, b, w = SIM_WEIGHTS, kw = KEY_WEIGHTS) => DjEngine.similarity(a, b, w, kw);
const computeDjCompatibility = (a, b, w = DJ_WEIGHTS, kw = KEY_WEIGHTS, ctx) => DjEngine.djCompat(a, b, w, kw, ctx);

/* ---- transition cache: a pair is computed once; reorders only touch the pairs that did not exist before ---- */
const transitionCache = new SetTools.TransitionCache((a, b) => {
  const A = trackToEngineShape(a), B = trackToEngineShape(b);
  const compat = computeDjCompatibility(A, B, state.weights.dj, KEY_WEIGHTS, { bpmReliability: [A.bpmReliability, B.bpmReliability] });
  return { compat, guide: Transition.guide(A, B, { compat }) };
});
// compat + guide for two library tracks, with any manual mix points applied
function transitionOf(a, b) {
  const base = transitionCache.get(a, b), man = state.currentSet.manualMix[a.id + "|" + b.id];
  return { compat: base.compat, guide: man ? Transition.applyManual(base.guide, trackToEngineShape(a), trackToEngineShape(b), man) : base.guide };
}
function touchTrack(id) { // analysis / BPM / key / genre changed: drop everything derived from this track
  const t = findTrack(id); if (t) { _shapeCache.delete(t); delete t._grid; }
  transitionCache.invalidateTrack(id);
}

function loadJSON(key, fallback) { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch (e) { return fallback; } }
function saveJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn("localStorage unavailable", e); if (typeof toast === "function") toast(t("toast.storageFull")); } }

function loadWeights() {
  const w = loadJSON(LS_WEIGHTS, null), ok = (o, ref) => o && Object.keys(ref).every((k) => typeof o[k] === "number");
  return w && ok(w.sim, SIM_WEIGHTS) && ok(w.dj, DJ_WEIGHTS) ? w : { sim: { ...SIM_WEIGHTS }, dj: { ...DJ_WEIGHTS } };
}
const uiPrefs = loadJSON(LS_UI, null) || loadJSON(LS_UI_OLD, {});
function newSet(name) {
  return { id: null, name: name || t("set.untitled"), trackIds: [], locked: [], roles: {}, manualMix: {}, build: { length: 60, curve: "journey", pts: DjEngine.CURVES.journey.pts.slice(), mode: "manual", character: "balanced", seed: 1, keepFirst: true } };
}
function hydrateSet(s) {
  const d = newSet(s && s.name);
  const o = { ...d, ...(s || {}) }; o.build = { ...d.build, ...((s && s.build) || {}) };
  o.locked = (o.locked || []).slice(); o.roles = o.roles || {}; o.manualMix = o.manualMix || {}; o.trackIds = (o.trackIds || []).slice();
  return o;
}
const state = {
  library: loadJSON(LS_LIB, []),
  sets: loadJSON(LS_SETS, []),
  weights: loadWeights(),
  currentTrackId: null, backendInfo: null,
  currentSet: null,
  crate: loadJSON(LS_CRATE, []),
  tab: "analyze", trackTab: "overview", waveStyle: uiPrefs.waveStyle || "mono",
  queue: [], shuffle: false, repeat: "off", selected: new Set(),
  sort: { key: "analyzedAt", dir: -1 }, libRef: null, libView: "table",
  filters: { bpmMin: null, bpmMax: null, energyMin: null, energyMax: null, minSim: null, genres: new Set(), keys: new Set(), status: "", query: "" },
  next: { mode: "safe" }, ui: { onboardingDone: !!uiPrefs.onboardingDone, onboardingSkip: !!uiPrefs.onboardingSkip },
};
state.currentSet = hydrateSet(loadJSON(LS_CURRENT, null));
function persistLibrary() { saveJSON(LS_LIB, state.library); }
function persistSets() { saveJSON(LS_SETS, state.sets); }
function persistWeights() { saveJSON(LS_WEIGHTS, state.weights); transitionCache.invalidate(); }
function persistUi() { saveJSON(LS_UI, { waveStyle: state.waveStyle, onboardingDone: state.ui.onboardingDone, onboardingSkip: state.ui.onboardingSkip }); }
function persistCurrentSet() { saveJSON(LS_CURRENT, state.currentSet); }
function persistCrate() { saveJSON(LS_CRATE, state.crate); }

const escapeHtml = UI.esc;
const dispArtist = (tr) => (!tr.artist || tr.artist === UNKNOWN_ARTIST ? t("track.unknownArtist") : tr.artist);
function findTrack(id) { return state.library.find((x) => x.id === id); }
function fmtTime(sec) { if (!isFinite(sec) || sec == null) return "0:00"; const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return m + ":" + String(s).padStart(2, "0"); }
function fmtDur(sec) { const m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0") + " " + t("unit.h") : m + " " + t("unit.min"); }
const uid = (p) => p + Math.random().toString(36).slice(2, 10);

function toast(msg) {
  const root = document.getElementById("toastRoot");
  const el = document.createElement("div");
  el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
  root.innerHTML = ""; root.appendChild(el);
  setTimeout(() => { if (root.contains(el)) root.removeChild(el); }, 2600);
}

/* ---- filters (Library, Set Builder crate picker) ---- */
function hasAudio(tr) { return sessionFiles.has(tr.id) || !!tr.hasAudio; }
function passFilters(tr, f = state.filters) {
  if (f.bpmMin != null && tr.bpm < f.bpmMin) return false;
  if (f.bpmMax != null && tr.bpm > f.bpmMax) return false;
  if (f.energyMin != null && tr.profile.energy < f.energyMin) return false;
  if (f.energyMax != null && tr.profile.energy > f.energyMax) return false;
  if (f.genres.size && !f.genres.has(tr.genre.primary)) return false;
  if (f.keys.size && !f.keys.has(tr.key.camelot)) return false;
  if (f.query) { const q = f.query.toLowerCase(); if (!(tr.title + " " + tr.artist + " " + tr.genre.primary).toLowerCase().includes(q)) return false; }
  const an = tr.analysis || {};
  if (f.status === "COMPLETE" && an.status !== "COMPLETE") return false;
  if (f.status === "STRUCTURE" && !(an.structure && an.structure.status === "AVAILABLE")) return false;
  if (f.status === "SONIC" && !(an.sonic && an.sonic.status === "AVAILABLE")) return false;
  if (f.status === "NOAUDIO" && hasAudio(tr)) return false;
  return true;
}
function filtersActive() { const f = state.filters; return f.bpmMin != null || f.bpmMax != null || f.energyMin != null || f.energyMax != null || f.minSim != null || f.genres.size || f.keys.size || f.status || f.query; }
function resetFilters() { Object.assign(state.filters, { bpmMin: null, bpmMax: null, energyMin: null, energyMax: null, minSim: null, status: "", query: "" }); state.filters.genres.clear(); state.filters.keys.clear(); }

/* ---- routing ---- */
const TABS = ["analyze", "library", "setbuilder", "sets", "explore", "settings"];
function setActiveTab(tab, { push = true } = {}) {
  if (!TABS.includes(tab)) tab = "analyze";
  state.tab = tab;
  document.querySelectorAll("#mainNav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("main").scrollTop = 0;
  if (push) { try { history.replaceState(null, "", "#" + tab); } catch (e) {} }
  renderActiveView();
}
function renderActiveView() {
  const fn = { analyze: "renderAnalyzeView", library: "renderLibraryView", setbuilder: "renderSetBuilderView", sets: "renderSetsView", explore: "renderExploreView", settings: "renderSettingsView" }[state.tab];
  const main = document.getElementById("main"), top = main.scrollTop;
  window[fn](document.getElementById("view"));
  main.scrollTop = top; updateTransportUI();
}
// static chrome that depends on language / backend state (nav labels live in index.html via data-i18n)
function renderChrome() {
  document.getElementById("logoSlot").innerHTML = UI.logo(30);
  document.getElementById("settingsBtn").innerHTML = UI.icon("gear");
  updateBackendPill();
}
document.querySelectorAll("#mainNav button").forEach((b) => b.addEventListener("click", () => setActiveTab(b.dataset.tab)));
document.getElementById("settingsBtn").addEventListener("click", () => setActiveTab("settings"));
document.getElementById("langBtn").addEventListener("click", () => setLang(LANG === "ru" ? "en" : "ru"));
document.getElementById("logoSlot").addEventListener("click", () => setActiveTab("analyze"));

/* ---- dialogs (window.prompt/confirm are blocked in embedded webviews) ---- */
const _dialogKeys = [];
function trapKeys(root, onEscape) {
  const h = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); onEscape(); }
    else if (e.key === "Tab") { const f = [...root.querySelectorAll("button,input,select,textarea,[tabindex]:not([tabindex='-1'])")].filter((x) => !x.disabled && x.offsetParent !== null); if (!f.length) return; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
  };
  document.addEventListener("keydown", h, true);
  return () => document.removeEventListener("keydown", h, true);
}
let _modalOff = null, _modalOpener = null;
function openModal(innerHtml, cls = "wide") {
  closeModal(true); _modalOpener = document.activeElement;
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="overlay"><div class="dialog ${cls}" role="dialog" aria-modal="true">${innerHtml}</div></div>`;
  root.querySelector(".overlay").addEventListener("mousedown", (e) => { if (e.target.classList.contains("overlay")) closeModal(); });
  _modalOff = trapKeys(root, () => closeModal());
  const f = root.querySelector("input,select,textarea,button:not(.iconbtn)"); if (f) f.focus({ preventScroll: true });
  return root.querySelector(".dialog");
}
function closeModal(silent) {
  document.getElementById("modalRoot").innerHTML = "";
  if (!silent) { try { stopTransition(); guideState = null; } catch (e) {} }
  if (_modalOff) { _modalOff(); _modalOff = null; }
  if (!silent && _modalOpener && _modalOpener.isConnected) { try { _modalOpener.focus({ preventScroll: true }); } catch (e) {} }
}
function modalShell(title, bodyHtml) {
  return `<div class="dhead"><h3>${title}</h3><button class="iconbtn" data-close-modal aria-label="${escapeHtml(t("common.close"))}">${UI.icon("close")}</button></div><div>${bodyHtml}</div>`;
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-close-modal]")) closeModal(); });
function openForm(title, fields, okLabel) {
  return new Promise((resolve) => {
    const root = document.getElementById("dialogRoot");
    root.innerHTML = `<div class="overlay"><form class="dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <h3>${escapeHtml(title)}</h3>
      ${fields.map((f, i) => `<label class="lab" for="dlg_${i}">${escapeHtml(f.label)}</label><input id="dlg_${i}" name="${f.name}" value="${escapeHtml(f.value ?? "")}" autocomplete="off">`).join("")}
      <div class="row"><button type="button" class="btn" data-cancel>${escapeHtml(t("common.cancel"))}</button><button type="submit" class="btn primary">${escapeHtml(okLabel || t("common.save"))}</button></div></form></div>`;
    const off = trapKeys(root, () => done(null));
    const done = (v) => { root.innerHTML = ""; off(); resolve(v); };
    const form = root.querySelector("form");
    form.addEventListener("submit", (e) => { e.preventDefault(); const o = {}; fields.forEach((f, i) => (o[f.name] = form.elements[i].value)); done(o); });
    form.querySelector("[data-cancel]").addEventListener("click", () => done(null));
    root.querySelector(".overlay").addEventListener("mousedown", (e) => { if (e.target.classList.contains("overlay")) done(null); });
    const first = form.elements[0]; if (first) { first.focus(); first.select(); }
  });
}
function askConfirm(message, okLabel, danger = true) {
  return new Promise((resolve) => {
    const root = document.getElementById("dialogRoot");
    root.innerHTML = `<div class="overlay"><div class="dialog" role="alertdialog" aria-modal="true"><h3>${escapeHtml(message)}</h3>
      <div class="row"><button class="btn" data-no>${escapeHtml(t("common.cancel"))}</button><button class="btn ${danger ? "danger" : "primary"}" data-yes>${escapeHtml(okLabel || t("common.ok"))}</button></div></div></div>`;
    const off = trapKeys(root, () => done(false));
    const done = (v) => { root.innerHTML = ""; off(); resolve(v); };
    root.querySelector("[data-no]").addEventListener("click", () => done(false));
    root.querySelector("[data-yes]").addEventListener("click", () => done(true));
    root.querySelector("[data-yes]").focus();
  });
}

/* ---- small anchored menu (Add to…, more) ---- */
function openMenu(anchor, items) {
  const root = document.getElementById("menuRoot"); closeMenu();
  const r = anchor.getBoundingClientRect();
  root.innerHTML = `<div class="menu" role="menu" style="left:${Math.max(8, Math.min(window.innerWidth - 230, r.left))}px; top:${Math.min(r.bottom + 4, window.innerHeight - 40 - items.length * 36)}px">${items.map((it, i) => it.sep ? `<hr>` : `<button role="menuitem" data-mi="${i}"${it.disabled ? " disabled" : ""}>${escapeHtml(it.label)}</button>`).join("")}</div>`;
  root.querySelectorAll("[data-mi]").forEach((b) => b.addEventListener("click", () => { closeMenu(); items[+b.dataset.mi].run(); }));
  const first = root.querySelector("[data-mi]"); if (first) first.focus({ preventScroll: true });
  root.querySelector(".menu").addEventListener("keydown", (e) => { const bs = [...root.querySelectorAll("[data-mi]")], i = bs.indexOf(document.activeElement); if (e.key === "ArrowDown") { e.preventDefault(); bs[(i + 1) % bs.length].focus(); } else if (e.key === "ArrowUp") { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); } else if (e.key === "Escape") closeMenu(); });
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
}
function closeMenu() { document.getElementById("menuRoot").innerHTML = ""; }

/* ---- contextual help: [data-tip] shows its text on hover / focus / tap ---- */
(function () {
  const root = () => document.getElementById("tipRoot"); let cur = null;
  function show(el) {
    const txt = el.getAttribute("data-tip"); if (!txt) return; hide(); cur = el;
    const r = el.getBoundingClientRect(), box = document.createElement("div"); box.className = "tip"; box.setAttribute("role", "tooltip"); box.textContent = txt;
    root().appendChild(box); const bw = box.offsetWidth, bh = box.offsetHeight;
    box.style.left = Math.max(8, Math.min(window.innerWidth - bw - 8, r.left + r.width / 2 - bw / 2)) + "px";
    box.style.top = (r.bottom + bh + 12 < window.innerHeight ? r.bottom + 8 : r.top - bh - 8) + "px";
  }
  function hide() { cur = null; root().innerHTML = ""; }
  document.addEventListener("mouseover", (e) => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el && el !== cur) show(el); else if (!el && cur) hide(); });
  document.addEventListener("focusin", (e) => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el) show(el); });
  document.addEventListener("focusout", hide);
  document.addEventListener("click", (e) => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el && cur !== el) show(el); else if (!el) hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.addEventListener("scroll", hide, true);
})();
