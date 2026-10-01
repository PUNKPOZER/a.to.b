/* =================== Set Builder =================== */
const build = { length: 45, curve: "journey", pts: DjEngine.CURVES.journey.pts.slice(), mode: "balanced", seed: 1, keepFirst: true };
const expandedLinks = new Set();

function setTracks() { return state.currentSet.trackIds.map(findTrack).filter(Boolean); }
function effectiveSeconds(tracks) { return tracks.reduce((s, t, i) => s + t.durationSec - (i ? DjEngine.overlapSeconds(trackToEngineShape(tracks[i - 1]), trackToEngineShape(t)) : 0), 0); }
function linkInfo(a, b, idx, n) {
  // energy move the curve asks for between this pair (used so the "Energy" score follows the plan)
  const pts = build.pts, tA = DjEngine.curveAt(pts, idx / Math.max(1, n - 1)), tB = DjEngine.curveAt(pts, (idx + 1) / Math.max(1, n - 1));
  const A = trackToEngineShape(a), B = trackToEngineShape(b);
  return { dj: computeDjCompatibility(A, B, state.weights.dj, KEY_WEIGHTS), sonic: sonicScore(a, b), plan: tB - tA };
}

function curveSvg(tracks) {
  const W = 800, H = 150, px = 28, py = 14, pts = build.pts, n = pts.length;
  const X = (i, m) => px + (i / Math.max(1, m - 1)) * (W - 2 * px), Y = (v) => H - py - (v / 100) * (H - 2 * py);
  const plan = pts.map((v, i) => `${X(i, n)},${Y(v)}`).join(" ");
  const actual = tracks.map((t, i) => `${X(i, tracks.length)},${Y(t.profile.energy)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" id="curveSvg" role="img" aria-label="Energy curve: planned and actual">
    ${[0, 50, 100].map((v) => `<line x1="${px}" x2="${W - px}" y1="${Y(v)}" y2="${Y(v)}" stroke="#1b1c1c"/><text x="2" y="${Y(v) + 3}" fill="#5d5e5a" font-size="9" font-family="ui-monospace,monospace">${v}</text>`).join("")}
    <polyline points="${plan}" fill="none" stroke="#e8b64a" stroke-width="1.4" stroke-dasharray="4 3"/>
    ${tracks.length > 1 ? `<polyline points="${actual}" fill="none" stroke="#f1f0eb" stroke-width="1.4"/>` : ""}
    ${tracks.map((t, i) => `<circle cx="${X(i, tracks.length)}" cy="${Y(t.profile.energy)}" r="2.6" fill="#f1f0eb"/>`).join("")}
    ${pts.map((v, i) => `<g class="pt" data-pt="${i}"><circle cx="${X(i, n)}" cy="${Y(v)}" r="11" fill="transparent"/><circle cx="${X(i, n)}" cy="${Y(v)}" r="4.2" fill="#080909" stroke="#e8b64a" stroke-width="1.6"/></g>`).join("")}</svg>`;
}

function renderSetBuilderView() {
  const root = document.getElementById("setBuilderView"), tracks = setTracks();
  const eff = effectiveSeconds(tracks), bpms = tracks.map((t) => t.bpm);
  const links = tracks.slice(0, -1).map((t, i) => linkInfo(t, tracks[i + 1], i, tracks.length));
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null);
  const avgDj = avg(links.map((l) => l.dj.overall)), sonics = links.map((l) => l.sonic && l.sonic.overall).filter((x) => x != null), avgSonic = avg(sonics);
  const curves = Object.entries(DjEngine.CURVES);
  root.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:end;gap:var(--s5);flex-wrap:wrap;margin-bottom:var(--s4)">
      <div><h1 class="h2">Set Builder</h1><div class="mono dim" style="margin-top:6px">${UI.esc(state.currentSet.name)}</div></div>
      <div style="display:flex;gap:var(--s2)"><button class="btn" id="sbRename">Rename</button><button class="btn primary" id="sbSave">Save set</button><button class="btn danger" id="sbClear">Clear</button></div></div>

    <div class="builder">
      <div><div class="label" style="margin-bottom:6px">Length</div>${UI.seg([[30, "30 min"], [45, "45"], [60, "60"], [90, "90"]], build.length, "data-blen")}</div>
      <div><div class="label" style="margin-bottom:6px">Energy curve</div><select class="field" id="sbCurve">${curves.map(([k, c]) => `<option value="${k}" ${build.curve === k ? "selected" : ""}>${c.label}</option>`).join("")}${build.curve === "custom" ? `<option value="custom" selected>Custom</option>` : ""}</select></div>
      <div><div class="label" style="margin-bottom:6px">Sonic character</div>${UI.seg([["safe", "Safe"], ["balanced", "Balanced"], ["contrast", "Contrast"]], build.mode, "data-bmode")}</div>
      <div style="display:flex;gap:var(--s2);align-items:end;flex-wrap:wrap"><button class="btn primary" id="sbBuild">Build set</button><button class="btn" id="sbReroll" title="Another take with the same settings">Re-roll</button>
        <label class="mono dim" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sbKeep" ${build.keepFirst ? "checked" : ""}> keep first track</label></div>
    </div>

    <div class="curvebox"><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span class="label">Energy · planned <span style="color:var(--amber)">- - -</span> vs. actual ——</span><span class="mono faint">drag the points to edit the plan</span></div>${curveSvg(tracks)}</div>

    ${tracks.length ? `<div class="stats">
      <div class="st"><div class="label">Tracks</div><div class="v">${tracks.length}</div></div>
      <div class="st"><div class="label">Duration</div><div class="v">${Math.round(eff / 60)} min <small class="dim" style="font-size:12px">with mix overlaps</small></div></div>
      <div class="st"><div class="label">BPM range</div><div class="v">${Math.min(...bpms).toFixed(0)}–${Math.max(...bpms).toFixed(0)}</div></div>
      <div class="st"><div class="label">Avg DJ compat.</div><div class="v">${avgDj ?? UI.NA}${avgDj != null ? "%" : ""}</div></div>
      <div class="st"><div class="label">Avg sonic</div><div class="v">${avgSonic ?? UI.NA}${avgSonic != null ? "%" : ""}</div></div></div>
    <div class="seq" id="seq">${tracks.map((t, i) => nodeHtml(t, i) + (i < tracks.length - 1 ? linkHtml(t, tracks[i + 1], links[i], i) : "")).join("")}</div>` :
    `<div class="empty" style="padding-left:0">The set is empty. Build one from your library, or add tracks from the panel on the right.</div>`}`;
  wireDnD();
}
function nodeHtml(t, i) {
  return `<div class="node" draggable="true" data-idx="${i}"><span class="idx">${String(i + 1).padStart(2, "0")}</span><span class="artplay">${UI.art(t, "sm")}<button class="ov ${player.id === t.id && !player.audio.paused ? "on" : ""}" data-simplay="${t.id}" aria-label="Play">${UI.icon("play")}</button></span>
    <div class="nm" data-open-track="${t.id}" style="cursor:pointer"><div class="t2">${UI.esc(t.artist)}</div><div class="t1">${UI.esc(t.title)}</div></div>
    <div class="nstats"><span><b class="num">${t.bpm.toFixed(1)}</b> BPM</span><span><b>${UI.esc(t.key.camelot)}</b></span><span><b class="num">${Math.round(t.profile.energy)}</b> NRG</span><span>${fmtTime(t.durationSec)}</span></div>
    <button class="iconbtn" data-sbremove="${i}" aria-label="Remove from set">${UI.icon("close")}</button></div>`;
}
function linkHtml(a, b, l, i) {
  const key = a.id + "|" + b.id, open = expandedLinks.has(key), d = l.dj;
  const bar = (lab, v) => `<div><div class="l"><span>${lab}</span><span class="num">${v == null ? UI.NA : Math.round(v)}</span></div>${UI.bar(v ?? 0, `var(--${v == null ? "text-3" : v >= 80 ? "green" : v >= 55 ? "amber" : "coral"})`)}</div>`;
  return `<div class="link"><div></div><div class="rail"></div><div class="info"><div class="head">
    <button class="sc" data-toggle-link="${key}" aria-expanded="${open}">DJ compatibility<b class="${UI.tone(d.overall)} num">${Math.round(d.overall)}%</b></button>
    <span class="scoretag sonicv"><b class="${UI.tone(l.sonic && l.sonic.overall)} num">${l.sonic ? Math.round(l.sonic.overall) + "%" : UI.NA}</b><span>Sonic</span></span>
    <span class="mono dim">${a.key.camelot} → ${b.key.camelot} · ${a.bpm.toFixed(0)} → ${b.bpm.toFixed(0)} BPM</span>
    <button class="linkbtn" data-bridge="${i}">Find a bridge</button></div>
    ${open ? `<div class="tbreak">${bar("Tempo", d.tempo)}${bar("Key", d.key)}${bar("Rhythm", d.rhythm)}${bar("Energy", d.energy)}${bar("Structure", d.structure)}${bar("Groove", d.groove)}${bar("Sonic character", l.sonic ? l.sonic.overall : null)}</div>
      <ul class="notes">${d.notes.map((n) => `<li class="${n.level}">${UI.esc(n.text)}</li>`).join("")}${l.sonic ? `<li class="${l.sonic.overall >= 80 ? "good" : l.sonic.overall >= 55 ? "ok" : "warn"}">Sonic character ${Math.round(l.sonic.overall)}% — embedding ${Math.round(l.sonic.embeddingUi)}% (raw cosine ${l.sonic.rawCosine})${l.sonic.overall < 55 ? ", a deliberate change of sound" : ""}</li>` : `<li class="none">No sonic embedding for one of the tracks</li>`}</ul>` : ""}</div></div>`;
}

function wireDnD() {
  const seq = document.getElementById("seq"); if (!seq) return;
  let from = null;
  seq.querySelectorAll(".node").forEach((n) => {
    n.addEventListener("dragstart", () => { from = +n.dataset.idx; n.classList.add("dragging"); });
    n.addEventListener("dragend", () => n.classList.remove("dragging"));
    n.addEventListener("dragover", (e) => { e.preventDefault(); n.classList.add("over"); });
    n.addEventListener("dragleave", () => n.classList.remove("over"));
    n.addEventListener("drop", (e) => { e.preventDefault(); n.classList.remove("over"); const to = +n.dataset.idx; if (from == null || from === to) return; const ids = state.currentSet.trackIds; const [m] = ids.splice(from, 1); ids.splice(to, 0, m); renderActiveView(); });
  });
}

/* energy-curve editing: drag a point vertically */
(function () {
  let drag = null;
  document.addEventListener("pointerdown", (e) => { const g = e.target.closest && e.target.closest("[data-pt]"); if (g) { drag = { i: +g.dataset.pt, svg: g.ownerSVGElement }; e.preventDefault(); } });
  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = drag.svg.getBoundingClientRect(), H = 150, py = 14, y = ((e.clientY - r.top) / r.height) * H;
    build.pts[drag.i] = Math.max(0, Math.min(100, Math.round(((H - py - y) / (H - 2 * py)) * 100)));
    build.curve = "custom";
    document.getElementById("curveSvg").outerHTML = curveSvg(setTracks());
    drag.svg = document.getElementById("curveSvg");
  });
  document.addEventListener("pointerup", () => { if (drag) { drag = null; renderSetBuilderView(); } });
})();

async function buildSetNow(reroll) {
  if (state.library.length < 4) { toast("Add at least 4 analysed tracks to build a set"); return; }
  if (reroll) build.seed++;
  await ensureSonic();
  const pool = state.library.filter((t) => passFilters(t)).map(trackToEngineShape);
  const keep = build.keepFirst && state.currentSet.trackIds.length ? state.currentSet.trackIds[0] : null;
  const sonic = (a, b) => { const p = sonicPair(findTrack(a.id), findTrack(b.id)); return p ? p.ui : null; };
  const r = DjEngine.buildSet({ tracks: pool, targetMinutes: build.length, curve: build.pts, startId: keep, seed: build.seed, sonic, mode: build.mode, djWeights: state.weights.dj });
  if (!r.ids.length) { toast("Not enough tracks match the filters"); return; }
  state.currentSet.trackIds = r.ids;
  toast(`Built ${r.ids.length} tracks · ${Math.round(r.effectiveSec / 60)} min · avg DJ ${Math.round(r.avgDj)}%`);
  renderActiveView();
}

document.getElementById("setBuilderView").addEventListener("click", async (e) => {
  const len = e.target.closest("[data-blen]"); if (len) { build.length = +len.dataset.blen; renderSetBuilderView(); return; }
  const md = e.target.closest("[data-bmode]"); if (md) { build.mode = md.dataset.bmode; renderSetBuilderView(); return; }
  if (e.target.closest("#sbBuild")) { buildSetNow(false); return; }
  if (e.target.closest("#sbReroll")) { buildSetNow(true); return; }
  const tg = e.target.closest("[data-toggle-link]"); if (tg) { const k = tg.dataset.toggleLink; expandedLinks.has(k) ? expandedLinks.delete(k) : expandedLinks.add(k); renderSetBuilderView(); return; }
  const rm = e.target.closest("[data-sbremove]"); if (rm) { state.currentSet.trackIds.splice(+rm.dataset.sbremove, 1); renderActiveView(); return; }
  const br = e.target.closest("[data-bridge]"); if (br) { showFindBridge(+br.dataset.bridge); return; }
  if (e.target.closest("#sbRename")) { const f = await openForm("Set name", [{ name: "name", label: "Name", value: state.currentSet.name }], "Save"); if (f && f.name.trim()) { state.currentSet.name = f.name.trim(); renderSetBuilderView(); } return; }
  if (e.target.closest("#sbClear")) { if (!state.currentSet.trackIds.length) return; if (!(await askConfirm("Clear the current set?", "Clear"))) return; state.currentSet = { name: "Untitled set", trackIds: [] }; renderActiveView(); return; }
  if (e.target.closest("#sbSave")) { saveCurrentSet(); return; }
});
document.getElementById("setBuilderView").addEventListener("change", (e) => {
  if (e.target.id === "sbCurve") { build.curve = e.target.value; build.pts = DjEngine.CURVES[build.curve].pts.slice(); renderSetBuilderView(); }
  if (e.target.id === "sbKeep") build.keepFirst = e.target.checked;
});
function saveCurrentSet() {
  if (!state.currentSet.trackIds.length) { toast("The set is empty"); return; }
  const ex = state.sets.find((s) => s.id === state.currentSet.id);
  if (ex) { ex.name = state.currentSet.name; ex.trackIds = [...state.currentSet.trackIds]; ex.updatedAt = Date.now(); }
  else { state.currentSet.id = "s_" + Math.random().toString(36).slice(2, 10); state.currentSet.createdAt = state.currentSet.updatedAt = Date.now(); state.sets.push({ ...state.currentSet }); }
  persistSets(); toast("Set saved: " + state.currentSet.name);
}

/* ---- find a bridge: DJ compatibility with both neighbours + position between A and B in embedding space ---- */
async function showFindBridge(idx) {
  const ids = state.currentSet.trackIds, a = findTrack(ids[idx]), b = findTrack(ids[idx + 1]);
  const cands = state.library.filter((t) => t.id !== a.id && t.id !== b.id && !ids.includes(t.id));
  const between = new Map(), ia = sonicIdOf(a), ib = sonicIdOf(b);
  if (ia && ib) { const r = await BackendClient.sonicBridge(ia, ib, cands.map(sonicIdOf).filter(Boolean)); if (r.ok) r.result.results.forEach((x) => between.set(x.id, x)); await ensureSonic(); }
  const A = trackToEngineShape(a), B = trackToEngineShape(b);
  const ranked = cands.map((t) => {
    const T = trackToEngineShape(t), djA = computeDjCompatibility(A, T, state.weights.dj, KEY_WEIGHTS), djB = computeDjCompatibility(T, B, state.weights.dj, KEY_WEIGHTS);
    const bw = between.get(sonicIdOf(t)), sA = sonicScore(a, t), sB = sonicScore(t, b);
    const score = bw && sA && sB ? SonicSimilarity.bridgeScore(djA.overall, djB.overall, sA.overall, sB.overall, bw.between) : (djA.overall + djB.overall) / 2;
    return { t, score, djA, djB, sA, sB, bw };
  }).sort((x, y) => y.score - x.score).slice(0, 8);
  openModal(modalShell("Find a bridge", `<p class="dim" style="font-size:12px;margin:0 0 12px">Between <b style="color:var(--text)">${UI.esc(a.title)}</b> and <b style="color:var(--text)">${UI.esc(b.title)}</b>: compatible with both${between.size ? " and sitting between them in sonic space" : ""}.</p>
    ${ranked.length ? ranked.map((r) => `<div class="trow" style="padding-left:0;padding-right:0">${`<span class="artplay">${UI.art(r.t, "sm")}<button class="ov" data-simplay="${r.t.id}" aria-label="Play">${UI.icon("play")}</button></span>`}
      <div style="min-width:0"><div class="t2">${UI.esc(r.t.artist)}</div><div class="t1">${UI.esc(r.t.title)}</div><div class="t3">DJ ← ${Math.round(r.djA.overall)}% · ${Math.round(r.djB.overall)}% →${r.sA && r.sB ? ` · Sonic ← ${Math.round(r.sA.overall)}% · ${Math.round(r.sB.overall)}% → · between ${Math.round(r.bw.between * 100)}%` : ""}</div></div>
      <div style="display:flex;gap:var(--s3);align-items:center"><span class="big ${UI.tone(r.score)} num" style="font-size:20px">${Math.round(r.score)}%</span><button class="btn sm" data-insert="${r.t.id}">Insert</button></div></div>`).join("") : `<div class="empty" style="padding-left:0">No other tracks in the library to use as a bridge.</div>`}`));
  document.querySelectorAll("[data-insert]").forEach((bt) => bt.addEventListener("click", () => { state.currentSet.trackIds.splice(idx + 1, 0, bt.dataset.insert); closeModal(); renderActiveView(); toast("Bridge inserted"); }));
}

/* ---- context panel: add tracks + next track ---- */
let nextMode = "balanced", pickerQuery = "";
function ctxSetBuilder() {
  const ids = state.currentSet.trackIds, last = findTrack(ids[ids.length - 1]);
  const pool = state.library.filter((t) => !ids.includes(t.id) && passFilters(t) && (!pickerQuery || (t.title + " " + t.artist).toLowerCase().includes(pickerQuery.toLowerCase())));
  let next = "";
  if (last) {
    const L = trackToEngineShape(last);
    const ranked = state.library.filter((t) => !ids.includes(t.id)).map((t) => {
      const dj = computeDjCompatibility(L, trackToEngineShape(t), state.weights.dj, KEY_WEIGHTS), sp = sonicScore(last, t);
      return { t, dj, sonic: sp, score: sp ? SonicSimilarity.nextScore(nextMode, dj.overall, sp.overall) : dj.overall };
    }).sort((a, b) => b.score - a.score).slice(0, 5);
    next = `<div class="ctx-sec"><div class="ctx-head"><span class="label">What to play next</span><span class="mono dim">after ${UI.esc(last.title.slice(0, 18))}</span></div>
      <div style="padding:0 var(--s5) var(--s3)">${UI.seg(Object.entries(SonicSimilarity.NEXT_MODES).map(([k, m]) => [k, m.label]), nextMode, "data-nextmode")}</div>
      <div class="tlist">${ranked.length ? ranked.map((r) => UI.trackRow(r.t, { scoreHtml: `<div class="big ${UI.tone(r.score)} num">${Math.round(r.score)}%</div>`, sub: `DJ ${Math.round(r.dj.overall)}%${r.sonic ? " · SONIC " + Math.round(r.sonic.overall) + "%" : ""}` }) + "").join("") : `<div class="empty">No more tracks.</div>`}</div></div>`;
  }
  return `${next}<div class="ctx-sec"><div class="ctx-head"><span class="label">Add tracks</span><span class="mono dim">${pool.length}</span></div>
    <div style="padding:0 var(--s5) var(--s3)"><input class="field" id="pickerSearch" placeholder="Search library" value="${UI.esc(pickerQuery)}"></div>
    <div class="tlist" style="max-height:420px;overflow:auto">${pool.slice(0, 60).map((t) => UI.trackRow(t, { scoreHtml: `<button class="btn sm" data-addset="${t.id}">+ Add</button>` })).join("") || `<div class="empty">Nothing to add.</div>`}</div></div>`;
}
function wireSetBuilderContext() {
  const el = document.getElementById("contextPanel");
  const ps = el.querySelector("#pickerSearch");
  if (ps) ps.addEventListener("input", () => { pickerQuery = ps.value; const pos = ps.selectionStart; renderContext(); const n = document.getElementById("pickerSearch"); n.focus(); n.setSelectionRange(pos, pos); });
  el.querySelectorAll("[data-nextmode]").forEach((b) => b.addEventListener("click", () => { nextMode = b.dataset.nextmode; renderContext(); }));
  const ids = state.currentSet.trackIds, last = findTrack(ids[ids.length - 1]);
  ensureSonicThen(last, () => { renderContext(); if (state.tab === "setbuilder") renderSetBuilderView(); });
}
