/* =================== NOESIS app state, engine glue, dialogs, routing =================== */
const LS_LIB = "ts_v2_library";   // keys kept as-is: existing libraries and sets must keep loading
const LS_SETS = "ts_v2_sets";
const LS_WEIGHTS = "ts_v3_weights";
const LS_UI = "noesis_ui";
const ANALYSIS_STEPS = ["Loading audio", "Detecting BPM", "Detecting key", "Analyzing rhythm", "Analyzing drums", "Analyzing melody", "Analyzing harmony", "Analyzing structure", "Detecting genre", "Building profile"];

/* ---- engine glue: the v2 similarity / compatibility engine lives in audio/dj-engine.js ---- */
const SIM_WEIGHTS = DjEngine.SIM_WEIGHTS, DJ_WEIGHTS = DjEngine.DJ_WEIGHTS, KEY_WEIGHTS = DjEngine.KEY_WEIGHTS;
function trackToEngineShape(t) {
  const an = t.analysis || {}, st = an.structure && an.structure.status === "AVAILABLE" ? an.structure : null;
  const bk = an.backend && an.backend.status === "AVAILABLE" ? an.backend : null;
  return {
    id: t.id, bpm: t.bpm, key: t.key, genre: t.genre, profile: t.profile, featureGroups: t.featureGroups,
    energyCurve: t.structure && t.structure.energyCurve ? t.structure.energyCurve : null,
    introBars: st ? st.introBars : null, outroBars: st ? st.outroBars : null, durationSec: t.durationSec,
    beatCv: bk && bk.bpm.beatIntervalCv != null ? bk.bpm.beatIntervalCv : null,
    backendDance: bk && bk.rhythm && bk.rhythm.danceability != null ? bk.rhythm.danceability : null,
    mfcc: bk && bk.timbre && bk.timbre.mfccMean ? bk.timbre.mfccMean : null,
  };
}
const computeSimilarity = (a, b, w = SIM_WEIGHTS, kw = KEY_WEIGHTS) => DjEngine.similarity(a, b, w, kw);
const computeDjCompatibility = (a, b, w = DJ_WEIGHTS, kw = KEY_WEIGHTS, ctx) => DjEngine.djCompat(a, b, w, kw, ctx);

function loadJSON(key, fallback) { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch (e) { return fallback; } }
function saveJSON(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn("localStorage unavailable", e); if (typeof toast === "function") toast("Browser storage is full — some data was not saved"); } }

function loadWeights() {
  const w = loadJSON(LS_WEIGHTS, null), ok = (o, ref) => o && Object.keys(ref).every((k) => typeof o[k] === "number");
  return w && ok(w.sim, SIM_WEIGHTS) && ok(w.dj, DJ_WEIGHTS) ? w : { sim: { ...SIM_WEIGHTS }, dj: { ...DJ_WEIGHTS } };
}
const uiPrefs = loadJSON(LS_UI, {});
const state = {
  library: loadJSON(LS_LIB, []),
  sets: loadJSON(LS_SETS, []),
  weights: loadWeights(),
  currentTrackId: null, detailId: null, backendInfo: null,
  currentSet: { name: "Untitled set", trackIds: [] },
  tab: "analyze", trackTab: "overview", waveStyle: uiPrefs.waveStyle || "mono",
  queue: [], shuffle: false, repeat: "off", selected: new Set(),
  sort: { key: "analyzedAt", dir: -1 }, libRef: null,
  filters: { bpmMin: null, bpmMax: null, energyMin: null, energyMax: null, minSim: null, genres: new Set(), keys: new Set(), status: "", query: "" },
};
function persistLibrary() { saveJSON(LS_LIB, state.library); }
function persistSets() { saveJSON(LS_SETS, state.sets); }
function persistWeights() { saveJSON(LS_WEIGHTS, state.weights); }
function persistUi() { saveJSON(LS_UI, { waveStyle: state.waveStyle }); }

const escapeHtml = UI.esc;
function findTrack(id) { return state.library.find((t) => t.id === id); }
const GENRE_COLORS = {};
function colorForGenre() { return "var(--text-2)"; } // genre is never colour-coded: colour is reserved for structure/status
function fmtTime(sec) { if (!isFinite(sec)) return "0:00"; const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return m + ":" + String(s).padStart(2, "0"); }

function toast(msg) {
  const root = document.getElementById("toastRoot");
  const el = document.createElement("div");
  el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
  root.innerHTML = ""; root.appendChild(el);
  setTimeout(() => { if (root.contains(el)) root.removeChild(el); }, 2400);
}

