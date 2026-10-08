/* =================== Set Builder =================== */
const SB_LENGTHS = [30, 45, 60, 90, 120];
const ROLES = ["opener", "warmup", "builder", "peak", "release", "closer"];
const expandedLinks = new Set();
let sbPickerQuery = "", sbNote = "";   // sbNote: "N transitions recalculated" after the last edit

const cur = () => state.currentSet;
function setTracks() { return cur().trackIds.map(findTrack).filter(Boolean); }
const shapes = (tracks) => tracks.map(trackToEngineShape);
function effectiveSeconds(tracks) { const S = shapes(tracks); return S.reduce((s, x, i) => s + x.durationSec - (i ? DjEngine.overlapSeconds(S[i - 1], x) : 0), 0); }
function saveSet() { persistCurrentSet(); }
// Auto mode: a track added to the set goes to the slot that costs the least compatibility (locked positions are kept)
function bestInsertIndex(id) {
  const ids = cur().trackIds, tracks = ids.map(findTrack).filter(Boolean), n = findTrack(id); if (!n || !tracks.length) return null;
  const S = shapes(tracks), N = trackToEngineShape(n), c = (a, b) => DjEngine.djCompat(a, b, state.weights.dj, KEY_WEIGHTS).overall;
  let best = null, bv = -1;
  for (let i = 0; i <= S.length; i++) {
    const next = ids.slice(); next.splice(i, 0, id); if (!moveAllowed(ids, next) && cur().locked.length) continue;
    const l = i > 0 ? c(S[i - 1], N) : null, r = i < S.length ? c(N, S[i]) : null, lost = i > 0 && i < S.length ? c(S[i - 1], S[i]) : 0;
    const v = (l == null ? r : r == null ? l : (l + r) / 2) - (l != null && r != null ? lost * 0.25 : 0);
    if (v > bv) { bv = v; best = i; }
  }
  return best;
}

/* ---- roles: manual choice wins, otherwise a suggestion from position + energy (shown dimmed) ---- */
function autoRole(i, n, tr, next) {
  if (n < 2) return null; if (i === 0) return "opener"; if (i === n - 1) return "closer";
  const e = tr.profile.energy, pos = i / (n - 1);
  if (pos < 0.25) return "warmup"; if (e >= 78) return "peak"; if (next && next.profile.energy > e + 4) return "builder"; return pos > 0.6 ? "release" : "builder";
}
const roleOf = (tr, i, tracks) => { const m = cur().roles[tr.id]; return m ? { role: m, manual: true } : { role: autoRole(i, tracks.length, tr, tracks[i + 1]), manual: false }; };

/* ---- locks: a locked track keeps its position; a move that would shift it is refused ---- */
const isLocked = (id) => cur().locked.includes(id);
function moveAllowed(prev, next) {
  const bad = cur().locked.find((id) => prev.indexOf(id) !== next.indexOf(id));
  return bad ? null : true;
}
function applyOrder(next, noteKey) {
  const prev = cur().trackIds;
  if (!moveAllowed(prev, next)) { toast(t("sb.lockedBlocks")); return false; }
  const changed = SetTools.affectedPairs(prev, next);
  cur().trackIds = next; saveSet();
  sbNote = t("sb.recalc", { n: changed.length, total: Math.max(0, next.length - 1) });
  renderActiveView(); return true;
}

