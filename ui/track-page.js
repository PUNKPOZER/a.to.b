/* =================== Analyze view: track page + context panel =================== */
const TRACK_TABS = [["overview", "Overview"], ["structure", "Structure"], ["spectral", "Spectral"], ["rhythm", "Rhythm"], ["harmonic", "Harmonic"], ["similar", "Similar"], ["dj", "DJ compatibility"], ["notes", "Notes"]];
const NA = UI.NA;

function trackMetaLine(t) {
  const sr = t.sampleRate ? (t.sampleRate / 1000).toFixed(t.sampleRate % 1000 ? 1 : 0) + " kHz" : null;
  return [fmtTime(t.durationSec), sr, t.format].filter(Boolean).join(" · ");
}

/* ---- similar tracks: SONIC SIMILARITY when both tracks have an embedding, else feature similarity; DJ shown separately ---- */
function similarRows(track, { useFilters = true } = {}) {
  let cands = state.library.filter((t) => t.id !== track.id && (!useFilters || passFilters(t)));
  const A = trackToEngineShape(track);
  let rows = cands.map((o) => {
    const B = trackToEngineShape(o);
    const sim = computeSimilarity(A, B, state.weights.sim, KEY_WEIGHTS);
    const sonic = sonicScore(track, o);
    const dj = computeDjCompatibility(A, B, state.weights.dj, KEY_WEIGHTS);
    return { track: o, sim, sonic, dj, primary: sonic ? sonic.overall : sim.overall };
  });
  if (useFilters && state.filters.minSim != null) rows = rows.filter((r) => r.primary >= state.filters.minSim);
  rows.sort((a, b) => (!!b.sonic - !!a.sonic) || b.primary - a.primary);
  const th = SonicSimilarity.percentileThresholds(rows.filter((r) => r.sonic).map((r) => r.sonic.parts));
  rows.forEach((r) => (r.reasons = r.sonic ? SonicSimilarity.reasons(r.sonic.parts, th) : []));
  return rows;
}
function similarRowHtml(r) {
  const why = r.reasons.length ? `<div class="t3" style="white-space:normal">${r.reasons.map((x) => x.label.replace("Similar ", "").toLowerCase()).join(" · ")}</div>` : "";
  const scoreHtml = `<div class="big ${UI.tone(r.primary)} num">${Math.round(r.primary)}%</div>`;
  const sub = `${r.sonic ? "SONIC" : "SIMILARITY"} · DJ ${Math.round(r.dj.overall)}%`;
  return UI.trackRow(r.track, { scoreHtml, sub, reasons: why });
}
function ensureSonicThen(track, rerender) { // load the calibrated embedding matrix, then re-render once if it changed
  if (!sonicCache.failed && state.library.some(sonicIdOf)) { const before = sonicCache.sig; ensureSonic().then(() => { if (sonicCache.sig !== before) rerender(); }); }
}

/* ---- the Analyze workspace ---- */
function renderAnalyzeView() {
  const t = findTrack(state.currentTrackId);
  const hero = document.getElementById("hero"), dz = document.getElementById("dropzone");
  hero.classList.toggle("compact", !!t);
  hero.querySelector(".heroText").classList.toggle("hidden", !!t);
  hero.style.gridTemplateColumns = t ? "1fr" : "";
  dz.classList.toggle("compact", !!t);
  dz.querySelector(".dz-text .label").textContent = t ? "Drop more tracks or a folder" : "or drag & drop here";
  document.getElementById("dzIcon").innerHTML = UI.icon("folder");
  const page = document.getElementById("trackPage");
  if (!t) { state.currentTrackId = null; page.classList.add("hidden"); page.innerHTML = ""; return; }
  page.classList.remove("hidden");
  page.innerHTML = trackHeaderHtml(t) + `<nav class="tabs" role="tablist">${TRACK_TABS.map(([k, l]) => `<button role="tab" aria-selected="${state.trackTab === k}" class="${state.trackTab === k ? "active" : ""}" data-ttab="${k}">${l}</button>`).join("")}</nav><div class="tabpane" id="tabPane">${trackTabHtml(t, state.trackTab)}</div>`;
  afterTrackPage(t);
}
function trackHeaderHtml(t) {
  const playing = player.id === t.id && !player.audio.paused;
  return `<div class="thead">${UI.art(t)}<div style="min-width:0">
    <div class="artist">${UI.esc(t.artist)}</div><div class="title">${UI.esc(t.title)}</div>
    <div class="meta"><span class="mono">${UI.esc(trackMetaLine(t))}</span>${t.truncated ? `<span class="mono faint">analysed first ${Math.round(t.analyzedSeconds)} s locally</span>` : ""}</div>
    <div style="margin-top:10px">${UI.statusDots(t)}</div></div>
    <div class="actions"><button class="playbtn" data-trackplay="${t.id}" aria-label="${playing ? "Pause" : "Play"}">${UI.icon(playing ? "pause" : "play")}</button>
    <button class="iconbtn" id="trackMore" aria-label="More actions">${UI.icon("more")}</button></div></div>`;
}
function afterTrackPage(t) {
  const wc = document.getElementById("tabWave"); if (wc) bindWave(wc, t.id);
  const ta = document.getElementById("noteArea");
  if (ta) { let tm; ta.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => saveNote(t.id, ta.value), 400); }); }
  if (state.trackTab === "similar") fillSimilarTab(t);
  updateTransportUI();
}

