/* =================== Advanced Analysis (backend) =================== */
// Priority: MANUAL > BACKEND > LOCAL. Status: LOCAL_ANALYSIS -> ADVANCED_ANALYSIS -> COMPLETE | FAILED.
let advChain = Promise.resolve();
const advRunning = new Set();
function queueAdvanced(id, file) {
  if (!window.BackendClient || !BackendClient.apiUrl()) return;
  advChain = advChain.then(() => runAdvanced(id, file)).catch(e => console.warn("advanced analysis", e));
}
async function runAdvanced(id, file) {
  const t = findTrack(id);
  if (!t || !t.analysis || advRunning.has(id)) return;
  if (!file) {
    const blob = await getAudioBlob(id);
    if (!blob) { toast("Для этого трека нет аудиофайла — выберите файл"); attachAudioPicker(id); return; }
    file = new File([blob], t.filename || "track", { type: blob.type });
  }
  advRunning.add(id);
  t.analysis.status = "ADVANCED_ANALYSIS";
  refreshTrackViews(id);
  try {
    const h = await BackendClient.health();
    if (!h.online) { t.analysis.backend = { status: "OFFLINE", reason: h.reason }; t.analysis.status = "LOCAL_ANALYSIS"; return; }
    // Portable engines (e.g. Windows) have no whole-track Essentia analysis: skip it and keep going with structure / sonic.
    if (h.info && h.info.analysis && h.info.analysis.available === false) {
      t.analysis.backend = { status: "UNAVAILABLE", reason: "this engine runs without Essentia (portable mode) — BPM/key come from the in-browser analysis" };
    } else {
      const r = await BackendClient.analyze(file);
      if (!r.ok) { t.analysis.backend = { status: "ERROR", reason: r.reason }; t.analysis.status = "FAILED"; return; }
      applyBackendResult(t, r.result);
    }
    await runStructureStage(t, file, h);
    await runSonicStage(t, file, h);
    t.analysis.status = "COMPLETE";
  } finally {
    advRunning.delete(id);
    persistLibrary();
    refreshTrackViews(id);
  }
}

async function runStructureStage(t, file, health) {
  const an = t.analysis;
  if (!(health.info && health.info.structure && health.info.structure.available)) {
    an.structure = { status: "UNAVAILABLE", reason: "structure analyzer not installed on the backend" }; return;
  }
  an.status = "STRUCTURE_ANALYSIS"; refreshTrackViews(t.id);
  const r = await BackendClient.structure(file);
  if (!r.ok) { an.structure = { status: r.unavailable ? "UNAVAILABLE" : "ERROR", reason: r.reason }; return; }
  applyStructure(t, r.result);
}

// Discogs-EffNet sonic embedding (backend, CPU). Only compact metadata is stored here; the vectors live on the backend.
async function runSonicStage(t, file, health) {
  const an = t.analysis;
  if (!(health.info && health.info.sonic && health.info.sonic.available)) {
    an.sonic = { status: "UNAVAILABLE", reason: "sonic embedding runtime not installed on the backend" }; return;
  }
  an.status = "SONIC_EMBEDDING"; refreshTrackViews(t.id);
  const r = await BackendClient.embed(file);
  if (!r.ok) { an.sonic = { status: r.unavailable ? "UNAVAILABLE" : "ERROR", reason: r.reason }; return; }
  const e = r.result;
  an.sonic = { status: "AVAILABLE", audioId: e.id, model: e.model, modelVersion: e.modelVersion, dims: e.dims, pooling: e.pooling,
               frameCount: e.frameCount, createdAt: e.createdAt, license: e.license, topStyles: (e.topStyles || []).slice(0, 8), parents: (e.parents || []).slice(0, 3) };
  applyGenreFromSonic(t);
  an.version = Math.max(an.version || 2, 5);
  invalidateSonic();
}
/* Genre from Discogs-EffNet style activations (a model trained for music-style classification) replaces the rule-based
   baseline, unless the user set the genre by hand. The old guess is kept in analysis.genreLegacy. */