/* ---- curve ---- */
function curveSvg(tracks) {
  const pts = cur().build.pts, W = 800, H = 150, px = 28, py = 14, n = pts.length;
  const X = (i, m) => px + (i / Math.max(1, m - 1)) * (W - 2 * px), Y = (v) => H - py - (v / 100) * (H - 2 * py);
  const plan = pts.map((v, i) => `${X(i, n)},${Y(v)}`).join(" "), actual = tracks.map((x, i) => `${X(i, tracks.length)},${Y(x.profile.energy)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" id="curveSvg" role="img" aria-label="${UI.esc(t("sb.curveAria"))}">
    ${[0, 50, 100].map((v) => `<line x1="${px}" x2="${W - px}" y1="${Y(v)}" y2="${Y(v)}" stroke="#1d1d1d"/><text x="2" y="${Y(v) + 3}" fill="#6b6b68" font-size="9" font-family="ui-monospace,monospace">${v}</text>`).join("")}
    <polyline points="${plan}" fill="none" stroke="#e8b64a" stroke-width="1.4" stroke-dasharray="4 3"/>
    ${tracks.length > 1 ? `<polyline points="${actual}" fill="none" stroke="#f4f4f2" stroke-width="1.4"/>` : ""}
    ${tracks.map((x, i) => `<circle cx="${X(i, tracks.length)}" cy="${Y(x.profile.energy)}" r="2.6" fill="#f4f4f2"/>`).join("")}
    ${pts.map((v, i) => `<g class="pt" data-pt="${i}" tabindex="0" role="slider" aria-label="${UI.esc(t("sb.curvePoint", { n: i + 1 }))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}"><circle cx="${X(i, n)}" cy="${Y(v)}" r="12" fill="transparent"/><circle cx="${X(i, n)}" cy="${Y(v)}" r="4.4" fill="#060606" stroke="#e8b64a" stroke-width="1.6"/></g>`).join("")}</svg>`;
}

/* ---- the view ---- */
function renderSetBuilderView(root) {
  const tracks = setTracks(), S = shapes(tracks), b = cur().build;
  if (tracks.length !== cur().trackIds.length) { cur().trackIds = tracks.map((x) => x.id); saveSet(); }
  const before = guideCache.computations;
  const trans = tracks.slice(0, -1).map((x, i) => transitionOf(x, tracks[i + 1]));
  const analysis = tracks.length > 1 ? SetTools.analyzeSet(S, trans.map((x) => x.compat), { curvePts: b.pts, similarities: tracks.slice(1).map((x, i) => { const so = sonicScore(tracks[i], x); return so ? so.overall : computeSimilarity(S[i], S[i + 1], state.weights.sim, KEY_WEIGHTS).overall; }) }) : null;
  if (guideCache.computations !== before && !sbNote) sbNote = t("sb.recalc", { n: guideCache.computations - before, total: Math.max(0, tracks.length - 1) });
  const curves = Object.entries(DjEngine.CURVES);
  const gridNote = gridBusy() ? t("sb.gridProgress", { n: Math.min(gridJobs.done + 1, gridJobs.total), total: gridJobs.total }) : "";
  root.innerHTML = `<div class="sb" id="sbRoot"><div class="col">${cratePanel()}${nextPanel(tracks)}</div><div class="col">
    <section class="panel"><div class="hd"><div><h1>${t("sb.title")}</h1><div class="mono dim" style="margin-top:6px">${UI.esc(cur().name)}${cur().id ? "" : " · " + t("sb.unsaved")}</div></div>
      <div class="toolbar"><button class="btn" id="sbRename">${t("common.rename")}</button><button class="btn" id="sbNew">${t("sb.newSet")}</button><button class="btn primary" id="sbSave">${t("sb.save")}</button><button class="btn" id="sbExport" ${tracks.length ? "" : "disabled"}>${UI.icon("download")}${t("sb.export")}</button></div></div>
      <div class="controls" style="margin-top:20px">
        <div><span class="lab">${t("sb.length")}, ${t("unit.min")}</span>${UI.seg(SB_LENGTHS.map((m) => [m, String(m)]), b.length, "data-blen")}</div>
        <div><span class="lab">${t("sb.curve")}${UI.help("curve")}</span><select id="sbCurve">${curves.map(([k]) => `<option value="${k}" ${b.curve === k ? "selected" : ""}>${t("curve." + k)}</option>`).join("")}<option value="custom" ${b.curve === "custom" ? "selected" : ""}>${t("curve.custom")}</option></select></div>
        <div><span class="lab">${t("sb.mode")}${UI.help("mode")}</span>${UI.seg([["auto", t("sb.modeAuto")], ["manual", t("sb.modeManual")]], b.mode, "data-bmode")}</div>
        <div><span class="lab">${t("sb.character")}${UI.help("character")}</span>${UI.seg([["safe", t("sb.charSafe")], ["balanced", t("sb.charBalanced")], ["contrast", t("sb.charContrast")]], b.character || "balanced", "data-bchar")}</div>
        <div class="buildrow"><button class="btn primary" id="sbBuild">${t("sb.build")}</button><button class="btn" id="sbReroll" data-tip="${UI.esc(t("sb.rerollTip"))}">${t("sb.reroll")}</button>
          <button class="btn" id="sbOptimize" ${tracks.length > 2 ? "" : "disabled"} data-tip="${UI.esc(t("sb.optimizeTip"))}">${UI.icon("bolt")}${t("sb.optimize")}</button></div></div>
      <label style="display:flex;gap:8px;align-items:center;font-size:12px;color:var(--text-2);margin-bottom:12px"><input type="checkbox" id="sbKeep" ${b.keepFirst ? "checked" : ""} style="width:auto"> ${t("sb.keepFirst")}</label>
      <div class="curvebox"><div style="display:flex;justify-content:space-between;margin-bottom:6px;gap:12px;flex-wrap:wrap"><span class="label">${t("sb.energyLegend")}</span><span class="mono faint">${t("sb.dragPoints")}</span></div>${curveSvg(tracks)}</div>
      ${tracks.length ? setStatsHtml(tracks, analysis) : ""}</section>
    <section class="panel"><div class="panel-head"><h2>${t("sb.sequence")}</h2><span class="mono faint" id="sbNote" aria-live="polite">${UI.esc(gridNote || sbNote)}</span></div>
      ${tracks.length ? `${seqHeader()}<div class="seq" id="seq" role="list" aria-label="${UI.esc(t("sb.sequence"))}">${tracks.map((x, i) => nodeHtml(x, i, tracks) + (i < tracks.length - 1 ? linkHtml(x, tracks[i + 1], trans[i], i) : "")).join("")}</div>` : `<div class="empty"><b>${t("sb.emptyTitle")}</b>${t("sb.emptyText")}</div>`}</section></div></div>`;
  sbNote = "";
  if (tracks.length > 1) prepareSetGrids();   // measure the missing bar grids in the background
}
function setStatsHtml(tracks, an) {
  const bpms = tracks.map((x) => x.bpm), sc = an && an.score;
  const comp = sc ? Object.entries(sc.components).map(([k, v]) => `<div><div class="l"><span>${t("score.comp." + k)}</span><span class="num">${Math.round(v)}</span></div>${UI.bar(v, UI.barTone(v))}</div>`).join("") : "";
  const pv = (x) => (x.code === "flatEnergy" ? { a: x.from + 1, b: x.to + 1 } : x.code === "tempoJump" ? { a: Math.round(x.from), b: Math.round(x.to) } : {});
  const list = (arr, cls) => arr.map((x) => `<li class="${cls}">${UI.esc(t("setscore." + x.code, { n: x.index != null ? x.index + 1 : "", m: x.index != null ? x.index + 2 : "", s: x.score, ...pv(x) }))}</li>`).join("");
  return `<div class="setstats">
      <div class="stat"><div class="k">${t("sb.tracks")}</div><div class="v">${tracks.length}</div></div>
      <div class="stat"><div class="k">${t("sb.duration")}${UI.help("duration")}</div><div class="v">${fmtDur(an ? an.durationSec : effectiveSeconds(tracks))}</div></div>
      <div class="stat"><div class="k">${t("sb.bpmRange")}</div><div class="v">${Math.min(...bpms).toFixed(0)}–${Math.max(...bpms).toFixed(0)}</div></div>
      <div class="stat"><div class="k">${t("sb.avgTransition")}</div><div class="v">${an && an.avgTransition != null ? Math.round(an.avgTransition) + "%" : UI.NA}</div></div></div>
    ${sc ? `<div class="scorebox"><div><div class="label">${t("setscore.title")}${UI.help("setscore")}</div><div class="big ${UI.tone(sc.total)} num">${sc.total}</div><span class="badge ${sc.confidence}" style="margin-top:8px">${t("conf." + sc.confidence)}</span></div>
      <div><div class="comps">${comp}</div><ul style="margin-top:12px">${list(sc.strengths, "")}${list(sc.attention.slice(0, 6), "att")}</ul>
      ${an.genres.length ? `<div class="mono faint" style="margin-top:10px">${an.genres.slice(0, 4).map((g) => UI.esc(g.genre) + " " + g.pct + "%").join(" · ")}</div>` : ""}</div></div>` : tracks.length < 2 ? `<div class="mono faint" style="margin-bottom:12px">${t("setscore.needTwo")}</div>` : ""}`;
}
function nodeHtml(tr, i, tracks) {
  const { role, manual } = roleOf(tr, i, tracks), lk = isLocked(tr.id), playing = player.id === tr.id && !player.audio.paused;
  return `<div class="node ${lk ? "locked" : ""}" role="listitem" data-idx="${i}" data-id="${tr.id}">
    <button class="handle" data-handle="${i}" aria-label="${UI.esc(t("sb.dragHandle", { name: tr.title }))}" data-tip="${UI.esc(t("sb.dragTip"))}">${UI.icon("grip")}</button>
    <span class="idx">${i + 1}</span>
    <div class="who"><span class="artplay">${UI.art(tr, "xs")}<button class="ov ${playing ? "on" : ""}" data-simplay="${tr.id}" aria-label="${UI.esc(t("player.play"))}">${UI.icon("play")}</button></span>
      <div class="nm" data-open-track="${tr.id}" style="cursor:pointer"><div class="t1">${UI.esc(tr.title)}</div><div class="t2">${UI.esc(dispArtist(tr))}</div></div></div>
    <span class="c num">${tr.bpm.toFixed(0)}</span><span class="c">${UI.keyBadge(tr.key.camelot)}</span><span class="c num">${Math.round(tr.profile.energy)}</span><span class="c num dim">${fmtTime(tr.durationSec)}</span>
    <span class="c rolecell">${role ? `<button class="role" data-role="${tr.id}" style="${manual ? "color:var(--text);border-color:var(--border-strong)" : "opacity:.7"}" data-tip="${UI.esc(t(manual ? "sb.roleManual" : "sb.roleAuto"))}">${t("role." + role)}</button>` : ""}</span>
    <div class="tools"><button class="iconbtn ${lk ? "on" : ""}" data-lock="${tr.id}" aria-pressed="${lk}" aria-label="${UI.esc(t(lk ? "sb.unlock" : "sb.lock"))}" data-tip="${UI.esc(t(lk ? "sb.unlock" : "sb.lockTip"))}">${UI.icon(lk ? "lock" : "unlock")}</button>
      <button class="iconbtn" data-alt="${i}" aria-label="${UI.esc(t("sb.findAlt"))}" data-tip="${UI.esc(t("sb.findAlt"))}">${UI.icon("swap")}</button>
      <button class="iconbtn" data-nodemore="${i}" aria-label="${UI.esc(t("common.more"))}">${UI.icon("more")}</button></div></div>`;
}
// no bar grid yet: measured from the audio on demand (and automatically in the background)
function noGridPill(a, b, key) {
  const busy = gridState(a.id) !== "idle" || gridState(b.id) !== "idle", miss = [a, b].find((x) => !hasAudio(x));
  const inner = (title, sub) => `<span class="ti">${UI.icon("swap")}</span><span class="tmain"><b>${title}</b><span>${sub}</span></span>`;
  if (busy) return `<span class="tpill none run">${inner(t("sb.preparing"), t("sb.preparingSub"))}</span>`;
  if (miss) return `<button class="tpill none" data-attach="${miss.id}" data-tip="${UI.esc(t("sb.needAudioTip"))}">${inner(t("sb.needAudio"), UI.esc(miss.title))}</button>`;
  return `<button class="tpill none ready" data-prepare="${key}" data-tip="${UI.esc(t("sb.prepareTip"))}">${inner(t("sb.prepare"), t("sb.prepareSub"))}</button>`;
}
function seqHeader() { return `<div class="seqhead"><span></span><span>#</span><span>${t("col.track")}</span><span class="c">BPM</span><span class="c">${t("col.key")}</span><span class="c">${t("chip.energy")}</span><span class="c">${t("sb.time")}</span><span class="c rolecell">${t("sb.role")}</span><span></span></div>`; }
// the transition between two tracks: where to mix out of A, where to come in on B, how long, what kind — and a button to listen to it
function linkHtml(a, b, tr, i) {
  const key = a.id + "|" + b.id, open = expandedLinks.has(key), d = tr.compat, g = tr.guide, sec = (p) => (p && p.section ? secLabel(p.section) : null);
  const main = g && g.available
    ? `<button class="tpill ${g.difficulty.key}" data-guide="${key}" aria-label="${UI.esc(t("guide.open"))}">
        <span class="ti">${UI.icon("swap")}</span><span class="tmain"><b>${UI.esc(t("ttype." + g.type.key))}</b><span>${g.bars ? g.bars + " " + t("unit.bars") : t("guide.cut")} · ${t("diff." + g.difficulty.key)}</span></span>
        <span class="tpos"><span><i>${t("guide.mixOut")}</i> ${fmtTime(g.mixOut.time)}${sec(g.mixOut) ? " · " + UI.esc(sec(g.mixOut)) : ""}</span><span><i>${t("guide.mixIn")}</i> ${fmtTime(g.mixIn.time)}${sec(g.mixIn) ? " · " + UI.esc(sec(g.mixIn)) : ""}</span></span></button>
      <button class="btn sm" data-guide="${key}" data-autoplay="1">${UI.icon("play")}${t("sb.listen")}</button>
      ${g.estimated ? `<span class="badge medium" data-tip="${UI.esc(t("guide.estimatedTip"))}">${t("guide.estimated")}</span>` : ""}${g.manual ? `<span class="badge">${t("common.manual")}</span>` : ""}`
    : noGridPill(a, b, key);
  return `<div class="tblock"><div></div><div class="rail"></div><div class="body">${main}
    <button class="sc scoretag" data-toggle-link="${key}" aria-expanded="${open}" style="background:none;border:none;color:inherit"><b class="${UI.tone(d.overall)} num">${UI.pct(d.overall)}</b><span>${t("score.djShort")}</span></button>
    ${confidenceBadge(d.confidence)}
    <span class="mono dim">${a.bpm.toFixed(0)} → ${b.bpm.toFixed(0)} BPM</span>${UI.keyBadge(a.key.camelot)}<span class="dim">→</span>${UI.keyBadge(b.key.camelot)}
    <button class="linkbtn" data-bridge="${i}">${t("sb.findBridge")}</button>
    ${open ? `<div style="flex-basis:100%">${djBreakdown(d)}<ul class="why">${d.notes.map((n) => `<li class="${n.level}">${UI.esc(noteText(n))}</li>`).join("")}</ul></div>` : ""}</div></div>`;
}

/* ---- left column: crate + what to play next ---- */
function cratePanel() {
  const inSet = new Set(cur().trackIds), crate = state.crate.map(findTrack).filter(Boolean);
  const pool = state.library.filter((x) => !state.crate.includes(x.id) && passFilters(x) && (!sbPickerQuery || (x.title + " " + x.artist).toLowerCase().includes(sbPickerQuery.toLowerCase()))).slice(0, 40);
  const row = (x, right) => `<div class="crate-row"><span class="artplay">${UI.art(x, "xs")}<button class="ov" data-simplay="${x.id}" aria-label="${UI.esc(t("player.play"))}">${UI.icon("play")}</button></span><div class="nm" style="min-width:0"><div class="t1" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600">${UI.esc(x.title)}</div><div class="t2 dim" style="font-size:12px">${UI.esc(dispArtist(x))} · ${x.bpm.toFixed(0)} · ${UI.esc(x.key.camelot)}</div></div>${right}</div>`;
  return `<section class="panel"><div class="panel-head"><h2>${t("crate.title")}${UI.help("crate")}</h2><span class="mono dim">${crate.length}</span></div>
    <div class="crate-list" style="max-height:34vh">${crate.length ? crate.map((x) => row(x, `<div class="btns"><button class="btn sm" data-addset="${x.id}" ${inSet.has(x.id) ? "disabled" : ""}>${inSet.has(x.id) ? UI.icon("check") : UI.icon("plus")}</button><button class="iconbtn" data-crate-rm="${x.id}" aria-label="${UI.esc(t("common.remove"))}">${UI.icon("close")}</button></div>`)).join("") : `<div class="empty" style="padding:16px 0">${t("crate.empty")}</div>`}</div>
    <div class="toolbar" style="margin:12px 0"><button class="btn sm" id="crateAddAll" ${state.library.length ? "" : "disabled"}>${t("crate.addFiltered")}</button>${crate.length ? `<button class="btn sm" id="crateToSet">${t("crate.toSet")}</button><button class="linkbtn" id="crateClear" style="margin-left:auto">${t("common.clear")}</button>` : ""}</div>
    ${UI.sectionHead(t("crate.library"), pool.length)}<input type="search" id="pickerSearch" placeholder="${UI.esc(t("lib.searchPh"))}" value="${UI.esc(sbPickerQuery)}" style="margin-bottom:8px">
    <div class="crate-list">${pool.map((x) => row(x, `<div class="btns"><button class="iconbtn" data-crate-add="${x.id}" aria-label="${UI.esc(t("add.crate"))}" data-tip="${UI.esc(t("add.crate"))}">${UI.icon("plus")}</button><button class="iconbtn" data-addset="${x.id}" aria-label="${UI.esc(t("add.currentSet"))}" data-tip="${UI.esc(t("add.currentSet"))}">${UI.icon("arrow")}</button></div>`)).join("") || `<div class="empty" style="padding:16px 0">${t("crate.nothing")}</div>`}</div></section>`;
}
function nextRows(last) {
  const inSet = new Set(cur().trackIds), fromCrate = state.crate.map(findTrack).filter((x) => x && !inSet.has(x.id)), pool = fromCrate.length ? fromCrate : state.library.filter((x) => !inSet.has(x.id));
  if (!pool.length || !last) return [];
  const sonic = (a, b) => { const p = sonicPair(findTrack(a.id), findTrack(b.id)); return p ? p.ui : null; };
  return SetTools.nextCandidates(trackToEngineShape(last), shapes(pool), state.next.mode, { djWeights: state.weights.dj, keyWeights: KEY_WEIGHTS, sonic, seed: cur().build.seed });
}
function nextPanel(tracks) {
  const last = tracks[tracks.length - 1];
  if (!last) return `<section class="panel"><div class="panel-head"><h2>${t("next.title")}</h2></div><div class="empty" style="padding:16px 0">${t("next.empty")}</div></section>`;
  const rows = nextRows(last).slice(0, 6);
  return `<section class="panel"><div class="panel-head"><h2>${t("next.title")}${UI.help("next")}</h2><span class="mono dim">${t("next.after", { name: UI.esc(last.title.slice(0, 18)) })}</span></div>
    <div class="tagrow" style="margin-bottom:12px">${SetTools.NEXT_MODES.map((m) => `<button class="chip ${state.next.mode === m ? "on" : ""}" data-nextmode="${m}" data-tip="${UI.esc(t("next." + m + ".tip"))}">${t("next." + m)}</button>`).join("")}</div>
    <div class="sim-list">${rows.length ? rows.map((r) => `<div class="sim-row" data-open-track="${r.track.id}" style="grid-template-columns:36px minmax(0,1fr) auto 28px"><span class="artplay">${UI.art(r.track, "xs")}<button class="ov" data-simplay="${r.track.id}" aria-label="${UI.esc(t("player.play"))}">${UI.icon("play")}</button></span>
      <div class="nm"><div class="t1">${UI.esc(r.track.title)}</div><div class="t2">${UI.esc(dispArtist(r.track))}</div>${mchips(findTrack(r.track.id))}</div>
      <div class="score" data-tip="${UI.esc(t("next.scoreTip", { dj: Math.round(r.dj.overall), d: (r.energyDelta >= 0 ? "+" : "") + r.energyDelta }))}"><b class="${UI.tone(r.score)} num">${Math.round(r.score)}%</b><div class="mono dim" style="font-size:10px">${t("score.djShort")} ${UI.pct(r.dj.overall)}</div></div>
      <button class="iconbtn" data-addset="${r.track.id}" aria-label="${UI.esc(t("add.currentSet"))}">${UI.icon("plus")}</button></div>`).join("") : `<div class="empty" style="padding:16px 0">${t("next.none")}</div>`}</div></section>`;
}

/* ---- pointer drag & drop (mouse + touch) and keyboard reordering ---- */
(function () {
  let drag = null;
  document.addEventListener("pointerdown", (e) => {
    const h = e.target.closest && e.target.closest("[data-handle]"); if (h && e.button === 0) {
      const seq = document.getElementById("seq"); if (!seq) return;
      e.preventDefault(); try { h.setPointerCapture(e.pointerId); } catch (er) {}
      drag = { from: +h.dataset.handle, over: +h.dataset.handle, nodes: [...seq.querySelectorAll(".node")] };
      drag.nodes[drag.from].classList.add("dragging"); document.body.style.userSelect = "none"; return;
    }
    const g = e.target.closest && e.target.closest("[data-pt]"); if (g) { drag = { pt: +g.dataset.pt, svg: g.ownerSVGElement }; e.preventDefault(); }
  });
  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (drag.pt != null) {
      const r = drag.svg.getBoundingClientRect(), H = 150, py = 14, y = ((e.clientY - r.top) / r.height) * H, b = cur().build;
      b.pts[drag.pt] = Math.max(0, Math.min(100, Math.round(((H - py - y) / (H - 2 * py)) * 100))); b.curve = "custom";
      document.getElementById("curveSvg").outerHTML = curveSvg(setTracks()); drag.svg = document.getElementById("curveSvg"); return;
    }
    let over = drag.nodes.findIndex((n) => { const r = n.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (over < 0) over = drag.nodes.length - 1; else if (over > drag.from) over--;
    if (over !== drag.over) { drag.nodes.forEach((n) => n.classList.remove("over")); drag.nodes[over].classList.add("over"); drag.over = over; }
  });
  const end = () => {
    if (!drag) return; const d = drag; drag = null; document.body.style.userSelect = "";
    if (d.pt != null) { saveSet(); renderActiveView(); return; }
    d.nodes.forEach((n) => n.classList.remove("dragging", "over"));
    if (d.over !== d.from) { const ids = cur().trackIds.slice(), [m] = ids.splice(d.from, 1); ids.splice(d.over, 0, m); applyOrder(ids); }
  };
  document.addEventListener("pointerup", end); document.addEventListener("pointercancel", end);
  // keyboard: focus the handle, ArrowUp / ArrowDown moves the track
  document.addEventListener("keydown", (e) => {
    const h = e.target.closest && e.target.closest("[data-handle]"); if (h && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault(); const i = +h.dataset.handle, j = i + (e.key === "ArrowUp" ? -1 : 1), ids = cur().trackIds.slice(); if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]]; if (applyOrder(ids)) { const nh = document.querySelector(`[data-handle="${j}"]`); if (nh) nh.focus(); }
    }
    const pt = e.target.closest && e.target.closest("[data-pt]"); if (pt && ["ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault(); const b = cur().build, i = +pt.dataset.pt; b.pts[i] = Math.max(0, Math.min(100, b.pts[i] + (e.key === "ArrowUp" ? 5 : -5))); b.curve = "custom"; saveSet(); renderActiveView();
      const np = document.querySelector(`[data-pt="${i}"]`); if (np) np.focus();
    }
  });
})();

