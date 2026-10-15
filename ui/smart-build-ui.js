/* =================== Smart Build panel (Set Builder mode "Smart"): filters -> a set of the requested real duration =================== */
const SMART_DURATIONS = [30, 40, 45, 60, 90, 120];
const SMART_TOLERANCES = [1, 2, 3, 5];
const smartDefaults = () => ({ source: { type: "library" }, durationMin: 60, custom: false, toleranceMin: 2, genres: [], bpmMin: null, bpmMax: null, keys: [], energyMin: null, energyMax: null, datePreset: "", dateFrom: null, dateTo: null, pref: "balanced" });
function smartCfg() { const c = state.currentSet, d = smartDefaults(); if (!c.smart) c.smart = d; else for (const k of Object.keys(d)) if (c.smart[k] === undefined) c.smart[k] = d[k]; return c.smart; }
let smartBusy = false, smartInsufficient = null;

/* ---- the pool: source first, then every filter (all combined, all hard) ---- */
function smartSourceTracks(src) {
  const lib = state.library;
  switch (src && src.type) {
    case "crate": return state.crate.map(findTrack).filter(Boolean);
    case "folder": return lib.filter((x) => LibraryTools.folderOf(x) === src.folder);
    case "batch": return lib.filter((x) => x.importBatchId === src.id || (state.imports.find((b) => b.id === src.id) || { knownIds: [] }).knownIds.includes(x.id));
    case "ids": return (src.ids || []).map(findTrack).filter(Boolean);
    case "rbplaylist": { const s = state.rb.sources.find((z) => z.id === src.sid); if (!s) return []; const find = (ns) => { for (const n of ns) { if (n.id === src.nid) return n; if (n.type === "folder") { const f = find(n.children); if (f) return f; } } return null; }, n = find(s.tree); return n ? rbLibraryIds(s, rbPlaylistTrackIds(n)).map(findTrack).filter(Boolean) : []; }
    case "recent": return lib;   // the date filter below does the work
    default: return lib;
  }
}
function smartFilter(cfg) {
  const f = { genres: cfg.genres, bpmMin: cfg.bpmMin, bpmMax: cfg.bpmMax, keys: cfg.keys, energyMin: cfg.energyMin, energyMax: cfg.energyMax };
  const preset = cfg.source.type === "recent" && !cfg.datePreset ? "7d" : cfg.datePreset;
  if (preset) { const r = LibraryTools.dateRange(preset, Date.now(), { from: cfg.dateFrom, to: cfg.dateTo }); f.dateFrom = r.from; f.dateTo = r.to; if (f.dateFrom == null && f.dateTo == null) { f.dateFrom = -Infinity; } }
  return f;
}
function smartPool(cfg) { const f = smartFilter(cfg); return smartSourceTracks(cfg.source).filter((x) => x.durationSec > 30 && LibraryTools.matchTrack(x, f)); }
const estOverlap = (a, b) => ({ sec: DjEngine.overlapSeconds(a, b), source: "estimate" });
// overlap from the transition guide where a bar grid exists (measured / estimated grid), else the engine estimate
function guideOverlap(a, b) {
  const ta = findTrack(a.id), tb = findTrack(b.id); if (!ta || !tb) return estOverlap(a, b);
  const g = transitionOf(ta, tb).guide;
  if (g && g.available) { const bar = Transition.barSec(a); return { sec: g.bars ? g.bars * bar : 0.25, source: "grid" }; }
  return estOverlap(a, b);
}
const pairCompat = (a, b) => { const ta = findTrack(a.id), tb = findTrack(b.id); return ta && tb ? transitionCache.get(ta, tb).overall : null; };
const fmtMS = (sec) => { const s = Math.round(Math.abs(sec)), m = Math.floor(s / 60); return (sec < 0 ? "−" : sec > 0 ? "+" : "") + String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const fmtClock = (sec) => { const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + String(s % 60).padStart(2, "0"); };

/* ---- run ---- */
async function smartRun({ allowShort = false } = {}) {
  if (smartBusy) return; const cfg = smartCfg(), tracks = smartPool(cfg);
  smartBusy = true; smartInsufficient = null; toast(t("smart.building")); await tick(30);
  try {
    let poolT = tracks; if (poolT.length > 220) poolT = poolT.slice().sort(() => 0.5 - Math.random()).slice(0, 220);   // keeps the search interactive
    const pool = poolT.map(trackToEngineShape), target = cfg.durationMin * 60, tol = cfg.toleranceMin * 60;
    const lockedIds = state.currentSet.locked.filter((id) => pool.some((p) => p.id === id) || findTrack(id)), prev = state.currentSet.trackIds;
    const lockedSpec = lockedIds.map((id) => ({ id, index: prev.indexOf(id) >= 0 ? prev.indexOf(id) : null })).filter((l) => findTrack(l.id));
    lockedSpec.forEach((l) => { if (!pool.some((p) => p.id === l.id)) pool.push(trackToEngineShape(findTrack(l.id))); });
    await ensureSonic();
    let r = SmartBuild.build({ pool, targetSec: target, toleranceSec: tol, curvePts: state.currentSet.build.pts, pref: cfg.pref, compat: pairCompat, overlap: estOverlap, locked: lockedSpec, seed: state.currentSet.build.seed, allowShort });
    if (r.status === "insufficient" && !allowShort) { smartInsufficient = { matched: tracks.length, availableSec: r.availableSec, targetSec: target, suggestions: smartSuggestions(cfg, target) }; renderActiveView(); return; }
    if (!r.ids.length) { toast(t("sb.notEnough")); return; }
    // the search used cheap overlap estimates; settle the final length with the measured ones
    const byId = new Map(pool.map((p) => [p.id, p]));
    let seq = r.ids.map((id) => byId.get(id));
    seq = SmartBuild.fitToTarget(seq, pool, { targetSec: target, toleranceSec: tol, compat: pairCompat, overlap: guideOverlap, locked: new Set(lockedSpec.map((l) => l.id)), pinned: new Set(lockedSpec.filter((l) => l.index != null).map((l) => l.id)) });
    const prevIds = state.currentSet.trackIds.slice(), ids = seq.map((s) => s.id);
    state.currentSet.trackIds = ids;
    if (/^(Untitled set|Новый сет)$/.test(state.currentSet.name) || /^Smart · /.test(state.currentSet.name)) state.currentSet.name = "Smart · " + cfg.durationMin + " min" + (cfg.genres.length ? " · " + cfg.genres.slice(0, 2).join(" + ") : "");
    state.currentSet.smartResult = { at: Date.now(), targetSec: target, toleranceSec: tol, pref: cfg.pref, matched: tracks.length };
    persistCurrentSet(); sbNote = t("sb.recalc", { n: SetTools.affectedPairs(prevIds, ids).length, total: ids.length - 1 });
    renderActiveView();
    prepareSetGrids();   // bar grids make the durations and mix points exact; they arrive in the background
  } finally { smartBusy = false; }
}
function smartRegenerate() {
  const tracks = setTracks(); if (tracks.length < 3) return;
  const cfg = smartCfg(), poolT = smartPool(cfg), pool = poolT.map(trackToEngineShape), order = tracks.map(trackToEngineShape);
  const lockedIndexes = tracks.map((x, i) => (isLocked(x.id) ? i : -1)).filter((i) => i >= 0);
  const re = SmartBuild.regenerate(order, pool, { lockedIndexes, compat: pairCompat, curvePts: state.currentSet.build.pts });
  applyOrder(re.map((x) => x.id)); toast(t("smart.regenerated", { n: tracks.length - lockedIndexes.length }));
}
// "what would make this work": counted from real data, applied only when the user agrees
function smartSuggestions(cfg, target) {
  const base = smartSourceTracks(cfg.source), out = [], avail = (c) => { const tr = smartPool(c); return { n: tr.length, sec: SmartBuild.availableSec(tr.map(trackToEngineShape), estOverlap) }; };
  const add = (id, label, patch) => { const c = { ...cfg, ...patch }, a = avail(c); if (a.n > smartPool(cfg).length) out.push({ id, label, patch, n: a.n, sec: a.sec, enough: a.sec >= target - cfg.toleranceMin * 60 }); };
  if (cfg.bpmMin != null || cfg.bpmMax != null) add("bpm", t("smart.sugg.bpm"), { bpmMin: cfg.bpmMin != null ? cfg.bpmMin - 5 : null, bpmMax: cfg.bpmMax != null ? cfg.bpmMax + 5 : null });
  if (cfg.genres.length) { const parents = new Set(state.library.filter((x) => cfg.genres.includes(x.genre.primary) && x.genre.parent).map((x) => x.genre.parent)); const rel = [...new Set(state.library.filter((x) => parents.has(x.genre.parent)).map((x) => x.genre.primary))]; if (rel.length > cfg.genres.length) add("genre", t("smart.sugg.genre"), { genres: rel }); else add("genre", t("smart.sugg.anyGenre"), { genres: [] }); }
  if (cfg.keys.length) { const ext = new Set(cfg.keys); cfg.keys.forEach((k) => { const m = /^(\d+)([AB])$/.exec(k); if (m) { const n = +m[1]; [(n % 12) + 1, ((n + 10) % 12) + 1].forEach((x) => ext.add(x + m[2])); ext.add(n + (m[2] === "A" ? "B" : "A")); } }); add("keys", t("smart.sugg.keys"), { keys: [...ext] }); }
  if (cfg.datePreset) add("date", t("smart.sugg.older"), { datePreset: "", dateFrom: null, dateTo: null });
  if (cfg.energyMin != null || cfg.energyMax != null) add("energy", t("smart.sugg.energy"), { energyMin: cfg.energyMin != null ? Math.max(0, cfg.energyMin - 15) : null, energyMax: cfg.energyMax != null ? Math.min(100, cfg.energyMax + 15) : null });
  if (cfg.source.type !== "library") add("source", t("smart.sugg.library"), { source: { type: "library" } });
  if (cfg.pref !== "creative") out.push({ id: "pref", label: t("smart.sugg.flex"), patch: { pref: "creative" }, n: null, sec: null, enough: false });
  return out;
}

/* ---- summary of the current set (live: follows manual edits) ---- */
function smartSummary(tracks) {
  if (!tracks.length) return null;
  const S = tracks.map(trackToEngineShape), d = SmartBuild.setDuration(S, guideOverlap), cfg = smartCfg(), res = state.currentSet.smartResult;
  const target = (res && res.targetSec) || cfg.durationMin * 60, bpms = tracks.map((x) => x.bpm), en = tracks.map((x) => x.profile.energy);
  const gen = {}; tracks.forEach((x) => { gen[x.genre.primary] = (gen[x.genre.primary] || 0) + 1; });
  const keys = [...new Set(tracks.map((x) => x.key.camelot).filter((k) => k && k !== "unknown"))].sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
  const trans = tracks.slice(1).map((x, i) => transitionOf(tracks[i], x)), an = tracks.length > 1 ? SetTools.analyzeSet(S, trans.map((x) => x.compat), { curvePts: state.currentSet.build.pts }) : null;
  return { name: state.currentSet.name, count: tracks.length, target, duration: d, diff: d.effectiveSec - target, tol: ((res && res.toleranceSec) || cfg.toleranceMin * 60), bpm: [Math.min(...bpms), Math.max(...bpms)], genres: Object.entries(gen).sort((a, b) => b[1] - a[1]), keys, energy: en, score: an && an.score, noGrid: trans.filter((x) => !(x.guide && x.guide.available)).length, trans: trans.length };
}
function smartSummaryHtml(tracks) {
  const s = smartSummary(tracks); if (!s) return "";
  const within = Math.abs(s.diff) <= s.tol, plan = state.currentSet.build.pts;
  const row = (k, v) => `<div class="rbrow"><span>${k}</span><b>${v}</b></div>`;
  return `<div class="smartsum"><div class="panel-head" style="margin-bottom:8px"><h2>${t("smart.result")}</h2><span class="badge ${within ? "easy" : "medium"}">${within ? t("smart.withinTol") : t("smart.outsideTol")}</span></div>
    <div class="rbcols"><div>${row(t("smart.name"), UI.esc(s.name))}${row(t("sb.tracks"), s.count)}${row(t("smart.target"), fmtClock(s.target))}${row(t("smart.estimated"), fmtClock(s.duration.effectiveSec))}${row(t("smart.diff"), `<span class="${within ? "" : "bad"}">${fmtMS(s.diff)}</span>`)}</div>
      <div>${row(t("sb.bpmRange"), s.bpm[0].toFixed(0) + "–" + s.bpm[1].toFixed(0))}${row(t("smart.genres"), s.genres.slice(0, 4).map(([g, n]) => UI.esc(g) + " ×" + n).join(", "))}${row(t("smart.keys"), s.keys.length ? UI.esc(s.keys[0] + (s.keys.length > 1 ? " … " + s.keys[s.keys.length - 1] : "")) + ` <span class="faint">(${s.keys.length})</span>` : UI.NA)}${row(t("setscore.title"), s.score ? `<span class="${UI.tone(s.score.total)}">${s.score.total}</span> <span class="badge ${s.score.confidence}">${t("conf." + s.score.confidence)}</span>` : UI.NA)}</div></div>
    <div class="mono faint" style="margin:10px 0 4px">${t("smart.sum")}: ${fmtClock(s.duration.sumSec)} − ${t("smart.overlaps")}: ${fmtClock(s.duration.overlapSec)} = ${fmtClock(s.duration.effectiveSec)} · ${t("smart.overlapBasis", { m: s.duration.measured, e: s.duration.estimated })}</div>
    ${s.noGrid ? `<div class="warnbox">${t("smart.noGrid", { n: s.noGrid, total: s.trans })}</div>` : ""}
    <div class="curvebox" style="margin:8px 0 0"><div class="label" style="margin-bottom:4px">${t("smart.energyPlanActual")}</div><div class="spk">${UI.sparkline(plan, "#e8b64a", 44)}<div class="spk-over">${UI.sparkline(s.energy, "#f4f4f2", 44)}</div></div></div></div>`;
}

/* ---- the panel ---- */
function smartPanelHtml() {
  const c = smartCfg(), allGenres = [...new Set(state.library.map((x) => x.genre.primary))].sort(), pool = smartPool(c);
  const avail = SmartBuild.availableSec(pool.map(trackToEngineShape), estOverlap);
  const rbPls = state.rb.sources.flatMap((s) => RekordboxImport.flattenPlaylists(s.tree).map((p) => ({ sid: s.id, nid: p.id, name: s.name + " / " + p.name })));
  const folders = LibraryTools.groupFolders(state.library, state.imports).filter((g) => g.name != null);
  const srcKey = (s) => s.type === "folder" ? "folder:" + s.folder : s.type === "batch" ? "batch:" + s.id : s.type === "rbplaylist" ? "rb:" + s.sid + "|" + s.nid : s.type === "ids" ? "ids" : s.type;
  const cur = srcKey(c.source);
  const keyChip = (code) => `<button class="chip kchip ${c.keys.includes(code) ? "on" : ""}" data-smkey="${code}" style="${c.keys.includes(code) ? "" : "border-color:" + (UI.keyColor(code) || "var(--border)")}">${code}</button>`;
  const num = (v) => (v == null ? "" : v);
  return `<div class="smartpanel" id="smartPanel"><div class="panel-head"><h2>${t("smart.title")}${UI.help("smart")}</h2><span class="mono dim">${t("smart.poolInfo", { n: pool.length, d: fmtClock(avail) })}</span></div>
    <div class="controls">
      <div><span class="lab">${t("smart.duration")}, ${t("unit.min")}</span>${UI.seg([...SMART_DURATIONS.map((m) => [m, String(m)]), ["custom", t("smart.custom")]], c.custom ? "custom" : c.durationMin, "data-smdur")}${c.custom ? `<input type="number" id="smCustom" min="10" max="360" value="${c.durationMin}" style="width:90px;margin-top:6px">` : ""}</div>
      <div><span class="lab">${t("smart.tolerance")}${UI.help("tolerance")}</span>${UI.seg(SMART_TOLERANCES.map((m) => [m, "±" + m]), c.toleranceMin, "data-smtol")}</div>
      <div><span class="lab">${t("smart.pref")}${UI.help("pref")}</span>${UI.seg([["smooth", t("smart.pref.smooth")], ["balanced", t("smart.pref.balanced")], ["creative", t("smart.pref.creative")]], c.pref, "data-smpref")}</div>
    </div>
    <div class="controls">
      <label class="lab">${t("smart.source")}<select id="smSource"><option value="library" ${cur === "library" ? "selected" : ""}>${t("smart.src.library")}</option><option value="crate" ${cur === "crate" ? "selected" : ""}>${t("smart.src.crate")} (${state.crate.length})</option><option value="recent" ${cur === "recent" ? "selected" : ""}>${t("smart.src.recent")}</option>
        ${folders.length ? `<optgroup label="${t("smart.src.folder")}">${folders.map((g) => `<option value="folder:${UI.esc(g.name)}" ${cur === "folder:" + g.name ? "selected" : ""}>${UI.esc(g.name)} (${g.count})</option>`).join("")}</optgroup>` : ""}
        ${rbPls.length ? `<optgroup label="${t("smart.src.rekordbox")}">${rbPls.map((p) => `<option value="rb:${UI.esc(p.sid)}|${UI.esc(p.nid)}" ${cur === "rb:" + p.sid + "|" + p.nid ? "selected" : ""}>${UI.esc(p.name)}</option>`).join("")}</optgroup>` : ""}
        ${state.imports.length ? `<optgroup label="${t("smart.src.batch")}">${state.imports.slice(0, 30).map((b) => `<option value="batch:${b.id}" ${cur === "batch:" + b.id ? "selected" : ""}>${UI.esc(batchName(b))} · ${new Date(b.at).toLocaleDateString(LANG === "ru" ? "ru-RU" : "en-GB")}</option>`).join("")}</optgroup>` : ""}
        ${c.source.type === "ids" ? `<option value="ids" selected>${t("smart.src.ids", { n: c.source.ids.length })}${c.source.label ? " · " + UI.esc(c.source.label) : ""}</option>` : ""}</select></label>
      <label class="lab">${t("smart.dateAdded")}<select id="smDate"><option value="">${t("smart.anyDate")}</option>${LibraryTools.PRESETS.map((p) => `<option value="${p}" ${c.datePreset === p ? "selected" : ""}>${t("hist.p." + p)}</option>`).join("")}</select></label>
      ${c.datePreset === "custom" ? `<label class="lab">${t("smart.from")}<input type="date" id="smFrom" value="${toDateInput(c.dateFrom)}"></label><label class="lab">${t("smart.to")}<input type="date" id="smTo" value="${toDateInput(c.dateTo)}"></label>` : ""}
      <label class="lab">BPM ${t("lib.min")}<input type="number" id="smBpmMin" value="${num(c.bpmMin)}"></label><label class="lab">BPM ${t("lib.max")}<input type="number" id="smBpmMax" value="${num(c.bpmMax)}"></label>
      <label class="lab">${t("metric.energy")} ${t("lib.min")}<input type="number" id="smEnMin" min="0" max="100" value="${num(c.energyMin)}"></label><label class="lab">${t("metric.energy")} ${t("lib.max")}<input type="number" id="smEnMax" min="0" max="100" value="${num(c.energyMax)}"></label>
    </div>
    <div class="smartrow"><span class="label">${t("lib.genre")}</span><div class="tagrow">${allGenres.map((g) => `<button class="chip ${c.genres.includes(g) ? "on" : ""}" data-smgenre="${UI.esc(g)}">${UI.esc(g)}</button>`).join("") || `<span class="faint">${t("smart.noGenres")}</span>`}</div></div>
    <div class="smartrow"><span class="label">${t("smart.camelot")}${UI.help("camelot")}</span><input id="smKeys" placeholder="4A-7A, 9B" value="${UI.esc(c.keys.length ? c.keys.slice().sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b)).join(", ") : "")}" style="max-width:340px">
      <div class="tagrow" style="margin-top:6px">${Array.from({ length: 12 }, (_, i) => keyChip(i + 1 + "A")).join("")}</div><div class="tagrow" style="margin-top:4px">${Array.from({ length: 12 }, (_, i) => keyChip(i + 1 + "B")).join("")}</div></div>
    ${smartInsufficient ? smartInsufficientHtml() : ""}
    <div class="toolbar" style="margin-top:14px"><button class="btn primary" id="smBuild" ${smartBusy ? "disabled" : ""}>${UI.icon("bolt")}${t("smart.build")}</button>
      <button class="btn" id="smRegen" ${state.currentSet.trackIds.length > 2 ? "" : "disabled"} data-tip="${UI.esc(t("smart.regenTip"))}">${t("smart.regen")}</button><button class="linkbtn" id="smReset">${t("lib.reset")}</button></div></div>`;
}
function smartInsufficientHtml() {
  const i = smartInsufficient;
  return `<div class="warnbox" style="margin-top:14px"><b>${t("smart.insufficient", { n: i.matched })}</b><div class="mono" style="margin-top:6px">${t("smart.availableDur")}: ${fmtClock(i.availableSec)} · ${t("smart.requestedDur")}: ${fmtClock(i.targetSec)}</div>
    ${i.suggestions.length ? `<div class="label" style="margin:10px 0 6px">${t("smart.suggest")}</div>${i.suggestions.map((s, k) => `<div class="rbline" style="padding:6px 0"><div>${UI.esc(s.label)}${s.n != null ? ` <span class="mono dim">→ ${t("smart.tracksN", { n: s.n })} · ${fmtClock(s.sec)}${s.enough ? " ✓" : ""}</span>` : ""}</div><button class="btn sm" data-smsugg="${k}">${t("smart.apply")}</button></div>`).join("")}` : ""}
    <div class="toolbar" style="margin-top:8px"><button class="btn sm" id="smAnyway">${t("smart.buildAnyway")}</button></div></div>`;
}

/* ---- events ---- */
document.addEventListener("click", (e) => {
  if (!e.target.closest("#sbRoot")) return;
  const c = () => smartCfg(), sv = () => { persistCurrentSet(); smartInsufficient = null; renderActiveView(); };
  const d = e.target.closest("[data-smdur]"); if (d) { const v = d.dataset.smdur; if (v === "custom") c().custom = true; else { c().custom = false; c().durationMin = +v; } sv(); return; }
  const tl = e.target.closest("[data-smtol]"); if (tl) { c().toleranceMin = +tl.dataset.smtol; sv(); return; }
  const pf = e.target.closest("[data-smpref]"); if (pf) { c().pref = pf.dataset.smpref; sv(); return; }
  const g = e.target.closest("[data-smgenre]"); if (g) { const a = c().genres, v = g.dataset.smgenre; a.includes(v) ? a.splice(a.indexOf(v), 1) : a.push(v); sv(); return; }
  const k = e.target.closest("[data-smkey]"); if (k) { const a = c().keys, v = k.dataset.smkey; a.includes(v) ? a.splice(a.indexOf(v), 1) : a.push(v); sv(); return; }
  if (e.target.closest("#smBuild")) { smartRun(); return; }
  if (e.target.closest("#smAnyway")) { smartRun({ allowShort: true }); return; }
  if (e.target.closest("#smRegen")) { smartRegenerate(); return; }
  if (e.target.closest("#smReset")) { state.currentSet.smart = smartDefaults(); sv(); return; }
  const sg = e.target.closest("[data-smsugg]"); if (sg && smartInsufficient) { Object.assign(c(), smartInsufficient.suggestions[+sg.dataset.smsugg].patch); persistCurrentSet(); smartInsufficient = null; smartRun(); return; }
});
document.addEventListener("change", (e) => {
  if (!e.target.closest || !e.target.closest("#smartPanel")) return;
  const c = smartCfg(), n = (id) => { const v = parseFloat(document.getElementById(id).value); return isFinite(v) ? v : null; };
  if (e.target.id === "smSource") { const v = e.target.value; c.source = v === "library" || v === "crate" || v === "recent" ? { type: v } : v.startsWith("folder:") ? { type: "folder", folder: v.slice(7) } : v.startsWith("batch:") ? { type: "batch", id: v.slice(6) } : v.startsWith("rb:") ? { type: "rbplaylist", sid: v.slice(3).split("|")[0], nid: v.slice(3).split("|").slice(1).join("|") } : c.source; }
  else if (e.target.id === "smDate") c.datePreset = e.target.value;
  else if (e.target.id === "smFrom" || e.target.id === "smTo") c[e.target.id === "smFrom" ? "dateFrom" : "dateTo"] = e.target.value ? new Date(e.target.value + "T00:00:00").getTime() : null;
  else if (e.target.id === "smKeys") c.keys = [...LibraryTools.parseCamelot(e.target.value)];
  else if (e.target.id === "smCustom") c.durationMin = Math.max(10, Math.min(360, Math.round(n("smCustom") || 60)));
  else { c.bpmMin = n("smBpmMin"); c.bpmMax = n("smBpmMax"); c.energyMin = n("smEnMin"); c.energyMax = n("smEnMax"); }
  persistCurrentSet(); smartInsufficient = null; renderActiveView();
});