function styleName(label) { return label.split("---").pop(); }
function applyGenreFromSonic(t) {
  const s = t.analysis && t.analysis.sonic, mo = t.manualOverrides || {};
  if (!s || s.status !== "AVAILABLE" || !s.topStyles || !s.topStyles.length || mo.genre) return;
  const ranked = window.GenreRank ? GenreRank.rerank(s.topStyles) : s.topStyles.map((x, i) => ({ ...x, rank: i }));
  const [a, ...rest] = ranked;
  if (t.genre && t.genre.method !== "discogs-effnet") t.analysis.genreLegacy = { primary: t.genre.primary, confidence: t.genre.confidence, method: t.genre.method };
  t.genre = { primary: styleName(a.label), parent: a.label.split("---")[0], confidence: Math.round(a.score * 100), method: "discogs-effnet",
              tempoAdjusted: a.rank !== 0, secondary: rest.slice(0, 4).map((x) => [styleName(x.label), Math.round(x.score * 100)]) };
}
async function runSonicOnly(id) {
  const t = findTrack(id); if (!t || !t.analysis) return;
  const blob = await getAudioBlob(id); if (!blob) return;
  const file = new File([blob], t.filename || "track", { type: blob.type });
  const h = await BackendClient.health(); if (!h.online) return;
  advChain = advChain.then(async () => {
    t.analysis.status = "SONIC_EMBEDDING"; refreshTrackViews(id);
    try { await runSonicStage(t, file, h); } finally { t.analysis.status = "COMPLETE"; persistLibrary(); refreshTrackViews(id); }
  }).catch(e => console.warn("sonic", e));
  return advChain;
}
function applyStructure(t, res) {
  const an = t.analysis, d = res.dj, mo = t.manualOverrides || {};
  an.structure = {
    status: "AVAILABLE", analyzer: res.analyzer.name + " " + res.analyzer.version, structureVersion: res.structureVersion,
    segments: d.segments.map(s => ({ start: s.start, end: s.end, label: s.label, energyDb: s.energyDb })),
    downbeatCount: d.downbeatCount, firstDownbeat: d.firstDownbeat, barSeconds: d.barSeconds, bpm: d.bpm,
    introDuration: d.introDuration, outroDuration: d.outroDuration, introBars: d.introBars, outroBars: d.outroBars,
    sectionBoundaries: d.sectionBoundaries, majorTransitions: d.majorTransitions, breakdownPositions: d.breakdownPositions,
    energySectionChanges: d.energySectionChanges.filter(c => c.major), embeddingRef: res.embeddingDims ? { id: res.id, dims: res.embeddingDims, store: "backend" } : null,
  };
  an.version = Math.max(an.version || 2, 4);
  // All-In-One's tempo is one more independent vote for the BPM consensus (manual still wins)
  if (!mo.bpm && d.bpm && an.backend && an.backend.status === "AVAILABLE") {
    const cands = { ...(an.bpm.candidates || {}), allin1: d.bpm };
    const f = AnalysisFusion.fuseBpmBackend({ value: an.backend.bpm.value, reliability: an.backend.bpm.reliability, modelConfidence: an.backend.bpm.modelConfidence }, cands);
    t.bpm = f.value; t.profile.bpm = f.value;
    an.bpm = { ...an.bpm, value: f.value, reliability: f.reliability, candidates: cands, disagreeing: f.disagreeing };
    an.sources = Array.from(new Set(f.sources));
  }
  if (t.structure) { if (d.introDuration != null) t.structure.introSec = d.introDuration; if (d.outroDuration != null) t.structure.outroSec = d.outroDuration; }
}
function applyBackendResult(t, res) {
  if (!window.AnalysisFusion) throw new Error("analysis-fusion.js not loaded");
  const mo = t.manualOverrides || {};
  const an = t.analysis;
  const b = res.bpm || {}, k = res.key || {};
  // compact aggregates only (no beat arrays / frames / energy curve)
  an.backend = {
    status: "AVAILABLE", engine: "essentia " + res.engine.version, analysisVersion: res.analysisVersion,
    analyzedSeconds: res.analyzedSeconds, elapsedSeconds: res.elapsedSeconds,
    bpm: { value: b.value, reliability: b.reliability, estimators: b.estimators, alternatives: b.alternatives,
           modelConfidence: b.modelConfidence ?? null, gridResidualMs: b.gridResidualMs ?? null, beatCount: b.beatCount, firstBeatSec: b.firstBeatSec, beatIntervalCv: b.beatIntervalCv ?? null },
    key: { value: k.value, key: k.key, scale: k.scale, reliability: k.reliability, modelStrength: k.modelStrength, runnerUp: k.runnerUp,
           profiles: (k.profiles || []).map(p => p.profile + ":" + p.camelot) },
    rhythm: res.rhythm, timbre: res.timbre,
    energy: { loudnessLufs: res.energy.loudnessLufs, loudnessRangeLu: res.energy.loudnessRangeLu, dynamicComplexity: res.energy.dynamicComplexity },
  };
  an.version = Math.max(an.version || 2, 3);
  an.advanced = { status: "AVAILABLE", engine: "essentia (backend) " + res.engine.version, scope: "backend" };
  an.status = "COMPLETE";

  // BPM (manual wins)
  if (!mo.bpm && b.value) {
    const cands = { ...(an.bpm.candidates || {}), backend: b.value };
    const f = AnalysisFusion.fuseBpmBackend({ value: b.value, reliability: b.reliability, modelConfidence: b.modelConfidence }, cands);
    t.bpm = f.value; t.profile.bpm = f.value;
    an.bpm = { value: f.value, reliability: f.reliability, candidates: cands, modelConfidence: b.modelConfidence ?? null, backendReliability: b.reliability, disagreeing: f.disagreeing };
    an.sources = Array.from(new Set(f.sources)); // only the sources that agree with the final value
    if (t.genre && t.genre.method === "discogs-effnet") { /* style genre does not depend on tempo */ }
    else if (an.genreInputs && !mo.genre) {
      const gi = an.genreInputs;
      t.genre = classifyGenre(t.bpm, t.profile.rhythmicComplexity, gi.percussiveRatio, gi.bassEnergyNorm, gi.brightness, gi.vocalPresence);
    }
  }
  // Key (manual wins)
  if (!mo.key && k.value && k.key) {
    const fk = AnalysisFusion.fuseKeyBackend({ value: k.value, reliability: k.reliability }, an.key && an.key.value);
    const tonic = AnalysisFusion.toCamelot(k.key, k.scale).tonic;
    t.key = { tonic, mode: /^maj/i.test(k.scale) ? "maj" : "min", camelot: k.value, confidence: fk.reliability };
    an.key = { value: k.value, reliability: fk.reliability, agreement: fk.agreement, modelStrength: k.modelStrength, legacyCamelot: an.key ? an.key.legacyCamelot : null, source: "essentia-backend", backendReliability: k.reliability };
    an.sources = Array.from(new Set([...(an.sources || []), "essentia-backend"]));
  }
}