/* ---- filters (shared by Analyze list, Library, Set Builder picker) ---- */
function passFilters(t, f = state.filters) {
  if (f.bpmMin != null && t.bpm < f.bpmMin) return false;
  if (f.bpmMax != null && t.bpm > f.bpmMax) return false;
  if (f.energyMin != null && t.profile.energy < f.energyMin) return false;
  if (f.energyMax != null && t.profile.energy > f.energyMax) return false;
  if (f.genres.size && !f.genres.has(t.genre.primary)) return false;
  if (f.keys.size && !f.keys.has(t.key.camelot)) return false;
  if (f.query) { const q = f.query.toLowerCase(); if (!(t.title + " " + t.artist + " " + t.genre.primary).toLowerCase().includes(q)) return false; }
  const an = t.analysis || {};
  if (f.status === "COMPLETE" && an.status !== "COMPLETE") return false;
  if (f.status === "STRUCTURE" && !(an.structure && an.structure.status === "AVAILABLE")) return false;
  if (f.status === "SONIC" && !(an.sonic && an.sonic.status === "AVAILABLE")) return false;
  if (f.status === "NOAUDIO" && (sessionFiles.has(t.id) || t.hasAudio)) return false;
  return true;
}
function filtersActive() { const f = state.filters; return f.bpmMin != null || f.bpmMax != null || f.energyMin != null || f.energyMax != null || f.minSim != null || f.genres.size || f.keys.size || f.status || f.query; }

function renderFilterTags() {
  const genres = [...new Set(state.library.map((t) => t.genre.primary))].sort();
  const keys = [...new Set(state.library.map((t) => t.key.camelot))].filter((k) => k && k !== "unknown").sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
  const tags = (arr, set, attr) => arr.length ? arr.map((v) => `<button type="button" class="tag ${set.has(v) ? "on" : ""}" ${attr}="${escapeHtml(v)}" aria-pressed="${set.has(v)}">${escapeHtml(v)}</button>`).join("") : `<span class="mono faint">No tracks yet</span>`;
  document.getElementById("fGenreTags").innerHTML = tags(genres, state.filters.genres, "data-fgenre");
  document.getElementById("fKeyTags").innerHTML = tags(keys, state.filters.keys, "data-fkey");
}
function readFilterInputs() {
  const n = (id) => { const v = parseFloat(document.getElementById(id).value); return isFinite(v) ? v : null; };
  const f = state.filters;
  f.bpmMin = n("fBpmMin"); f.bpmMax = n("fBpmMax"); f.energyMin = n("fEnergyMin"); f.energyMax = n("fEnergyMax"); f.minSim = n("fMinSim");
  f.status = document.getElementById("fStatus").value;
}
let filterTimer = 0;
function onFiltersChanged() { clearTimeout(filterTimer); filterTimer = setTimeout(() => { renderActiveView(); }, 120); }
["fBpmMin", "fBpmMax", "fEnergyMin", "fEnergyMax", "fMinSim", "fStatus"].forEach((id) => document.getElementById(id).addEventListener("input", () => { readFilterInputs(); onFiltersChanged(); }));
document.getElementById("sidebar").addEventListener("click", (e) => {
  const g = e.target.closest("[data-fgenre]"), k = e.target.closest("[data-fkey]");
  const flip = (set, v) => set.has(v) ? set.delete(v) : set.add(v);
  if (g) flip(state.filters.genres, g.dataset.fgenre); else if (k) flip(state.filters.keys, k.dataset.fkey); else return;
  renderFilterTags(); renderActiveView();
});
document.getElementById("filtersReset").addEventListener("click", () => {
  Object.assign(state.filters, { bpmMin: null, bpmMax: null, energyMin: null, energyMax: null, minSim: null, status: "", query: "" });
  state.filters.genres.clear(); state.filters.keys.clear();
  ["fBpmMin", "fBpmMax", "fEnergyMin", "fEnergyMax", "fMinSim"].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("fStatus").value = ""; document.getElementById("globalSearch").value = "";
  renderFilterTags(); renderActiveView();
});
document.getElementById("globalSearch").addEventListener("input", (e) => {
  state.filters.query = e.target.value.trim();
  if (state.filters.query && state.tab !== "library") setActiveTab("library"); else onFiltersChanged();
});