function trackTabHtml(t, tab) {
  return ({ overview: tabOverview, structure: tabStructure, spectral: tabSpectral, rhythm: tabRhythm, harmonic: tabHarmonic, similar: tabSimilar, dj: tabDj, notes: tabNotes })[tab](t);
}

/* --- OVERVIEW --- */
function waveBlock(t) {
  const st = structureOf(t);
  const legend = st ? `<span class="label">Structure · ${UI.esc(st.analyzer)}</span>` : `<span class="label faint">${t.analysis && t.analysis.structure && t.analysis.structure.status === "UNAVAILABLE" ? "Structure unavailable — backend not installed" : "Structure not analysed"}</span>`;
  return `<div class="wave-tools"><div>${legend}</div>
      <div class="seg" style="width:150px" role="group" aria-label="Waveform style"><button data-wstyle="mono" class="${state.waveStyle === "mono" ? "on" : ""}">Mono</button><button data-wstyle="spectral" class="${state.waveStyle === "spectral" ? "on" : ""}">Spectral</button></div></div>
    <div class="wavebox">${t.waveform ? `<canvas class="wave" id="tabWave" data-kind="main" aria-label="Waveform. Click to seek."></canvas>` : `<div class="empty" style="padding:var(--s5) 0">No waveform for this track yet — attach its audio file.</div>`}</div>
    ${st ? `<div class="legend" style="margin-bottom:var(--s3)">${st.segments.map((s) => `<button class="chip" onclick="seekTo('${t.id}', ${s.start})" title="${fmtTime(s.start)}–${fmtTime(s.end)}"><i style="background:${Waveform.SECTION_COLORS[s.label] || "#888"}"></i>${UI.esc(s.label)} ${fmtTime(s.start)}</button>`).join("")}</div>` : ""}`;
}
function primaryMetrics(t) {
  const an = t.analysis || {}, bk = an.backend && an.backend.status === "AVAILABLE" ? an.backend : null, mo = t.manualOverrides || {};
  const man = (k) => (mo[k] ? ` <span class="chip" style="vertical-align:middle">manual</span>` : "");
  const rel = an.bpm ? `${Math.round(an.bpm.reliability)}% reliable` : "";
  const keyName = t.key.tonic ? `${t.key.tonic} ${t.key.mode === "maj" ? "major" : "minor"}` : "";
  const lufs = bk && bk.energy.loudnessLufs != null ? `${bk.energy.loudnessLufs.toFixed(1)}<small>LUFS</small>` : NA;
  return `<div class="metrics">
    ${UI.metric("BPM", t.bpm != null ? t.bpm.toFixed(1) : NA, rel + man("bpm"), `<div class="tag-edit"><button class="linkbtn" onclick="editBpmPrompt('${t.id}')">Edit</button></div>`)}
    ${UI.metric("Key", `<span class="keyline">${UI.camelotRing(t.key.camelot, 46)}<span>${UI.esc(t.key.camelot === "unknown" ? NA : t.key.camelot)}</span></span>`, UI.esc(keyName) + man("key"), `<div class="tag-edit"><button class="linkbtn" onclick="editCamelotPrompt('${t.id}')">Edit</button></div>`)}
    ${UI.metric("Genre", `<span style="font-size:22px;letter-spacing:-.01em">${UI.esc(t.genre.primary)}</span>`, `${Math.round(t.genre.confidence)}% rule-based match`)}
    ${UI.metric("Energy", Math.round(t.profile.energy) + "<small>%</small>", "relative loudness")}
    ${UI.metric("Danceability", Math.round(t.profile.danceability) + "<small>%</small>", bk && bk.rhythm.danceability != null ? "Essentia " + bk.rhythm.danceability : "estimated")}
    ${UI.metric("Loudness", lufs, bk ? "EBU R128" : "needs backend")}
  </div>`;
}
function featureGrid(t) {
  const p = t.profile, an = t.analysis || {}, bk = an.backend && an.backend.status === "AVAILABLE" ? an.backend : null;
  const pctBar = (v) => UI.bar(v, "var(--text-2)");
  const items = [
    ["Energy over time", t.structure ? `${Math.round(Math.min(...t.structure.energyCurve) * 100)}–${Math.round(Math.max(...t.structure.energyCurve) * 100)}` : NA, UI.sparkline(t.structure && t.structure.energyCurve, "#e8b64a")],
    ["Spectral centroid", bk ? bk.timbre.spectralCentroidHz + " Hz" : Math.round(p.brightness) + "% bright", pctBar(p.brightness)],
    ["Rhythm density", bk && bk.rhythm.onsetRate != null ? bk.rhythm.onsetRate + " onsets/s" : Math.round(p.rhythmicComplexity) + "%", pctBar(p.rhythmicComplexity)],
    ["Key clarity", an.key ? Math.round(an.key.reliability) + "%" : NA, pctBar(an.key ? an.key.reliability : 0)],
    ["Drum presence", Math.round(p.drumDensity) + "%", pctBar(p.drumDensity)],
    ["Bass presence", Math.round(p.bassDensity) + "%", pctBar(p.bassDensity)],
    ["Harmonic content", Math.round(p.harmonicComplexity) + "%", pctBar(p.harmonicComplexity)],
    ["Dynamic range", Math.round(p.dynamicRange) + "%", pctBar(p.dynamicRange)],
  ];
  return `<div class="featgrid">${items.map(([l, v, g]) => UI.feature(l, v, g)).join("")}</div>`;
}
function tabOverview(t) { return waveBlock(t) + primaryMetrics(t) + UI.sectionHead("Analysis features", t.truncated ? "local features: first " + Math.round(t.analyzedSeconds) + " s" : "") + featureGrid(t); }

