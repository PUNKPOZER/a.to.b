/* =================== Analyze: import panel, track panel (8 tabs), similar tracks =================== */
const TRACK_TABS = ["overview", "structure", "spectral", "rhythm", "harmonic", "similar", "dj", "notes"];
const NA = UI.NA;
const SEC_COLORS = () => Waveform.SECTION_COLORS || {};
const secLabel = (l) => { const k = "section." + l; const v = t(k); return v === k ? l : v; };
const noteText = (n) => { const k = "note." + n.code; const v = n.code ? t(k, n.params) : k; return v === k ? n.text : v; };

function trackMetaLine(tr) {
  const sr = tr.sampleRate ? (tr.sampleRate / 1000).toFixed(tr.sampleRate % 1000 ? 1 : 0) + " kHz" : null;
  return [fmtTime(tr.durationSec), sr, tr.format].filter(Boolean).join(" · ");
}

/* ---- similar tracks: SONIC SIMILARITY when both tracks have an embedding, else feature similarity; DJ shown separately ---- */
function similarRows(track, { useFilters = true } = {}) {
  const cands = state.library.filter((x) => x.id !== track.id && (!useFilters || passFilters(x)));
  const A = trackToEngineShape(track);
  let rows = cands.map((o) => {
    const sim = computeSimilarity(A, trackToEngineShape(o), state.weights.sim, KEY_WEIGHTS);
    const sonic = sonicScore(track, o), tr = transitionOf(track, o);
    return { track: o, sim, sonic, dj: tr.compat, primary: sonic ? sonic.overall : sim.overall };
  });
  if (useFilters && state.filters.minSim != null) rows = rows.filter((r) => r.primary != null && r.primary >= state.filters.minSim);
  rows.sort((a, b) => (!!b.sonic - !!a.sonic) || (b.primary ?? -1) - (a.primary ?? -1));
  const th = SonicSimilarity.percentileThresholds(rows.filter((r) => r.sonic).map((r) => r.sonic.parts));
  rows.forEach((r) => (r.reasons = r.sonic ? SonicSimilarity.reasons(r.sonic.parts, th) : []));
  return rows;
}
const simBasisTip = (r) => {
  const parts = r.sonic ? r.sonic.parts : r.sim, keys = r.sonic ? ["embedding", "rhythm", "timbre", "energy", "harmony"] : ["tempo", "genre", "rhythm", "timbre", "harmony", "energy", "structure"];
  const lines = keys.filter((k) => parts[k] != null).map((k) => `${t("sim." + k)} ${Math.round(parts[k])}`);
  const cov = r.sonic ? null : r.sim.coverage;
  return [t(r.sonic ? "sim.basisSonic" : "sim.basisFeature"), lines.join(" · "), cov != null && cov < 0.85 ? t("sim.partial", { n: Math.round(cov * 100) }) : ""].filter(Boolean).join(" — ");
};
function mchips(tr) { return `<div class="mchips"><span>${tr.bpm.toFixed(0)} BPM</span><span style="background:${UI.keyColor(tr.key.camelot) || "transparent"};color:${UI.keyColor(tr.key.camelot) ? "#0a0a0a" : "inherit"};border-color:transparent;font-weight:700">${UI.esc(tr.key.camelot === "unknown" ? NA : tr.key.camelot)}</span><span>${UI.esc(tr.genre.primary)}</span><span>${Math.round(tr.profile.energy)} ${t("chip.energy")}</span></div>`; }
function similarRowHtml(r) {
  const tr = r.track, why = r.reasons.length ? `<div class="mchips why">${r.reasons.map((x) => `<span>${UI.esc(t("why.sim." + x.key))}</span>`).join("")}</div>` : "";
  const playing = player.id === tr.id && !player.audio.paused;
  return `<div class="sim-row" data-open-track="${tr.id}" tabindex="0" role="button" aria-label="${UI.esc(tr.title)}">
    <span class="artplay">${UI.art(tr, "xs")}<button class="ov ${playing ? "on" : ""}" data-simplay="${tr.id}" aria-label="${UI.esc(t("player.play"))}">${UI.icon("play")}</button></span>
    <div class="nm"><div class="t1">${UI.esc(tr.title)}</div><div class="t2">${UI.esc(dispArtist(tr))}</div>${mchips(tr)}${why}</div>
    <canvas class="wave mini" data-kind="mini" data-wid="${tr.id}"></canvas>
    <div class="score" data-tip="${UI.esc(simBasisTip(r))}"><b class="${UI.tone(r.primary)} num">${UI.pct(r.primary)}</b><div class="mono faint" style="font-size:9px;letter-spacing:.06em">${t(r.sonic ? "score.sonicShort" : "score.simShort")}</div><div class="mono dim" style="font-size:10px">${t("score.djShort")} ${UI.pct(r.dj.overall)}</div></div>
    <button class="iconbtn" data-addset="${tr.id}" aria-label="${UI.esc(t("add.currentSet"))}" data-tip="${UI.esc(t("add.currentSet"))}">${UI.icon("plus")}</button></div>`;
}
function ensureSonicThen(track, rerender) { // load the calibrated embedding matrix, then re-render once if it changed
  if (!sonicCache.failed && state.library.some(sonicIdOf)) { const before = sonicCache.sig; ensureSonic().then(() => { if (sonicCache.sig !== before) rerender(); }); }
}