/* ---- routing ---- */
const TABS = ["analyze", "library", "setbuilder", "sets", "explore", "settings"];
function setActiveTab(tab, { push = true } = {}) {
  if (!TABS.includes(tab)) tab = "analyze";
  state.tab = tab;
  document.querySelectorAll("#mainNav button, #sideNav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  TABS.forEach((t) => document.getElementById("tab-" + t).classList.toggle("hidden", t !== tab));
  document.getElementById("workspace").scrollTop = 0;
  if (push) { try { history.replaceState(null, "", "#" + tab); } catch (e) {} }
  renderFilterTags(); renderActiveView();
}
function renderActiveView() {
  ({ analyze: () => renderAnalyzeView(), library: () => renderLibraryView(), setbuilder: () => renderSetBuilderView(), sets: () => renderSetsView(),
     explore: () => renderExploreView(), settings: () => renderSettingsView() })[state.tab]();
  renderContext();
}
document.querySelectorAll("#mainNav button, #sideNav button").forEach((b) => b.addEventListener("click", () => setActiveTab(b.dataset.tab)));
document.getElementById("settingsBtn").addEventListener("click", () => setActiveTab("settings"));

/* ---- dialogs (window.prompt/confirm are blocked in embedded webviews) ---- */
function openModal(innerHtml) {
  document.getElementById("modalRoot").innerHTML = `<div class="overlay" onclick="if(event.target===this) closeModal()"><div class="dialog wide" role="dialog" aria-modal="true">${innerHtml}</div></div>`;
}
function closeModal() { document.getElementById("modalRoot").innerHTML = ""; }
function modalShell(title, bodyHtml) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="margin:0">${title}</h3><button class="iconbtn" onclick="closeModal()" aria-label="Close">${UI.icon("close")}</button></div><div>${bodyHtml}</div>`;
}
function openForm(title, fields, okLabel = "OK") {
  return new Promise((resolve) => {
    const root = document.getElementById("dialogRoot");
    root.innerHTML = `<div class="overlay"><form class="dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <h3>${escapeHtml(title)}</h3>
      ${fields.map((f, i) => `<label class="label" for="dlg_${i}">${escapeHtml(f.label)}</label><input id="dlg_${i}" name="${f.name}" value="${escapeHtml(f.value ?? "")}" autocomplete="off">`).join("")}
      <div class="row"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">${escapeHtml(okLabel)}</button></div></form></div>`;
    const done = (v) => { root.innerHTML = ""; document.removeEventListener("keydown", onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
    document.addEventListener("keydown", onKey, true);
    const form = root.querySelector("form");
    form.addEventListener("submit", (e) => { e.preventDefault(); const o = {}; fields.forEach((f, i) => (o[f.name] = form.elements[i].value)); done(o); });
    form.querySelector("[data-cancel]").addEventListener("click", () => done(null));
    root.querySelector(".overlay").addEventListener("mousedown", (e) => { if (e.target.classList.contains("overlay")) done(null); });
    const first = form.elements[0]; if (first) { first.focus(); first.select(); }
  });
}
function askConfirm(message, okLabel = "OK") {
  return new Promise((resolve) => {
    const root = document.getElementById("dialogRoot");
    root.innerHTML = `<div class="overlay"><div class="dialog" role="alertdialog" aria-modal="true"><h3>${escapeHtml(message)}</h3>
      <div class="row"><button class="btn" data-no>Cancel</button><button class="btn danger" data-yes>${escapeHtml(okLabel)}</button></div></div></div>`;
    const done = (v) => { root.innerHTML = ""; document.removeEventListener("keydown", onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    document.addEventListener("keydown", onKey, true);
    root.querySelector("[data-no]").addEventListener("click", () => done(false));
    root.querySelector("[data-yes]").addEventListener("click", () => done(true));
    root.querySelector("[data-yes]").focus();
  });
}

/* ---- small anchored menu (Add to…, more) ---- */
function openMenu(anchor, items) {
  const root = document.getElementById("menuRoot"); closeMenu();
  const r = anchor.getBoundingClientRect();
  root.innerHTML = `<div class="menu" role="menu" style="left:${Math.max(8, Math.min(window.innerWidth - 220, r.left))}px; top:${r.bottom + 4}px">${items.map((it, i) => it.sep ? "" : `<button role="menuitem" data-mi="${i}">${escapeHtml(it.label)}</button>`).join("")}</div>`;
  root.querySelectorAll("[data-mi]").forEach((b) => b.addEventListener("click", () => { closeMenu(); items[+b.dataset.mi].run(); }));
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
}
function closeMenu() { document.getElementById("menuRoot").innerHTML = ""; }