/* ---- build / optimize ---- */
function poolTracks() {
  const base = state.crate.length ? state.crate.map(findTrack).filter(Boolean) : state.library.filter((x) => passFilters(x));
  return base;
}
async function buildSetNow(reroll) {
  const pool = poolTracks();
  if (pool.length < 4) { toast(t("sb.needFour")); return; }
  const b = cur().build; if (reroll) b.seed++;
  await ensureSonic();
  const lockedIds = cur().locked.filter((id) => cur().trackIds.includes(id)), prevIds = cur().trackIds.slice();
  const lockedDur = lockedIds.reduce((s, id) => s + (findTrack(id) ? findTrack(id).durationSec : 0), 0) / 60;
  const startLocked = lockedIds.includes(prevIds[0]) ? prevIds[0] : null;
  const keep = startLocked || (b.keepFirst && prevIds.length ? prevIds[0] : null);
  const sonic = (a, c) => { const p = sonicPair(findTrack(a.id), findTrack(c.id)); return p ? p.ui : null; };
  const free = shapes(pool.filter((x) => !lockedIds.includes(x.id) || x.id === keep));
  const r = DjEngine.buildSet({ tracks: free, targetMinutes: Math.max(10, b.length - lockedDur * 0.8), curve: b.pts, startId: keep, seed: b.seed, sonic, mode: b.character || "balanced", djWeights: state.weights.dj });
  if (!r.ids.length) { toast(t("sb.notEnough")); return; }
  // locked tracks keep their old positions; the generated ones fill the remaining slots in order
  let rest = r.ids.filter((id) => !lockedIds.includes(id) || id === keep), out = [];
  const total = rest.length + lockedIds.filter((id) => id !== keep).length;
  for (let i = 0; i < total; i++) { const lid = lockedIds.find((id) => id !== keep && prevIds.indexOf(id) === i); out.push(lid || rest.shift()); }
  out = out.concat(rest).filter(Boolean);
  const changed = SetTools.affectedPairs(prevIds, out);
  cur().trackIds = out; saveSet();
  sbNote = t("sb.recalc", { n: changed.length, total: out.length - 1 });
  toast(t("sb.built", { n: out.length, min: Math.round(r.effectiveSec / 60), dj: Math.round(r.avgDj) }));
  renderActiveView();
}
function optimizeNow() {
  const tracks = setTracks(); if (tracks.length < 3) return;
  const S = shapes(tracks), memo = new Map();
  const pair = (a, b) => { const k = a.id + "|" + b.id; if (!memo.has(k)) memo.set(k, DjEngine.djCompat(a, b, state.weights.dj, KEY_WEIGHTS).overall); return memo.get(k); };
  const before = S.slice(1).reduce((s, x, i) => s + pair(S[i], x), 0) / (S.length - 1);
  const r = SetTools.optimizeOrder(S, { lockedIds: new Set(cur().locked), pair, curvePts: cur().build.pts, seed: cur().build.seed });
  const after = r.order.slice(1).reduce((s, x, i) => s + pair(r.order[i], x), 0) / (r.order.length - 1);
  if (!r.improved) { toast(t("sb.optimizeNone")); return; }
  if (applyOrder(r.order.map((x) => x.id))) toast(t("sb.optimized", { a: Math.round(before), b: Math.round(after) }));
}