/* ---- the Analyze workspace ---- */
function renderAnalyzeView(root) {
  let tr = findTrack(state.currentTrackId);
  if (!tr) state.currentTrackId = null;
  root.innerHTML = `<div class="analyze ${tr ? "has-track" : ""}"><div class="col col-left">${importPanel()}${similarPanel(tr)}</div><div class="col col-main">${tr ? trackPanel(tr) : emptyTrackPanel()}</div></div>`;
  if (tr) { const wc = document.getElementById("tabWave"); if (wc) bindWave(wc, tr.id);
    const ta = document.getElementById("noteArea"); if (ta) { let tm; ta.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => saveNote(tr.id, ta.value), 400); }); }
    if (state.trackTab === "similar") fillSimilarTab(tr);
    ensureSonicThen(tr, () => renderActiveView()); }
  root.querySelectorAll("canvas[data-wid]").forEach((c) => bindWave(c, c.dataset.wid));
}
function importPanel() {
  return `<section class="panel import" id="dropzone" tabindex="0" role="button" aria-label="${UI.esc(t("import.title"))}">${UI.swirl()}
    <svg class="wavemark" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M2 8v0M4.5 5v6M7 2.5v11M9.5 5.5v5M12 4v8M14 7v2"/></svg>
    <h1>${t("import.title")}</h1><p>${t("import.sub")}</p><div class="fmt">MP3 · WAV · AIFF · FLAC · M4A</div>
    <div class="acts"><button class="btn primary" data-pick-files>${UI.icon("plus")}${t("import.chooseFiles")}</button><button class="btn" data-pick-folder>${UI.icon("folder")}${t("import.chooseFolder")}</button></div></section>`;
}
function similarPanel(tr) {
  if (!tr) return `<section class="panel"><div class="sim-head"><h2>${t("similar.title")}${UI.help("similar")}</h2></div><div class="empty">${t("similar.noTrack")}</div></section>`;
  const rows = similarRows(tr).slice(0, 12);
  return `<section class="panel"><div class="sim-head"><h2>${t("similar.title")}${UI.help("similar")}</h2><span class="mono dim">${rows.length}</span></div>
    <div class="sim-list">${rows.length ? rows.map(similarRowHtml).join("") : `<div class="empty">${t(state.library.length < 2 ? "similar.addMore" : "similar.noMatch")}</div>`}</div></section>`;
}
function emptyTrackPanel() {
  const recent = state.library.slice().sort((a, b) => b.analyzedAt - a.analyzedAt).slice(0, 6);
  return `<section class="panel"><div class="empty"><b>${t("analyze.emptyTitle")}</b>${t("analyze.emptyText")}</div>
    ${recent.length ? `${UI.sectionHead(t("analyze.recent"), recent.length)}<div class="sim-list">${recent.map((x) => `<div class="sim-row" data-open-track="${x.id}" tabindex="0" role="button"><span class="artplay">${UI.art(x, "xs")}</span><div class="nm"><div class="t1">${UI.esc(x.title)}</div><div class="t2">${UI.esc(dispArtist(x))}</div></div><span></span><span class="mono dim">${x.bpm.toFixed(0)} · ${UI.esc(x.key.camelot)}</span><span></span></div>`).join("")}</div>` : ""}</section>`;
}