/* ---- Sonic similarity: calibrated embedding scores come from the backend (vectors never leave it) ---- */
const sonicCache = { sig: "", idx: new Map(), raw: null, ui: null, loading: null, failed: false };
function sonicIdOf(t) { return t.analysis && t.analysis.sonic && t.analysis.sonic.status === "AVAILABLE" ? t.analysis.sonic.audioId : null; }
function invalidateSonic() { sonicCache.sig = ""; }
async function ensureSonic() {
  const ids = Array.from(new Set(state.library.map(sonicIdOf).filter(Boolean))).sort();
  const sig = ids.join(",");
  if (!ids.length || sig === sonicCache.sig) return sonicCache.sig === sig;
  if (sonicCache.loading) return sonicCache.loading;
  sonicCache.loading = (async () => {
    const r = await BackendClient.sonicPairwise(ids.slice(0, 300));
    sonicCache.loading = null;
    if (!r.ok) { sonicCache.failed = true; return false; }
    sonicCache.failed = false;
    sonicCache.idx = new Map(r.result.ids.map((id, i) => [id, i]));
    sonicCache.raw = r.result.raw; sonicCache.ui = r.result.ui; sonicCache.sig = sig;
    return true;
  })();
  return sonicCache.loading;
}
// calibrated embedding score for a pair, or null when either track has no (current) embedding
function sonicPair(a, b) {
  const ia = sonicIdOf(a), ib = sonicIdOf(b);
  if (!ia || !ib || !sonicCache.ui) return null;
  const x = sonicCache.idx.get(ia), y = sonicCache.idx.get(ib);
  if (x == null || y == null) return null;
  return { raw: sonicCache.raw[x][y], ui: sonicCache.ui[x][y] };
}
function sonicScore(a, b) {
  const p = sonicPair(a, b); if (!p) return null;
  const g = computeSimilarity(trackToEngineShape(a), trackToEngineShape(b), state.weights.sim, KEY_WEIGHTS);
  const c = SonicSimilarity.combine(p.ui, { rhythm: g.rhythm, texture: g.timbre, energy: g.energy, harmony: g.harmony });
  return c ? { ...c, rawCosine: p.raw, embeddingUi: p.ui } : null;
}
function sonicStale(t) {
  const s = t.analysis && t.analysis.sonic;
  const cur = state.backendInfo && state.backendInfo.sonic;
  return !!(s && s.status === "AVAILABLE" && cur && (s.model !== cur.model || s.modelVersion !== cur.modelVersion));
}