/* --- STRUCTURE --- */
function tabStructure(t) {
  const st = structureOf(t), an = t.analysis || {};
  if (!st) return `${waveBlock(t)}<div class="empty" style="padding-left:0">${UI.esc(an.structure && an.structure.reason ? "Structure analysis: " + an.structure.reason : "Structure is analysed by the backend (All-In-One). Run advanced analysis to get sections, downbeats and intro/outro.")}</div>${an.structure === undefined ? `<button class="btn" onclick="runAdvanced('${t.id}')">Run analysis</button>` : ""}`;
  const n = (v, u = "") => (v == null ? NA : v + u);
  return `${waveBlock(t)}
    ${UI.sectionHead("DJ structure", UI.esc(st.analyzer))}
    <dl class="kv"><dt>First downbeat</dt><dd class="num">${n(st.firstDownbeat, " s")}</dd><dt>Bar length</dt><dd class="num">${n(st.barSeconds, " s")} · ${st.downbeatCount} bars</dd>
      <dt>Intro</dt><dd>${n(st.introDuration, " s")} (${n(st.introBars)} bars) <span class="faint">only when the model labelled it</span></dd>
      <dt>Outro</dt><dd>${n(st.outroDuration, " s")} (${n(st.outroBars)} bars)</dd>
      <dt>Major transitions</dt><dd>${st.majorTransitions.length ? st.majorTransitions.map(fmtTime).join(" · ") : "none"} <span class="faint">≥ 3 dB loudness change</span></dd>
      <dt>Breakdowns</dt><dd>${st.breakdownPositions.length ? st.breakdownPositions.map(fmtTime).join(" · ") : "none"}</dd></dl>
    ${UI.sectionHead("Sections", st.segments.length + " · labels come from the model and can be wrong")}
    <table class="t"><thead><tr><th>Start</th><th>End</th><th>Label</th><th>Length</th><th>Loudness</th></tr></thead><tbody>
    ${st.segments.map((s) => `<tr class="row" onclick="seekTo('${t.id}', ${s.start})"><td class="num mono">${fmtTime(s.start)}</td><td class="num mono">${fmtTime(s.end)}</td><td><span class="chip"><i style="background:${Waveform.SECTION_COLORS[s.label] || "#888"}"></i>${UI.esc(s.label)}</span></td><td class="num mono">${(s.end - s.start).toFixed(1)} s</td><td class="num mono">${s.energyDb != null ? s.energyDb.toFixed(1) + " dB" : NA}</td></tr>`).join("")}</tbody></table>`;
}