/* ---- find alternative: candidates are scored against BOTH neighbours ---- */
async function showAlternatives(idx) {
  const tracks = setTracks(), tr = tracks[idx]; if (!tr) return;
  await ensureSonic();
  const pool = (state.crate.length ? state.library.filter((x) => state.crate.includes(x.id) || true) : state.library).filter((x) => !cur().trackIds.includes(x.id));
  const sonic = (a, b) => { const p = sonicPair(findTrack(a.id), findTrack(b.id)); return p ? p.ui : null; };
  const rows = SetTools.findAlternatives(shapes(tracks), idx, shapes(pool), { curvePts: cur().build.pts, djWeights: state.weights.dj, keyWeights: KEY_WEIGHTS, sonic }).slice(0, 8);
  openModal(modalShell(t("alt.title"), `<p class="dim" style="font-size:12px;margin:0 0 12px">${t("alt.intro", { name: UI.esc(tr.title) })}${idx > 0 ? "" : " " + t("alt.noPrev")}${idx < tracks.length - 1 ? "" : " " + t("alt.noNext")}</p>
    ${rows.length ? rows.map((r) => { const o = findTrack(r.track.id); return `<div class="djrow" style="display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:12px;align-items:center"><span class="artplay">${UI.art(o, "xs")}<button class="ov" data-simplay="${o.id}" aria-label="${UI.esc(t("player.play"))}">${UI.icon("play")}</button></span>
      <div style="min-width:0"><div style="font-weight:600">${UI.esc(o.title)}</div><div class="dim" style="font-size:12px">${UI.esc(dispArtist(o))}</div>${mchips(o)}
        <div class="mono dim" style="font-size:11px;margin-top:6px">${r.prev ? "← " + Math.round(r.prev.overall) + "%" : ""}${r.prev && r.next ? " · " : ""}${r.next ? Math.round(r.next.overall) + "% →" : ""}${r.energyFit != null ? " · " + t("alt.energyFit") + " " + Math.round(r.energyFit) : ""}${r.sonicPrev != null || r.sonicNext != null ? " · " + t("score.sonicShort") + " " + [r.sonicPrev, r.sonicNext].filter((x) => x != null).map(Math.round).join("/") : ""}</div></div>
      <div style="display:flex;gap:12px;align-items:center"><b class="${UI.tone(r.score)} num" style="font-size:20px">${Math.round(r.score)}%</b><button class="btn sm" data-replace="${o.id}">${t("alt.replace")}</button></div></div>`; }).join("") : `<div class="empty">${t("alt.none")}</div>`}`));
  document.querySelectorAll("[data-replace]").forEach((bt) => bt.addEventListener("click", () => {
    const ids = cur().trackIds.slice(); const old = ids[idx]; ids[idx] = bt.dataset.replace;
    if (isLocked(old)) cur().locked = cur().locked.filter((x) => x !== old);
    delete cur().roles[old]; closeModal(); applyOrder(ids); toast(t("alt.replaced"));
  }));
}