let _refreshQueued = false;
function refreshTrackViews(id) {
  // re-render the active view once per frame; never while the user is typing in a field of the track page
  if (_refreshQueued) return; _refreshQueued = true;
  requestAnimationFrame(() => {
    _refreshQueued = false;
    const ae = document.activeElement;
    if (ae && /^(input|textarea|select)$/i.test(ae.tagName) && ae.closest("#workspace")) return;
    const ws = document.getElementById("workspace"), top = ws.scrollTop;
    renderActiveView(); ws.scrollTop = top;
  });
}

async function refreshBackendPill() {
  const dot = document.getElementById("backendDot"), txt = document.getElementById("backendText");
  if (!BackendClient.apiUrl()) { txt.textContent = "Local only"; dot.className = "dot"; state.backendInfo = null; return { online: false, reason: "backend URL not configured" }; }
  const h = await BackendClient.health();
  state.backendInfo = h.online ? h.info : null;
  txt.textContent = h.online ? "Backend online" : "Backend offline";
  dot.className = "dot " + (h.online ? "on" : "off");
  if (state.tab === "settings" && !(document.activeElement && document.activeElement.matches("input"))) renderSettingsView();
  return h;
}
document.getElementById("backendPill").addEventListener("click", () => setActiveTab("settings"));

/* ---- audio files: IndexedDB (persistent) + in-memory map (works even when IndexedDB is blocked) ---- */
const sessionFiles = new Map();
async function keepAudio(id, file) {
  sessionFiles.set(id, file);
  const ok = await AudioStore.put(id, file);
  const tr = findTrack(id); if (tr && tr.hasAudio !== !!ok) { tr.hasAudio = !!ok; persistLibrary(); }
  if (!ok && !keepAudio.warned) { keepAudio.warned = true; toast("Браузер не сохраняет аудио (IndexedDB) — плеер работает до перезагрузки страницы"); }
}
async function getAudioBlob(id) { return sessionFiles.get(id) || (await AudioStore.get(id)); }

// Give an existing track its audio + waveform (+ backend analysis). Used when a track was analysed
// before audio storage existed, or analysed in another browser profile.
async function upgradeTrackAudio(t, file) {
  keepAudio(t.id, file);
  if (!t.waveform) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const ab = await ctx.decodeAudioData(await file.arrayBuffer());
      const mono = new Float32Array(ab.length);
      for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < ab.length; i++) mono[i] += d[i] / ab.numberOfChannels; }
      t.waveform = Waveform.encode(Waveform.compute(mono, ab.sampleRate));
    } finally { ctx.close(); }
    persistLibrary();
  }
  if (t.analysis && !(t.analysis.backend && t.analysis.backend.status === "AVAILABLE")) queueAdvanced(t.id, file);
  refreshTrackViews(t.id);
}
function attachAudioPicker(id) {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "audio/*,.mp3,.wav,.aif,.aiff,.flac,.m4a";
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const t = findTrack(id); if (!t) return;
    try { await upgradeTrackAudio(t, f); toast("Аудио привязано: " + t.title); playTrack(id); }
    catch (e) { toast("Не удалось прочитать файл: " + (e.message || e)); }
  };
  inp.click();
}