/* --- SPECTRAL --- */
function tabSpectral(t) {
  const p = t.profile, bk = t.analysis && t.analysis.backend && t.analysis.backend.status === "AVAILABLE" ? t.analysis.backend : null;
  const bars = (arr) => `<div style="display:flex;gap:3px;align-items:flex-end;height:46px">${arr.map((v) => { const mx = Math.max(...arr.map(Math.abs), 1e-9); return `<i style="flex:1;background:var(--text-2);height:${Math.max(2, Math.abs(v) / mx * 100)}%;opacity:${v >= 0 ? 1 : 0.45}"></i>`; }).join("")}</div>`;
  const rows = [["Brightness", p.brightness], ["Darkness", p.darkness], ["Texture", p.texture], ["Bass density", p.bassDensity], ["Drum density", p.drumDensity], ["Acousticness", p.acousticness], ["Electronicness", p.electronicness]];
  return `${UI.sectionHead("Spectral profile", "local DSP")}<div class="featgrid">${rows.map(([l, v]) => UI.feature(l, Math.round(v) + "%", UI.bar(v, "var(--text-2)"))).join("")}</div>
    ${UI.sectionHead("Essentia (backend)", bk ? UI.esc(bk.engine) : "not available")}
    ${bk ? `<dl class="kv"><dt>Spectral centroid</dt><dd class="num">${bk.timbre.spectralCentroidHz} Hz</dd><dt>Spectral rolloff</dt><dd class="num">${bk.timbre.spectralRolloffHz} Hz</dd><dt>Spectral flux</dt><dd class="num">${bk.timbre.spectralFluxMean ?? NA}</dd><dt>Dynamic complexity</dt><dd class="num">${bk.energy.dynamicComplexity}</dd><dt>Loudness range</dt><dd class="num">${bk.energy.loudnessRangeLu} LU</dd></dl>
      <div class="featgrid" style="margin-top:var(--s5)">${UI.feature("MFCC (mean, 13)", "", bars(bk.timbre.mfccMean.slice(1)))}${UI.feature("Spectral contrast (mean)", "", bars(bk.timbre.spectralContrastMean))}</div>` : `<div class="empty" style="padding-left:0">Backend analysis adds centroid, rolloff, flux, MFCC and spectral contrast.</div>`}`;
}