function trackPanel(tr) {
  const playing = player.id === tr.id && !player.audio.paused;
  return `<section class="panel"><div class="thead">${UI.art(tr, "lg")}<div style="min-width:0">
      <div class="artist">${UI.esc(dispArtist(tr))}</div><div class="title">${UI.esc(tr.title)}</div>
      <div class="meta"><span>${UI.esc(trackMetaLine(tr))}</span><span>${UI.esc(UI.statusWord(tr))}</span>${tr.truncated ? `<span class="faint">${t("track.firstSeconds", { n: Math.round(tr.analyzedSeconds) })}</span>` : ""}</div></div>
      <div class="acts"><button class="playbtn" data-trackplay="${tr.id}" aria-label="${UI.esc(t(playing ? "player.pause" : "player.play"))}">${UI.icon(playing ? "pause" : "play")}</button>
      <button class="iconbtn" id="trackMore" aria-label="${UI.esc(t("common.more"))}">${UI.icon("more")}</button></div></div>
    ${UI.stages(tr)}
    <nav class="tabs" role="tablist">${TRACK_TABS.map((k) => `<button role="tab" aria-selected="${state.trackTab === k}" class="${state.trackTab === k ? "active" : ""}" data-ttab="${k}">${t("tab." + k)}</button>`).join("")}</nav>
    <div id="tabPane">${({ overview: tabOverview, structure: tabStructure, spectral: tabSpectral, rhythm: tabRhythm, harmonic: tabHarmonic, similar: tabSimilar, dj: tabDj, notes: tabNotes })[state.trackTab](tr)}</div></section>`;
}

/* --- shared blocks --- */
function structureInfo(tr) { const st = structureOf(tr), an = tr.analysis || {}; return { st, why: an.structure && an.structure.reason, status: an.structure && an.structure.status }; }
function waveBlock(tr, { legend = true } = {}) {
  const { st, status } = structureInfo(tr);
  const src = st ? `${t("wave.structure")} · ${UI.esc(st.local ? t("structure.localName") : st.analyzer)}` : status === "UNAVAILABLE" ? t("wave.structureUnavailable") : t("wave.structureNone");
  return `<div class="wavepanel"><div class="wave-top"><span class="src">${src}${UI.help("structure")}</span>
      ${UI.seg([["mono", t("wave.mono")], ["spectral", t("wave.spectral")]], state.waveStyle, "data-wstyle")}</div>
    ${tr.waveform ? `<canvas class="wave" id="tabWave" data-kind="main" aria-label="${UI.esc(t("wave.aria"))}"></canvas>` : `<div class="empty">${t("wave.none")}</div>`}
    ${legend && st ? `<div class="legend">${st.segments.map((s) => `<button onclick="seekTo('${tr.id}', ${s.start})" title="${fmtTime(s.start)}–${fmtTime(s.end)}"><i style="background:${SEC_COLORS()[s.label] || "#888"}"></i>${UI.esc(secLabel(s.label))} ${fmtTime(s.start)}</button>`).join("")}</div>` : ""}</div>`;
}
const manChip = (tr, k) => (tr.manualOverrides && tr.manualOverrides[k] ? ` <span class="badge">${t("common.manual")}</span>` : "");
function genreSub(tr) {
  const g = tr.genre;
  if (g.method === "discogs-effnet") return `${UI.esc(g.parent || "")} · ${t("genre.styleScore", { n: g.confidence })}${g.secondary && g.secondary[0] ? `<br><span class="faint">${t("genre.also")} ${UI.esc(g.secondary.slice(0, 2).map((x) => x[0]).join(", "))}</span>` : ""}`;
  if (g.method === "manual") return `${t("genre.manual")}`;
  return `${t("genre.rule", { n: Math.round(g.confidence) })}`;
}
function primaryMetrics(tr) {
  const an = tr.analysis || {}, bk = an.backend && an.backend.status === "AVAILABLE" ? an.backend : null;
  const rel = an.bpm ? t("metric.reliable", { n: Math.round(an.bpm.reliability) }) : "";
  const keyName = tr.key.tonic ? `${tr.key.tonic} ${t(tr.key.mode === "maj" ? "key.major" : "key.minor")}` : "";
  const lufs = bk && bk.energy.loudnessLufs != null ? `${bk.energy.loudnessLufs.toFixed(1)}<small>LUFS</small>` : NA;
  const edit = (fn) => `<button type="button" onclick="${fn}('${tr.id}')">${t("common.edit")}</button>`;
  return `<div class="metrics">
    ${UI.metric("BPM", tr.bpm != null ? tr.bpm.toFixed(1) : NA, rel + manChip(tr, "bpm"), edit("editBpmPrompt"))}
    ${UI.metric(t("metric.key"), `${UI.camelotRing(tr.key.camelot, 30)}${UI.keyBadge(tr.key.camelot)}`, UI.esc(keyName) + manChip(tr, "key"), edit("editCamelotPrompt"))}
    ${UI.metric(t("metric.genre"), `<span class="txt" style="font-size:16px;white-space:normal">${UI.esc(tr.genre.primary)}</span>`, genreSub(tr), tr.genre.method === "manual" ? edit("editGenrePrompt") : "", "wide")}
    ${UI.metric(t("metric.energy"), Math.round(tr.profile.energy) + "<small>%</small>", t("metric.energySub"))}
    ${UI.metric(t("metric.danceability"), Math.round(tr.profile.danceability) + "<small>%</small>", bk && bk.rhythm.danceability != null ? t("metric.danceEss", { n: bk.rhythm.danceability }) : t("metric.estimated"))}
    ${UI.metric(t("metric.loudness"), lufs, bk ? "EBU R128" : t("metric.needsBackend"), "", "wide")}
  </div>`;
}
function featureGrid(tr) {
  const p = tr.profile, an = tr.analysis || {}, bk = an.backend && an.backend.status === "AVAILABLE" ? an.backend : null;
  const pctBar = (v) => UI.bar(v, "var(--text-2)");
  const items = [
    [t("feat.energyOverTime"), tr.structure ? `${Math.round(Math.min(...tr.structure.energyCurve) * 100)}–${Math.round(Math.max(...tr.structure.energyCurve) * 100)}` : NA, UI.sparkline(tr.structure && tr.structure.energyCurve, "#e8b64a")],
    [t("feat.centroid"), bk ? bk.timbre.spectralCentroidHz + " Hz" : Math.round(p.brightness) + "% " + t("feat.bright"), pctBar(p.brightness)],
    [t("feat.rhythmDensity"), bk && bk.rhythm.onsetRate != null ? bk.rhythm.onsetRate + " " + t("feat.onsetsPerSec") : Math.round(p.rhythmicComplexity) + "%", pctBar(p.rhythmicComplexity)],
    [t("feat.keyClarity"), an.key ? Math.round(an.key.reliability) + "%" : NA, pctBar(an.key ? an.key.reliability : 0)],
    [t("feat.drums"), Math.round(p.drumDensity) + "%", pctBar(p.drumDensity)], [t("feat.bass"), Math.round(p.bassDensity) + "%", pctBar(p.bassDensity)],
    [t("feat.harmonic"), Math.round(p.harmonicComplexity) + "%", pctBar(p.harmonicComplexity)], [t("feat.dynamic"), Math.round(p.dynamicRange) + "%", pctBar(p.dynamicRange)],
  ];
  return `<div class="featgrid">${items.map(([l, v, g]) => `<div class="feat"><div class="head"><span class="label">${l}</span><span class="mono">${v}</span></div>${g}</div>`).join("")}</div>`;
}
const feat = (l, v, g) => `<div class="feat"><div class="head"><span class="label">${l}</span><span class="mono">${v}</span></div>${g}</div>`;

