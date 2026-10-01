/* =================== Sets, Explore, Settings =================== */
function renderSetsView() {
  const root = document.getElementById("setsView");
  const rows = state.sets.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  root.innerHTML = `<div style="margin-bottom:var(--s5)"><h1 class="h2">Sets</h1><div class="mono dim" style="margin-top:6px">${rows.length} saved</div></div>
    ${rows.length ? `<table class="t"><thead><tr><th>Set</th><th>Tracks</th><th>Duration</th><th>BPM</th><th>Updated</th><th></th></tr></thead><tbody>${rows.map((s) => {
      const tr = s.trackIds.map(findTrack).filter(Boolean), bpms = tr.map((t) => t.bpm), eff = Math.round(effectiveSeconds(tr) / 60);
      return `<tr class="row" data-set="${s.id}"><td style="font-size:16px">${UI.esc(s.name)}</td><td class="num">${tr.length}</td><td class="num">${eff} min</td><td class="num">${bpms.length ? Math.min(...bpms).toFixed(0) + "–" + Math.max(...bpms).toFixed(0) : UI.NA}</td><td class="mono dim">${new Date(s.updatedAt).toLocaleDateString()}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-set-open="${s.id}">Open in builder</button> <button class="btn sm danger" data-set-del="${s.id}">Delete</button></td></tr>`; }).join("")}</tbody></table>` :
    `<div class="empty" style="padding-left:0">No saved sets. Build one in <button class="linkbtn" onclick="setActiveTab('setbuilder')">Set Builder</button> and press Save set.</div>`}`;
}
document.getElementById("setsView").addEventListener("click", async (e) => {
  const open = e.target.closest("[data-set-open]"), del = e.target.closest("[data-set-del]");
  if (open) { const s = state.sets.find((x) => x.id === open.dataset.setOpen); if (s) { state.currentSet = { id: s.id, name: s.name, trackIds: s.trackIds.filter(findTrack), createdAt: s.createdAt, updatedAt: s.updatedAt }; setActiveTab("setbuilder"); } return; }
  if (del) { if (!(await askConfirm("Delete this set?", "Delete"))) return; state.sets = state.sets.filter((x) => x.id !== del.dataset.setDel); persistSets(); renderSetsView(); }
});

function renderExploreView() {
  document.getElementById("exploreView").innerHTML = `<h1 class="display" style="font-size:clamp(30px,3.6vw,50px)">Discover outside<br>your library</h1>
    <p class="dim" style="max-width:56ch;margin:var(--s5) 0">Not connected yet. Everything NOESIS compares today lives in your own library — audio never leaves your machine.</p>
    <dl class="kv" style="max-width:640px"><dt>Local similarity</dt><dd>Active — Discogs-EffNet embeddings searched in your library</dd><dt>External discovery</dt><dd>Prepared in the backend (<span class="mono">SimilarityProvider</span>), no provider enabled. Any API key would live on the server only, never in this page.</dd><dt>Sonic journey</dt><dd>Prepared (<span class="mono">POST /api/sonic/journey</span>), no interface yet</dd></dl>`;
}