/* --- RHYTHM --- */
function tabRhythm(t) {
  const an = t.analysis || {}, c = (an.bpm && an.bpm.candidates) || {}, bk = an.backend && an.backend.status === "AVAILABLE" ? an.backend : null;
  const cand = [["Backend (Essentia, whole track)", c.backend], ["Essentia.js (browser)", c.essentia], ["All-In-One", c.allin1], ["Legacy autocorrelation", c.autocorrelation], ["Legacy peak interval", c.peakInterval]].filter(([, v]) => v != null);
  const rel = an.bpm ? an.bpm.reliability : null;
  const agree = (v) => { const r = DjEngine.bpmRelation(t.bpm, v); return r.distPct <= 6 ? `<span class="hi">agrees</span>${r.octave ? " (half/double)" : ""}` : `<span class="lo">differs ${r.distPct.toFixed(0)}%</span>`; };
  return `${UI.sectionHead("Tempo consensus", rel != null ? Math.round(rel) + "% reliability — agreement between independent methods" : "")}
    <table class="t"><thead><tr><th>Source</th><th>BPM</th><th>Vs. result</th></tr></thead><tbody>${cand.length ? cand.map(([n, v]) => `<tr><td>${n}</td><td class="num mono">${v}</td><td>${agree(v)}</td></tr>`).join("") : `<tr><td colspan="3" class="faint">${NA}</td></tr>`}</tbody></table>
    <dl class="kv" style="margin-top:var(--s5)"><dt>Result</dt><dd class="num">${t.bpm.toFixed(1)} BPM ${t.manualOverrides && t.manualOverrides.bpm ? '<span class="chip">manual</span>' : ""}</dd>
      ${an.bpm && an.bpm.modelConfidence != null ? `<dt>Essentia model confidence</dt><dd class="num">${an.bpm.modelConfidence.toFixed(2)} <span class="faint">scale 0–5.3, separate from reliability</span></dd>` : ""}
      ${bk && bk.bpm.alternatives ? `<dt>Half / double alternatives</dt><dd class="num">${bk.bpm.alternatives.join(" · ")}</dd>` : ""}
      ${bk ? `<dt>Beats detected</dt><dd class="num">${bk.bpm.beatCount}</dd><dt>Beat regularity (CV)</dt><dd class="num">${bk.bpm.beatIntervalCv ?? NA}</dd><dt>First beat</dt><dd class="num">${bk.bpm.firstBeatSec ?? NA} s</dd><dt>Onset rate</dt><dd class="num">${bk.rhythm.onsetRate ?? NA} /s</dd><dt>Danceability (Essentia)</dt><dd class="num">${bk.rhythm.danceability ?? NA}</dd>` : ""}
      <dt>Rhythmic complexity</dt><dd class="num">${Math.round(t.profile.rhythmicComplexity)}%</dd><dt>Tempo stability</dt><dd class="num">${Math.round(t.profile.tempoStability)}%</dd></dl>`;
}

/* --- HARMONIC --- */
function tabHarmonic(t) {
  const an = t.analysis || {}, k = an.key || {}, bk = an.backend && an.backend.status === "AVAILABLE" ? an.backend : null;
  const ek = an.essentia && an.essentia.keys ? an.essentia.keys : [];
  return `<div style="display:grid;grid-template-columns:auto 1fr;gap:var(--s7);align-items:center">${UI.camelotRing(t.key.camelot, 150)}
    <dl class="kv"><dt>Camelot</dt><dd style="font-size:28px;letter-spacing:-.02em">${UI.esc(t.key.camelot)}</dd><dt>Key</dt><dd>${t.key.tonic ? UI.esc(t.key.tonic) + (t.key.mode === "maj" ? " major" : " minor") : NA}</dd>
    <dt>Reliability</dt><dd class="num">${k.reliability != null ? Math.round(k.reliability) + "%" : NA} ${k.agreement ? `<span class="faint">· ${k.agreement}</span>` : ""}</dd>
    ${k.modelStrength != null ? `<dt>Model strength</dt><dd class="num">${(+k.modelStrength).toFixed(2)}</dd>` : ""}${k.legacyCamelot ? `<dt>Legacy detector</dt><dd>${UI.esc(k.legacyCamelot)}</dd>` : ""}</dl></div>
    ${bk && bk.key.profiles ? UI.sectionHead("Backend key profiles", "vote share " + bk.key.reliability + "%") + `<div class="legend">${bk.key.profiles.map((p) => `<span class="chip">${UI.esc(p.replace(":", " → "))}</span>`).join("")}</div>` : ""}
    ${ek.length ? UI.sectionHead("Essentia.js (browser)", "") + `<div class="legend">${ek.map((x) => `<span class="chip">${UI.esc(x.profile)} → ${UI.esc(x.key)} ${UI.esc(x.scale)} · ${(+x.strength).toFixed(2)}</span>`).join("")}</div>` : ""}
    ${UI.sectionHead("Harmonic features", "local DSP")}<div class="featgrid">${[["Harmonic complexity", t.profile.harmonicComplexity], ["Melodic density", t.profile.melodicDensity]].map(([l, v]) => UI.feature(l, Math.round(v) + "%", UI.bar(v, "var(--text-2)"))).join("")}</div>`;
}