/* --- OVERVIEW --- */
function tabOverview(tr) {
  const { st } = structureInfo(tr);
  return `<div class="overview">${waveBlock(tr)}${primaryMetrics(tr)}</div>
    ${st ? UI.sectionHead(t("tab.structure"), t("structure.count", { n: st.segments.length })) + structureStrip(tr, st) : ""}
    ${UI.sectionHead(t("feat.title"), tr.truncated ? t("feat.localFirst", { n: Math.round(tr.analyzedSeconds) }) : "")}${featureGrid(tr)}`;
}
function structureStrip(tr, st) {
  return `<div class="chips">${st.segments.map((s) => `<button class="chip" onclick="seekTo('${tr.id}', ${s.start})"><i style="background:${SEC_COLORS()[s.label] || "#888"}"></i>${UI.esc(secLabel(s.label))} <span class="mono">${fmtTime(s.start)}–${fmtTime(s.end)}</span></button>`).join("")}</div>`;
}

/* --- STRUCTURE --- */
function tabStructure(tr) {
  const { st, why, status } = structureInfo(tr);
  if (!st) return `${waveBlock(tr)}<div class="empty"><b>${t("structure.noneTitle")}</b>${UI.esc(why ? t("structure.reason", { r: why }) : t("structure.noneText"))}${status === undefined || status === "ERROR" ? `<div style="margin-top:12px"><button class="btn" data-stage="structure">${t("structure.run")}</button></div>` : ""}</div>`;
  const n = (v, u = "") => (v == null ? NA : v + u), g = trackGrid(tr);
  return `${waveBlock(tr)}
    ${UI.sectionHead(t("structure.dj"), UI.esc(st.local ? t("structure.localName") : st.analyzer))}
    <dl class="kv"><dt>${t("structure.firstDownbeat")}</dt><dd class="num">${n(st.firstDownbeat, " s")}</dd><dt>${t("structure.barLength")}</dt><dd class="num">${n(st.barSeconds, " s")} · ${t("structure.bars", { n: st.downbeatCount })}</dd>
      <dt>${t("structure.gridKind")}</dt><dd>${g ? t("grid." + g.kind) : NA}${UI.help("grid")}</dd>
      <dt>${t("structure.intro")}</dt><dd>${n(st.introDuration, " s")} (${n(st.introBars)} ${t("unit.bars")}) <span class="faint">${t("structure.onlyLabelled")}</span></dd>
      <dt>${t("structure.outro")}</dt><dd>${n(st.outroDuration, " s")} (${n(st.outroBars)} ${t("unit.bars")})</dd>
      <dt>${t("structure.majorChanges")}</dt><dd>${st.majorTransitions.length ? st.majorTransitions.map(fmtTime).join(" · ") : t("common.none")} <span class="faint">${t("structure.majorHint")}</span></dd>
      <dt>${t("structure.breakdowns")}</dt><dd>${st.breakdownPositions.length ? st.breakdownPositions.map(fmtTime).join(" · ") : t("common.none")}</dd></dl>
    ${UI.sectionHead(t("structure.sections"), t("structure.labelsCanBeWrong", { n: st.segments.length }))}
    <table class="t"><thead><tr><th>${t("structure.start")}</th><th>${t("structure.end")}</th><th>${t("structure.label")}</th><th>${t("structure.length")}</th><th>${t("structure.loudness")}</th></tr></thead><tbody>
    ${st.segments.map((s) => `<tr class="row" onclick="seekTo('${tr.id}', ${s.start})"><td class="num mono">${fmtTime(s.start)}</td><td class="num mono">${fmtTime(s.end)}</td><td><span class="chip"><i style="background:${SEC_COLORS()[s.label] || "#888"}"></i>${UI.esc(secLabel(s.label))}</span></td><td class="num mono">${(s.end - s.start).toFixed(1)} s</td><td class="num mono">${s.energyDb != null ? s.energyDb.toFixed(1) + " dB" : NA}</td></tr>`).join("")}</tbody></table>`;
}