/* ---- find a bridge: DJ compatibility with both neighbours + position between A and B in embedding space ---- */
async function showFindBridge(idx) {
  const ids = cur().trackIds, a = findTrack(ids[idx]), b = findTrack(ids[idx + 1]);
  const cands = state.library.filter((x) => x.id !== a.id && x.id !== b.id && !ids.includes(x.id));
  const between = new Map(), ia = sonicIdOf(a), ib = sonicIdOf(b);
  if (ia && ib) { const r = await BackendClient.sonicBridge(ia, ib, cands.map(sonicIdOf).filter(Boolean)); if (r.ok) r.result.results.forEach((x) => between.set(x.id, x)); await ensureSonic(); }
  const ranked = cands.map((c) => {
    const djA = transitionOf(a, c).compat, djB = transitionOf(c, b).compat, bw = between.get(sonicIdOf(c)), sA = sonicScore(a, c), sB = sonicScore(c, b);
    const score = bw && sA && sB ? SonicSimilarity.bridgeScore(djA.overall, djB.overall, sA.overall, sB.overall, bw.between) : (djA.overall + djB.overall) / 2;
    return { c, score, djA, djB, sA, sB, bw };
  }).sort((x, y) => y.score - x.score).slice(0, 8);
  openModal(modalShell(t("bridge.title"), `<p class="dim" style="font-size:12px;margin:0 0 12px">${t("bridge.intro", { a: UI.esc(a.title), b: UI.esc(b.title) })}${between.size ? " " + t("bridge.between") : ""}</p>
    ${ranked.length ? ranked.map((r) => `<div class="djrow" style="display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:12px;align-items:center"><span class="artplay">${UI.art(r.c, "xs")}<button class="ov" data-simplay="${r.c.id}" aria-label="${UI.esc(t("player.play"))}">${UI.icon("play")}</button></span>
      <div style="min-width:0"><div style="font-weight:600">${UI.esc(r.c.title)}</div><div class="dim" style="font-size:12px">${UI.esc(dispArtist(r.c))}</div>
      <div class="mono dim" style="font-size:11px">${t("score.djShort")} ← ${Math.round(r.djA.overall)}% · ${Math.round(r.djB.overall)}% →${r.sA && r.sB && r.bw ? ` · ${t("score.sonicShort")} ← ${Math.round(r.sA.overall)}% · ${Math.round(r.sB.overall)}% → · ${t("bridge.betweenPct", { n: Math.round(r.bw.between * 100) })}` : ""}</div></div>
      <div style="display:flex;gap:12px;align-items:center"><b class="${UI.tone(r.score)} num" style="font-size:20px">${Math.round(r.score)}%</b><button class="btn sm" data-insert="${r.c.id}">${t("bridge.insert")}</button></div></div>`).join("") : `<div class="empty">${t("bridge.none")}</div>`}`));
  document.querySelectorAll("[data-insert]").forEach((bt) => bt.addEventListener("click", () => { const n = cur().trackIds.slice(); n.splice(idx + 1, 0, bt.dataset.insert); closeModal(); applyOrder(n); toast(t("bridge.inserted")); }));
}