/* --- SIMILAR --- */
function tabSimilar(t) { return `<div id="simProfile">${sonicProfileBlock(t)}</div>${UI.sectionHead("Similar in my library", "sonic similarity · DJ compatibility shown separately")}<div id="simTabList" class="tlist" style="margin:0 calc(var(--s5) * -1)"><div class="empty">…</div></div>`; }
function sonicProfileBlock(t) {
  const s = t.analysis && t.analysis.sonic, btn = `<button class="btn sm" onclick="runSonicOnly('${t.id}')">Compute embedding</button>`;
  if (!s) return UI.sectionHead("Sonic profile", "") + `<p class="dim">No sonic embedding yet. ${BackendClient.apiUrl() ? btn : "Connect a backend in Settings to compute it."}</p>`;
  if (s.status !== "AVAILABLE") return UI.sectionHead("Sonic profile", "") + `<p class="dim">Embedding ${UI.esc(s.status.toLowerCase())}: ${UI.esc(s.reason || "")} ${btn}</p>`;
  const stale = sonicStale(t);
  return UI.sectionHead("Sonic profile", `${UI.esc(s.model)} v${UI.esc(s.modelVersion)} · ${s.dims}-d · ${UI.esc(s.pooling)} pooling`) +
    (stale ? `<p class="dim" style="color:var(--amber)">Embedding comes from an outdated model. ${btn}</p>` : "") +
    `<div class="featgrid">${(s.topStyles || []).map((x) => UI.feature(x.label.replace("---", " / "), Math.round(x.score * 100) + "%", UI.bar(x.score * 100 * 3, "var(--text-2)"))).join("")}</div><p class="mono faint" style="margin-top:var(--s3)">Discogs style activations from the model (not a genre label). Model licence: ${UI.esc(s.license || "")}.</p>`;
}
async function fillSimilarTab(t) {
  const box = document.getElementById("simTabList"); if (!box) return;
  if (sonicIdOf(t)) await ensureSonic();
  const el = document.getElementById("simTabList"); if (!el || state.currentTrackId !== t.id) return;
  const rows = similarRows(t, { useFilters: false }).slice(0, 12);
  el.innerHTML = rows.length ? rows.map(similarRowHtml).join("") : `<div class="empty">Add more tracks to the library to compare.</div>`;
}

/* --- DJ COMPATIBILITY --- */
function tabDj(t) {
  const A = trackToEngineShape(t);
  const rows = state.library.filter((o) => o.id !== t.id).map((o) => ({ o, dj: computeDjCompatibility(A, trackToEngineShape(o), state.weights.dj, KEY_WEIGHTS), sonic: sonicScore(t, o) })).sort((a, b) => b.dj.overall - a.dj.overall).slice(0, 8);
  if (!rows.length) return `<div class="empty" style="padding-left:0">Add more tracks to see what mixes well with this one.</div>`;
  const bar = (l, v) => v == null ? `<div><div class="l"><span>${l}</span><span>${NA}</span></div>${UI.bar(0)}</div>` : `<div><div class="l"><span>${l}</span><span class="num">${Math.round(v)}</span></div>${UI.bar(v, `var(--${v >= 80 ? "green" : v >= 55 ? "amber" : "coral"})`)}</div>`;
  return `${UI.sectionHead("Mixes well with", "DJ compatibility from tempo, key, rhythm, groove, energy, structure, genre")}` + rows.map((r) => `<div style="padding:var(--s4) 0;border-top:1px solid var(--line)">
    <div style="display:flex;gap:var(--s4);align-items:center">${UI.art(r.o, "sm")}<div style="flex:1;min-width:0;cursor:pointer" data-open-track="${r.o.id}"><div class="dim" style="font-size:11px">${UI.esc(r.o.artist)}</div><div>${UI.esc(r.o.title)}</div></div>
      ${UI.score("dj", r.dj.overall)}${r.sonic ? UI.score("sonic", r.sonic.overall) : ""}<button class="btn sm" data-addset="${r.o.id}">+ Set</button></div>
    <div class="tbreak">${bar("Tempo", r.dj.tempo)}${bar("Camelot", r.dj.key)}${bar("Rhythm", r.dj.rhythm)}${bar("Structure", r.dj.structure)}${bar("Energy", r.dj.energy)}</div>
    <ul class="notes">${r.dj.notes.map((n) => `<li class="${n.level}">${UI.esc(n.text)}</li>`).join("")}</ul></div>`).join("");
}