/* --- SPECTRAL --- */
function tabSpectral(tr) {
  const p = tr.profile, bk = tr.analysis && tr.analysis.backend && tr.analysis.backend.status === "AVAILABLE" ? tr.analysis.backend : null;
  const bars = (arr) => `<div style="display:flex;gap:3px;align-items:flex-end;height:46px">${arr.map((v) => { const mx = Math.max(...arr.map(Math.abs), 1e-9); return `<i style="flex:1;background:var(--text-2);height:${Math.max(2, Math.abs(v) / mx * 100)}%;opacity:${v >= 0 ? 1 : 0.45}"></i>`; }).join("")}</div>`;
  const rows = [["brightness", p.brightness], ["darkness", p.darkness], ["texture", p.texture], ["bassDensity", p.bassDensity], ["drumDensity", p.drumDensity], ["acousticness", p.acousticness], ["electronicness", p.electronicness]];
  return `${UI.sectionHead(t("spectral.profile"), t("spectral.localDsp"))}<div class="featgrid">${rows.map(([k, v]) => feat(t("spectral." + k), Math.round(v) + "%", UI.bar(v, "var(--text-2)"))).join("")}</div>
    ${UI.sectionHead("Essentia", bk ? UI.esc(bk.engine) : t("common.unavailable"))}
    ${bk ? `<dl class="kv"><dt>${t("feat.centroid")}</dt><dd class="num">${bk.timbre.spectralCentroidHz} Hz</dd><dt>${t("spectral.rolloff")}</dt><dd class="num">${bk.timbre.spectralRolloffHz} Hz</dd><dt>${t("spectral.flux")}</dt><dd class="num">${bk.timbre.spectralFluxMean ?? NA}</dd><dt>${t("spectral.dynComplexity")}</dt><dd class="num">${bk.energy.dynamicComplexity}</dd><dt>${t("spectral.loudRange")}</dt><dd class="num">${bk.energy.loudnessRangeLu} LU</dd></dl>
      <div class="featgrid">${feat("MFCC (13)", "", bars(bk.timbre.mfccMean.slice(1)))}${feat(t("spectral.contrast"), "", bars(bk.timbre.spectralContrastMean))}</div>` : `<div class="empty">${t("spectral.needsBackend")}</div>`}`;
}