/* ---- sets: save / new ---- */
function saveCurrentSet() {
  if (!cur().trackIds.length) { toast(t("sb.empty")); return; }
  const ex = state.sets.find((s) => s.id === cur().id), copy = JSON.parse(JSON.stringify(cur()));
  if (ex) Object.assign(ex, copy, { updatedAt: Date.now() });
  else { cur().id = uid("s_"); copy.id = cur().id; copy.createdAt = copy.updatedAt = Date.now(); state.sets.push(copy); }
  persistSets(); saveSet(); toast(t("sb.saved", { name: cur().name })); renderActiveView();
}

/* ---- events ---- */
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#sbRoot")) return;
  const len = e.target.closest("[data-blen]"); if (len) { cur().build.length = +len.dataset.blen; saveSet(); renderActiveView(); return; }
  const md = e.target.closest("[data-bmode]"); if (md) { cur().build.mode = md.dataset.bmode; saveSet(); renderActiveView(); return; }
  const ch = e.target.closest("[data-bchar]"); if (ch) { cur().build.character = ch.dataset.bchar; saveSet(); renderActiveView(); return; }
  if (e.target.closest("#sbBuild")) { buildSetNow(false); return; }
  if (e.target.closest("#sbReroll")) { buildSetNow(true); return; }
  if (e.target.closest("#sbOptimize")) { optimizeNow(); return; }
  const tg = e.target.closest("[data-toggle-link]"); if (tg) { const k = tg.dataset.toggleLink; expandedLinks.has(k) ? expandedLinks.delete(k) : expandedLinks.add(k); renderActiveView(); return; }
  const pp = e.target.closest("[data-prepare]"); if (pp) { const [a, b] = pp.dataset.prepare.split("|"); gridJobs.skip.delete(a); gridJobs.skip.delete(b); prepareGrids([a, b]); renderActiveView(); return; }
  const at = e.target.closest("[data-attach]"); if (at) { attachAudioPicker(at.dataset.attach); return; }
  const lk = e.target.closest("[data-lock]"); if (lk) { const id = lk.dataset.lock; cur().locked = isLocked(id) ? cur().locked.filter((x) => x !== id) : [...cur().locked, id]; saveSet(); renderActiveView(); return; }
  const alt = e.target.closest("[data-alt]"); if (alt) { showAlternatives(+alt.dataset.alt); return; }
  const br = e.target.closest("[data-bridge]"); if (br) { showFindBridge(+br.dataset.bridge); return; }
  const rl = e.target.closest("[data-role]"); if (rl) { const id = rl.dataset.role; openMenu(rl, [{ label: t("role.auto"), run: () => { delete cur().roles[id]; saveSet(); renderActiveView(); } }, ...ROLES.map((r) => ({ label: t("role." + r), run: () => { cur().roles[id] = r; saveSet(); renderActiveView(); } }))]); return; }
  const nm = e.target.closest("[data-nodemore]"); if (nm) {
    const i = +nm.dataset.nodemore, id = cur().trackIds[i], n = cur().trackIds.length;
    openMenu(nm, [{ label: t("sb.moveUp"), disabled: i === 0, run: () => { const a = cur().trackIds.slice(); [a[i - 1], a[i]] = [a[i], a[i - 1]]; applyOrder(a); } }, { label: t("sb.moveDown"), disabled: i === n - 1, run: () => { const a = cur().trackIds.slice(); [a[i + 1], a[i]] = [a[i], a[i + 1]]; applyOrder(a); } },
      { label: t(i === 0 && isLocked(id) ? "sb.unlockFirst" : "sb.lockFirst"), disabled: i !== 0, run: () => { cur().locked = isLocked(id) ? cur().locked.filter((x) => x !== id) : [...cur().locked, id]; saveSet(); renderActiveView(); } },
      { label: t(i === n - 1 && isLocked(id) ? "sb.unlockLast" : "sb.lockLast"), disabled: i !== n - 1, run: () => { cur().locked = isLocked(id) ? cur().locked.filter((x) => x !== id) : [...cur().locked, id]; saveSet(); renderActiveView(); } },
      { label: t("add.crate"), run: () => addToCrate(id) }, { sep: true },
      { label: t("sb.removeFromSet"), run: () => { cur().locked = cur().locked.filter((x) => x !== id); delete cur().roles[id]; applyOrder(cur().trackIds.filter((x) => x !== id)); } }]);
    return;
  }
  const nx = e.target.closest("[data-nextmode]"); if (nx) { state.next.mode = nx.dataset.nextmode; renderActiveView(); return; }
  const ca = e.target.closest("[data-crate-add]"); if (ca) { addToCrate(ca.dataset.crateAdd); return; }
  const cr = e.target.closest("[data-crate-rm]"); if (cr) { state.crate = state.crate.filter((x) => x !== cr.dataset.crateRm); persistCrate(); renderActiveView(); return; }
  if (e.target.closest("#crateAddAll")) { addToCrate(state.library.filter((x) => passFilters(x) && !state.crate.includes(x.id)).map((x) => x.id)); return; }
  if (e.target.closest("#crateClear")) { state.crate = []; persistCrate(); renderActiveView(); return; }
  if (e.target.closest("#crateToSet")) { const ids = cur().trackIds.slice(); state.crate.forEach((id) => { if (!ids.includes(id)) ids.push(id); }); applyOrder(ids); return; }
  if (e.target.closest("#sbRename")) { const f = await openForm(t("set.name"), [{ name: "name", label: t("set.name"), value: cur().name }]); if (f && f.name.trim()) { cur().name = f.name.trim(); saveSet(); renderActiveView(); } return; }
  if (e.target.closest("#sbNew")) { if (cur().trackIds.length && !(await askConfirm(t("sb.newAsk"), t("sb.newSet"), false))) return; state.currentSet = newSet(); saveSet(); renderActiveView(); return; }
  if (e.target.closest("#sbSave")) { saveCurrentSet(); return; }
  if (e.target.closest("#sbExport")) { openExportDialog(); return; }
});
document.addEventListener("change", (e) => {
  if (!e.target.closest || !e.target.closest("#sbRoot")) return;
  if (e.target.id === "sbCurve") { const b = cur().build; b.curve = e.target.value; if (b.curve !== "custom") b.pts = DjEngine.CURVES[b.curve].pts.slice(); saveSet(); renderActiveView(); }
  if (e.target.id === "sbKeep") { cur().build.keepFirst = e.target.checked; saveSet(); }
});
document.addEventListener("input", (e) => {
  if (e.target.id !== "pickerSearch") return;
  sbPickerQuery = e.target.value; const pos = e.target.selectionStart; renderActiveView(); const n = document.getElementById("pickerSearch"); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
});