/* --- NOTES --- */
function tabNotes(t) {
  const mo = t.manualOverrides || {};
  return `${UI.sectionHead("Notes", "saved in this browser")}<textarea id="noteArea" class="field" rows="8" placeholder="Cue points, mixing ideas, where to play it…" style="resize:vertical;width:100%">${UI.esc(t.notes || "")}</textarea>
    ${UI.sectionHead("Manual overrides", "always win over automatic analysis")}
    <dl class="kv"><dt>BPM</dt><dd>${mo.bpm ? mo.bpm.value + " <span class='faint'>set " + new Date(mo.bpm.setAt).toLocaleDateString() + "</span>" : "automatic"}</dd><dt>Key</dt><dd>${mo.key ? UI.esc(mo.key.value) + " <span class='faint'>set " + new Date(mo.key.setAt).toLocaleDateString() + "</span>" : "automatic"}</dd></dl>`;
}

/* ---- context panel (right) ---- */
function renderContext() {
  const el = document.getElementById("contextPanel"), t = findTrack(state.currentTrackId);
  if (state.tab === "setbuilder") { el.innerHTML = ctxSetBuilder(); wireSetBuilderContext(); return; }
  if (state.tab === "library") { el.innerHTML = ctxLibrary(); return; }
  if (state.tab !== "analyze") { el.innerHTML = ""; return; }
  if (!t) { el.innerHTML = `<div class="ctx-head"><span class="label">Similar tracks</span></div><div class="empty">Analyze a track to see what sounds like it in your library.</div>`; return; }
  const rows = similarRows(t).slice(0, 14);
  el.innerHTML = `<div class="ctx-head"><span class="label">Similar tracks</span><span class="mono dim">${rows.length}</span></div>
    <div class="tlist">${rows.length ? rows.map(similarRowHtml).join("") : `<div class="empty">${state.library.length < 2 ? "Add more tracks to compare." : "No tracks match the filters."}</div>`}</div>
    <div class="ctx-sec"><div class="ctx-head" style="padding-bottom:0"><span class="label">Add to</span></div>
      <div class="addto"><button class="btn sm" data-ctx-queue="${t.id}">Queue</button><button class="btn sm" data-ctx-newset="${t.id}">New set</button><button class="btn sm" data-ctx-existing="${t.id}">Existing set…</button></div></div>`;
  ensureSonicThen(t, renderContext);
}

/* ---- delegated events for the Analyze view and context ---- */
document.addEventListener("click", (e) => {
  const tt = e.target.closest("[data-ttab]");
  if (tt) { state.trackTab = tt.dataset.ttab; renderAnalyzeView(); return; }
  const ws = e.target.closest("[data-wstyle]");
  if (ws) { state.waveStyle = ws.dataset.wstyle; persistUi(); renderAnalyzeView(); return; }
  if (e.target.closest("#trackMore")) { trackMoreMenu(e.target.closest("#trackMore"), state.currentTrackId); return; }
  const q = e.target.closest("[data-ctx-queue]"); if (q) { enqueue(q.dataset.ctxQueue); return; }
  const ns = e.target.closest("[data-ctx-newset]"); if (ns) { addToNewSet([ns.dataset.ctxNewset]); return; }
  const ex = e.target.closest("[data-ctx-existing]"); if (ex) { addToMenu(ex, ex.dataset.ctxExisting); return; }
  const as = e.target.closest("[data-addset]"); if (as) { e.stopPropagation(); addToSet(as.dataset.addset); return; }
  const op = e.target.closest("[data-open-track]");
  if (op && !e.target.closest("button")) openTrack(op.dataset.openTrack);
});
document.getElementById("ctxToggle").innerHTML = UI.icon("panel");
document.getElementById("ctxToggle").addEventListener("click", () => document.getElementById("context").classList.toggle("drawer-mode"));