/* --- RHYTHM --- */
function tabRhythm(tr) {
  const an = tr.analysis || {}, c = (an.bpm && an.bpm.candidates) || {}, bk = an.backend && an.backend.status === "AVAILABLE" ? an.backend : null;
  const cand = [[t("rhythm.srcBackend"), c.backend], ["Essentia.js", c.essentia], ["All-In-One", c.allin1], [t("rhythm.srcAutocorr"), c.autocorrelation], [t("rhythm.srcPeak"), c.peakInterval]].filter(([, v]) => v != null);
  const rel = an.bpm ? an.bpm.reliability : null;
  const agree = (v) => { const r = DjEngine.bpmRelation(tr.bpm, v); return r.distPct <= 6 ? `<span style="color:var(--success)">${t("rhythm.agrees")}</span>${r.octave ? " (" + t("rhythm.halfDouble") + ")" : ""}` : `<span style="color:var(--error)">${t("rhythm.differs", { n: r.distPct.toFixed(0) })}</span>`; };
  return `${UI.sectionHead(t("rhythm.consensus") + UI.help("bpm"), rel != null ? t("rhythm.reliability", { n: Math.round(rel) }) : "")}
    <table class="t"><thead><tr><th>${t("rhythm.source")}</th><th>BPM</th><th>${t("rhythm.vsResult")}</th></tr></thead><tbody>${cand.length ? cand.map(([n, v]) => `<tr><td>${n}</td><td class="num mono">${v}</td><td>${agree(v)}</td></tr>`).join("") : `<tr><td colspan="3" class="faint">${NA}</td></tr>`}</tbody></table>
    <dl class="kv" style="margin-top:20px"><dt>${t("rhythm.result")}</dt><dd class="num">${tr.bpm.toFixed(1)} BPM ${manChip(tr, "bpm")}</dd>
      ${an.bpm && an.bpm.modelConfidence != null ? `<dt>${t("rhythm.modelConf")}</dt><dd class="num">${an.bpm.modelConfidence.toFixed(2)} <span class="faint">${t("rhythm.modelConfHint")}</span></dd>` : ""}
      ${bk && bk.bpm.alternatives ? `<dt>${t("rhythm.alternatives")}</dt><dd class="num">${bk.bpm.alternatives.join(" · ")}</dd>` : ""}
      ${bk ? `<dt>${t("rhythm.beats")}</dt><dd class="num">${bk.bpm.beatCount}</dd><dt>${t("rhythm.regularity")}</dt><dd class="num">${bk.bpm.beatIntervalCv ?? NA}</dd><dt>${t("rhythm.firstBeat")}</dt><dd class="num">${bk.bpm.firstBeatSec ?? NA} s</dd><dt>${t("rhythm.onsetRate")}</dt><dd class="num">${bk.rhythm.onsetRate ?? NA} /s</dd><dt>${t("metric.danceability")} (Essentia)</dt><dd class="num">${bk.rhythm.danceability ?? NA}</dd>` : ""}
      <dt>${t("rhythm.complexity")}</dt><dd class="num">${Math.round(tr.profile.rhythmicComplexity)}%</dd><dt>${t("rhythm.stability")}</dt><dd class="num">${Math.round(tr.profile.tempoStability)}%</dd></dl>`;
}