/* ---------------- settings ---------------- */
const WEIGHT_LABELS_SIM = { rhythm: "Rhythm", timbre: "Timbre", harmony: "Harmony", energy: "Energy", structure: "Structure", tempo: "Tempo", genre: "Genre" };
const WEIGHT_LABELS_DJ = { tempo: "Tempo", key: "Camelot", rhythm: "Rhythm", groove: "Groove", energy: "Energy flow", structure: "Structure", genre: "Genre" };
const SIM_PRESETS = {
  Balanced: { ...SIM_WEIGHTS },
  "Rhythm first": { rhythm: 0.40, timbre: 0.15, harmony: 0.10, energy: 0.15, structure: 0.05, tempo: 0.10, genre: 0.05 },
  "Sound first": { rhythm: 0.15, timbre: 0.40, harmony: 0.15, energy: 0.10, structure: 0.05, tempo: 0.05, genre: 0.10 },
  "Harmony first": { rhythm: 0.15, timbre: 0.15, harmony: 0.40, energy: 0.10, structure: 0.05, tempo: 0.10, genre: 0.05 },
};
const DJ_PRESETS = {
  Balanced: { ...DJ_WEIGHTS },
  "Harmonic mixing": { tempo: 0.18, key: 0.34, rhythm: 0.10, groove: 0.06, energy: 0.12, structure: 0.10, genre: 0.10 },
  "Tempo critical": { tempo: 0.36, key: 0.16, rhythm: 0.12, groove: 0.08, energy: 0.10, structure: 0.10, genre: 0.08 },
  "Energy flow": { tempo: 0.16, key: 0.14, rhythm: 0.12, groove: 0.08, energy: 0.30, structure: 0.12, genre: 0.08 },
};
const STEP_MAX = 50, STEP_COUNT = 10;
function weightRows(kind, weights, labels) {
  return Object.keys(labels).map((k) => { const pct = Math.round((weights[k] || 0) * 100), filled = Math.round((Math.min(pct, STEP_MAX) / STEP_MAX) * STEP_COUNT);
    return `<div class="wrow"><span class="label">${labels[k]}</span><div class="wsegs" data-wkind="${kind}" data-wkey="${k}" role="group" aria-label="${labels[k]} weight">${Array.from({ length: STEP_COUNT }, (_, i) => `<button class="wseg ${i < filled ? "f" : ""}" data-wstep="${i + 1}" aria-label="${(i + 1) * (STEP_MAX / STEP_COUNT)}%"></button>`).join("")}</div><span class="mono num" style="text-align:right">${pct}%</span></div>`; }).join("");
}
function presetRow(kind, presets, weights) {
  const active = Object.keys(presets).find((n) => Object.keys(presets[n]).every((k) => Math.round((weights[k] || 0) * 100) === Math.round(presets[n][k] * 100)));
  return `<div class="tags" style="margin-bottom:var(--s4)">${Object.keys(presets).map((n) => `<button class="tag ${n === active ? "on" : ""}" data-wpreset="${kind}|${UI.esc(n)}">${UI.esc(n)}</button>`).join("")}</div>`;
}
function renderSettingsView() {
  const root = document.getElementById("settingsView");
  const withA = state.library.filter((t) => t.analysis), ok = withA.filter((t) => sonicIdOf(t) && !sonicStale(t)).length, stale = withA.filter(sonicStale).length, missing = withA.length - ok - stale;
  let url = ""; try { url = localStorage.getItem("ts_api_url") || ""; } catch (e) {}
  root.innerHTML = `<h1 class="h2" style="margin-bottom:var(--s5)">Settings</h1><div class="cols2">
    <div>
      <div class="panel" style="border-top:none"><h3>Advanced Analysis backend</h3><p>Optional server (FastAPI + Essentia, All-In-One, Discogs-EffNet). Without it NOESIS runs fully in the browser.</p>
        <input class="field" id="apiUrlInput" placeholder="http://localhost:8000" value="${UI.esc(url || "http://localhost:8000")}" style="margin-bottom:var(--s3)">
        <div style="display:flex;gap:var(--s2)"><button class="btn primary" id="apiSave">Save &amp; test</button><button class="btn" id="apiClear">Clear</button></div><div class="mono dim" id="apiStatus" style="margin-top:var(--s3)"></div></div>
      <div class="panel"><h3>Sonic embeddings</h3><p>Discogs-EffNet (Essentia Models, CC BY-NC-SA 4.0) runs on your backend; the audio is not sent anywhere else. Vectors stay on the backend, not in the browser.</p>
        <div class="mono dim" id="sonicStatus">${ok} of ${state.library.length} tracks have a current embedding · ${missing} missing · ${stale} outdated${state.backendInfo && state.backendInfo.sonic ? `<br>Backend model: ${UI.esc(state.backendInfo.sonic.model)} v${UI.esc(state.backendInfo.sonic.modelVersion)}` : `<br><span style="color:var(--coral)">backend offline</span>`}</div>
        <div style="display:flex;gap:var(--s2);margin-top:var(--s3)"><button class="btn" id="sonicCompute">Compute missing / outdated</button><button class="btn" id="sonicRecal" title="Recompute the % scale from your own library (needs 15+ tracks)">Recalibrate %</button></div></div>
      <div class="panel"><h3>Data</h3><p>The library and sets are stored in this browser (localStorage + IndexedDB for audio files).</p><button class="btn danger" id="clearAllData">Clear all data</button></div>
    </div>
    <div>
      <div class="panel" style="border-top:none"><h3>Similarity weights</h3><p>How much each feature group contributes to feature similarity. Sonic similarity adds the embedding on top (55% embedding, 45% from rhythm / timbre / energy / harmony).</p>${presetRow("sim", SIM_PRESETS, state.weights.sim)}${weightRows("sim", state.weights.sim, WEIGHT_LABELS_SIM)}<button class="linkbtn" id="resetSimWeights">Reset to default</button></div>
      <div class="panel"><h3>DJ compatibility weights</h3><p>What “plays well next to each other” means. Unknown factors (e.g. no structure data) are left out and the rest renormalised.</p>${presetRow("dj", DJ_PRESETS, state.weights.dj)}${weightRows("dj", state.weights.dj, WEIGHT_LABELS_DJ)}<button class="linkbtn" id="resetDjWeights">Reset to default</button></div>
      <div class="panel"><h3>Credits &amp; licences</h3><p>NOESIS — developed by punk pozer. Essentia.js (AGPL-3.0) and Essentia models (CC BY-NC-SA 4.0) from the Music Technology Group, UPF. All-In-One (MLX port) for structure. Typeface ABC Areal (commercial, licensed separately).</p></div>
    </div></div>`;
}
document.getElementById("settingsView").addEventListener("click", async (e) => {
  const seg = e.target.closest("[data-wstep]");
  if (seg) { const g = seg.parentElement, w = state.weights[g.dataset.wkind]; w[g.dataset.wkey] = (+seg.dataset.wstep * STEP_MAX) / STEP_COUNT / 100; persistWeights(); renderSettingsView(); return; }
  const pr = e.target.closest("[data-wpreset]");
  if (pr) { const [k, n] = pr.dataset.wpreset.split("|"); state.weights[k] = { ...(k === "sim" ? SIM_PRESETS : DJ_PRESETS)[n] }; persistWeights(); renderSettingsView(); toast("Preset: " + n); return; }
  if (e.target.closest("#resetSimWeights")) { state.weights.sim = { ...SIM_WEIGHTS }; persistWeights(); renderSettingsView(); return; }
  if (e.target.closest("#resetDjWeights")) { state.weights.dj = { ...DJ_WEIGHTS }; persistWeights(); renderSettingsView(); return; }
  if (e.target.closest("#apiSave")) {
    const v = document.getElementById("apiUrlInput").value.trim();
    try { v ? localStorage.setItem("ts_api_url", v) : localStorage.removeItem("ts_api_url"); } catch (er) {}
    const st = document.getElementById("apiStatus"); st.textContent = "checking…";
    const h = await refreshBackendPill();
    st.innerHTML = h.online ? `online · essentia ${UI.esc(h.info.essentia || "n/a (portable engine)")} · structure ${h.info.structure && h.info.structure.available ? "yes" : "no"} · sonic ${h.info.sonic && h.info.sonic.available ? "yes (" + UI.esc(h.info.sonic.runtime || "?") + ")" : "no"}` : `offline (${UI.esc(h.reason)})${h.reason === "unreachable" ? "<br>Start the backend: <span style='color:var(--text)'>npm run dev</span>" : ""}`;
    return;
  }
  if (e.target.closest("#apiClear")) { try { localStorage.removeItem("ts_api_url"); } catch (er) {} document.getElementById("apiUrlInput").value = ""; document.getElementById("apiStatus").textContent = ""; refreshBackendPill(); return; }
  if (e.target.closest("#sonicCompute")) {
    const todo = state.library.filter((t) => t.analysis && (!sonicIdOf(t) || sonicStale(t)));
    if (!todo.length) { toast("All embeddings are current"); return; }
    let n = 0, noAudio = 0; for (const t of todo) { if (!(await getAudioBlob(t.id))) { noAudio++; continue; } n++; runSonicOnly(t.id); }
    toast(`Queued: ${n}${noAudio ? " · no audio file: " + noAudio + " (use Attach audio)" : ""}`); return;
  }
  if (e.target.closest("#sonicRecal")) { const r = await BackendClient.sonicRecalibrate(state.library.map(sonicIdOf).filter(Boolean)); if (!r.ok) { toast("Recalibrate: " + r.reason); return; } invalidateSonic(); toast(`Scale recalibrated on ${r.result.tracks} tracks`); return; }
  if (e.target.closest("#clearAllData")) {
    if (!(await askConfirm("Delete the whole library and all sets? This cannot be undone.", "Delete all"))) return;
    stopPlayer(); AudioStore.clear(); sessionFiles.clear();
    state.library = []; state.sets = []; state.currentSet = { name: "Untitled set", trackIds: [] }; state.currentTrackId = null; state.queue = []; state.selected.clear();
    persistLibrary(); persistSets(); invalidateSonic(); renderFilterTags(); renderActiveView(); toast("All data cleared");
  }
});