/* --- HARMONIC --- */
function tabHarmonic(tr) {
  const an = tr.analysis || {}, k = an.key || {}, bk = an.backend && an.backend.status === "AVAILABLE" ? an.backend : null, ek = an.essentia && an.essentia.keys ? an.essentia.keys : [];
  return `<div style="display:grid;grid-template-columns:auto 1fr;gap:40px;align-items:center">${UI.camelotRing(tr.key.camelot, 150)}
    <dl class="kv"><dt>Camelot${UI.help("camelot")}</dt><dd style="font-size:28px;letter-spacing:-.02em">${UI.esc(tr.key.camelot === "unknown" ? NA : tr.key.camelot)}</dd><dt>${t("metric.key")}</dt><dd>${tr.key.tonic ? UI.esc(tr.key.tonic) + " " + t(tr.key.mode === "maj" ? "key.major" : "key.minor") : NA}</dd>
    <dt>${t("harm.reliability")}</dt><dd class="num">${k.reliability != null ? Math.round(k.reliability) + "%" : NA} ${k.agreement ? `<span class="faint">· ${UI.esc(k.agreement)}</span>` : ""}</dd>
    ${k.modelStrength != null ? `<dt>${t("harm.modelStrength")}</dt><dd class="num">${(+k.modelStrength).toFixed(2)}</dd>` : ""}${k.legacyCamelot ? `<dt>${t("harm.legacy")}</dt><dd>${UI.esc(k.legacyCamelot)}</dd>` : ""}</dl></div>
    ${bk && bk.key.profiles ? UI.sectionHead(t("harm.backendProfiles"), t("harm.voteShare", { n: bk.key.reliability })) + `<div class="chips">${bk.key.profiles.map((p) => `<span class="chip">${UI.esc(p.replace(":", " → "))}</span>`).join("")}</div>` : ""}
    ${ek.length ? UI.sectionHead("Essentia.js", "") + `<div class="chips">${ek.map((x) => `<span class="chip">${UI.esc(x.profile)} → ${UI.esc(x.key)} ${UI.esc(x.scale)} · ${(+x.strength).toFixed(2)}</span>`).join("")}</div>` : ""}
    ${UI.sectionHead(t("harm.features"), t("spectral.localDsp"))}<div class="featgrid">${[["feat.harmonic", tr.profile.harmonicComplexity], ["harm.melodic", tr.profile.melodicDensity]].map(([l, v]) => feat(t(l), Math.round(v) + "%", UI.bar(v, "var(--text-2)"))).join("")}</div>`;
}

/* --- SIMILAR --- */
function tabSimilar(tr) { return `<div id="simProfile">${sonicProfileBlock(tr)}</div>${UI.sectionHead(t("similar.inLibrary"), t("similar.sonicNote"))}<div id="simTabList" class="sim-list"><div class="empty">…</div></div>`; }
function sonicProfileBlock(tr) {
  const s = tr.analysis && tr.analysis.sonic, btn = `<button class="btn sm" data-stage="embedding">${t("sonic.compute")}</button>`;
  if (!s) return UI.sectionHead(t("sonic.profile"), "") + `<p class="dim">${t("sonic.none")} ${BackendClient.apiUrl() ? btn : t("sonic.connect")}</p>`;
  if (s.status !== "AVAILABLE") return UI.sectionHead(t("sonic.profile"), "") + `<p class="dim">${t("sonic.status", { s: s.status.toLowerCase() })} ${UI.esc(s.reason || "")} ${btn}</p>`;
  return UI.sectionHead(t("sonic.profile"), `${UI.esc(s.model)} v${UI.esc(s.modelVersion)} · ${s.dims}-d · ${UI.esc(s.pooling)}`) +
    (sonicStale(tr) ? `<p style="color:var(--warning)">${t("sonic.stale")} ${btn}</p>` : "") +
    `<div class="featgrid">${(s.topStyles || []).map((x) => feat(UI.esc(x.label.replace("---", " / ")), Math.round(x.score * 100) + "%", UI.bar(x.score * 100 * 3, "var(--text-2)"))).join("")}</div><p class="mono faint" style="margin-top:12px">${t("sonic.note", { lic: UI.esc(s.license || "") })}</p>`;
}
async function fillSimilarTab(tr) {
  if (sonicIdOf(tr)) await ensureSonic();
  const el = document.getElementById("simTabList"); if (!el || state.currentTrackId !== tr.id) return;
  const rows = similarRows(tr, { useFilters: false }).slice(0, 12);
  el.innerHTML = rows.length ? rows.map(similarRowHtml).join("") : `<div class="empty">${t("similar.addMore")}</div>`;
  el.querySelectorAll("canvas[data-wid]").forEach((c) => bindWave(c, c.dataset.wid));
}

/* --- DJ COMPATIBILITY: every score has its factors, its confidence and a reason --- */
const DJ_FACTORS = ["tempo", "key", "rhythm", "groove", "energy", "structure", "genre"];
function djBreakdown(d) {
  return `<div class="bd">${DJ_FACTORS.map((k) => { const v = d[k]; return `<div><div class="l"><span>${t("dj." + k)}</span><span class="num">${v == null ? NA : Math.round(v)}</span></div>${UI.bar(v ?? 0, UI.barTone(v))}</div>`; }).join("")}</div>`;
}
function confidenceBadge(c) { return `<span class="badge ${c.level}" data-tip="${UI.esc(c.missing.length ? t("conf.missing", { list: c.missing.map((k) => t("dj." + k)).join(", ") }) : t("conf.full"))}">${t("conf." + c.level)}</span>`; }
function tabDj(tr) {
  const rows = state.library.filter((o) => o.id !== tr.id).map((o) => ({ o, ...transitionOf(tr, o), sonic: sonicScore(tr, o) })).sort((a, b) => b.compat.overall - a.compat.overall).slice(0, 8);
  if (!rows.length) return `<div class="empty">${t("dj.addMore")}</div>`;
  return `${UI.sectionHead(t("dj.mixesWell") + UI.help("dj"), t("dj.basis"))}` + rows.map((r) => `<div class="djrow">
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">${UI.art(r.o, "xs")}<div style="flex:1;min-width:140px;cursor:pointer" data-open-track="${r.o.id}"><div class="t2 dim" style="font-size:11px">${UI.esc(dispArtist(r.o))}</div><div>${UI.esc(r.o.title)}</div></div>
      ${confidenceBadge(r.compat.confidence)}${UI.score("dj", r.compat.overall)}${r.sonic ? UI.score("sonic", r.sonic.overall) : ""}
      ${r.guide && r.guide.available ? `<button class="btn sm" data-guide="${tr.id}|${r.o.id}">${t("guide.open")}</button>` : ""}<button class="btn sm" data-addset="${r.o.id}">${UI.icon("plus")}${t("common.set")}</button></div>
    ${djBreakdown(r.compat)}
    <ul class="why">${r.compat.notes.map((n) => `<li class="${n.level}">${UI.esc(noteText(n))}</li>`).join("")}</ul></div>`).join("");
}

/* --- NOTES --- */
function tabNotes(tr) {
  const mo = tr.manualOverrides || {}, d = (x) => new Date(x.setAt).toLocaleDateString(LANG === "ru" ? "ru-RU" : "en-GB");
  return `${UI.sectionHead(t("notes.title"), t("notes.saved"))}<textarea id="noteArea" rows="8" placeholder="${UI.esc(t("notes.placeholder"))}" style="resize:vertical">${UI.esc(tr.notes || "")}</textarea>
    ${UI.sectionHead(t("notes.overrides"), t("notes.overridesHint"))}
    <dl class="kv"><dt>BPM</dt><dd>${mo.bpm ? mo.bpm.value + ` <span class="faint">${d(mo.bpm)}</span>` : t("notes.auto")}</dd><dt>${t("metric.key")}</dt><dd>${mo.key ? UI.esc(mo.key.value) + ` <span class="faint">${d(mo.key)}</span>` : t("notes.auto")}</dd><dt>${t("metric.genre")}</dt><dd>${mo.genre ? UI.esc(mo.genre.value) + ` <span class="faint">${d(mo.genre)}</span>` : t("notes.auto")}</dd></dl>`;
}

/* ---- delegated events for the Analyze view ---- */
document.addEventListener("click", (e) => {
  const tt = e.target.closest("[data-ttab]"); if (tt) { state.trackTab = tt.dataset.ttab; renderActiveView(); return; }
  const ws = e.target.closest("[data-wstyle]"); if (ws) { state.waveStyle = ws.dataset.wstyle; persistUi(); renderActiveView(); return; }
  if (e.target.closest("#trackMore")) { trackMoreMenu(e.target.closest("#trackMore"), state.currentTrackId); return; }
  const sg = e.target.closest("[data-stage]"); if (sg && state.currentTrackId) { runStageOnly(state.currentTrackId, sg.dataset.stage); return; }
  const gd = e.target.closest("[data-guide]"); if (gd) { const [a, b] = gd.dataset.guide.split("|"); openTransitionGuide(a, b, !!gd.dataset.autoplay); return; }
  const as = e.target.closest("[data-addset]"); if (as) { e.stopPropagation(); addToSet(as.dataset.addset); return; }
  const op = e.target.closest("[data-open-track]");
  if (op && !e.target.closest("button, canvas, input, a")) openTrack(op.dataset.openTrack);
});
document.addEventListener("keydown", (e) => { if ((e.key === "Enter") && e.target.matches && e.target.matches("[data-open-track]")) openTrack(e.target.dataset.openTrack); });
