/* =================== Transition Guide / Best Mix Point =================== */
// Two waveforms aligned on the bar axis around the mix point. Drag a marker (it snaps to the bar grid) to set your own mix
// points; manual points are stored with the set, win over the suggestion and are what the exporters use.
const GUIDE_PRE_BARS = 16;
let guideState = null;

function posText(p) {
  if (!p) return UI.NA;
  const parts = [fmtTime(p.time)];
  if (p.bar) parts.push(t("guide.bar", { n: p.bar }));
  if (p.phrase) parts.push(t("guide.phrase", { n: p.phrase.n, b: p.phrase.bar }));
  if (p.section) parts.push(secLabel(p.section));
  return parts.join(" · ");
}
function openTransitionGuide(aId, bId, autoplay) {
  const A = findTrack(aId), B = findTrack(bId); if (!A || !B) return;
  stopTransition();
  const dlg = openModal("", "xwide"); guideState = { a: aId, b: bId }; renderGuide(dlg);
  if (autoplay) playTransition();
}
function renderGuide(dlg) {
  dlg = dlg || document.querySelector("#modalRoot .dialog"); if (!dlg || !guideState) return;
  const A = findTrack(guideState.a), B = findTrack(guideState.b), tr = transitionOf(A, B), g = tr.guide, d = tr.compat;
  const head = `<div class="dhead"><h3>${t("guide.title")}${UI.help("guide")}</h3><button class="iconbtn" data-close-modal aria-label="${UI.esc(t("common.close"))}">${UI.icon("close")}</button></div>
    <div class="mono dim" style="margin-bottom:16px">${UI.esc(A.title)} → ${UI.esc(B.title)}</div>`;
  if (!g || !g.available) {
    dlg.innerHTML = head + `<div class="empty"><b>${t("guide.unavailable")}</b>${t("guide.reason." + (g ? g.reason : "noGrid"))}</div>` + compatBlock(d);
    return;
  }
  const reasonList = (arr, ns) => arr.map((r) => `<li class="ok">${UI.esc(t(ns + "." + r.k, { v: r.v != null ? r.v : "" }))}</li>`).join("");
  dlg.innerHTML = head + `
    <div class="guide-mid"><span class="badge ${g.difficulty.key}" data-tip="${UI.esc(g.difficulty.factors.map((f) => t("dfac." + f)).join(" · ") || t("dfac.none"))}">${t("diff." + g.difficulty.key)}</span>
      <span class="badge ${g.confidence.level}" data-tip="${UI.esc(g.confidence.reasons.map((r) => t("gconf." + r.k)).join(" · ") || t("gconf.ok"))}">${t("guide.confidence")}: ${t("conf." + g.confidence.level)}</span>
      ${g.estimated ? `<span class="badge medium" data-tip="${UI.esc(t("guide.estimatedTip"))}">${t("guide.estimated")}</span>` : ""}${g.manual ? `<span class="badge">${t("common.manual")}</span>` : ""}
      <span class="mono dim">${t("guide.tempoDiff", { n: g.tempoDiffPct })} · ${A.key.camelot} → ${B.key.camelot}</span></div>
    <div class="gsummary"><span class="label">${t("guide.summaryTitle")}</span> <b>${UI.esc(A.title)}</b> <span class="dim">${UI.esc(sectionLine(g.mixOut))}</span> <span class="dim">→</span> <b>${UI.esc(B.title)}</b> <span class="dim">${UI.esc(sectionLine(g.mixIn))}</span></div>
    <div class="toolbar" style="margin-bottom:12px"><button class="btn primary" id="gPlay">${UI.icon(guideAudio.playing ? "pause" : "play")}${t(guideAudio.playing ? "guide.stop" : "guide.play")}</button><span class="mono faint" id="gPlayNote">${UI.esc(guideAudio.note || t("guide.playHint"))}</span></div>
    <div class="guide-wave"><div class="gl"><span class="mono dim">A · ${UI.esc(A.title)}</span><span class="mono">${t("guide.mixOut")} ${posText(g.mixOut)}</span></div><canvas id="gwA" data-side="a" aria-label="${UI.esc(t("guide.waveA"))}"></canvas><i class="ghead" id="ghA"></i>${nudgeRow("a")}</div>
    <div class="guide-wave"><div class="gl"><span class="mono dim">B · ${UI.esc(B.title)}</span><span class="mono">${t("guide.mixIn")} ${posText(g.mixIn)}</span></div><canvas id="gwB" data-side="b" aria-label="${UI.esc(t("guide.waveB"))}"></canvas><i class="ghead" id="ghB"></i>${nudgeRow("b")}</div>
    <div class="mono faint" style="text-align:center;margin-bottom:12px">${t("guide.dragHint")}</div>
    ${shiftBlock(A, B)}
    <div class="gcols"><div class="gcol"><div class="label">${t("guide.mixOut")}</div><div class="t">${fmtTime(g.mixOut.time)}</div><div class="dim" style="font-size:12px;margin-top:4px">${posText(g.mixOut)}</div>
        <div class="toolbar" style="margin-top:10px"><button class="btn sm" data-gplay="a">${UI.icon("play")}${t("guide.playFrom")}</button></div></div>
      <div class="gcol"><div class="label">${t("guide.mixIn")}</div><div class="t">${fmtTime(g.mixIn.time)}</div><div class="dim" style="font-size:12px;margin-top:4px">${posText(g.mixIn)}</div>
        <div class="toolbar" style="margin-top:10px"><button class="btn sm" data-gplay="b">${UI.icon("play")}${t("guide.playFrom")}</button></div></div></div>
    <div class="gtype"><span class="label">${t("guide.type")}${UI.help("gtype")}</span><div class="chips">${Transition.TYPES.map((k) => `<button class="chip ${g.type.key === k ? "on" : ""}" data-gtype="${k}" data-tip="${UI.esc(t("ttip." + k))}">${t("ttype." + k)}</button>`).join("")}</div>
      ${/^loop_/.test(g.type.key) ? `<div class="toolbar" style="margin-top:8px"><span class="label">${t("guide.loopLength")}</span>${UI.seg(Transition.LOOP_BARS.map((n) => [n, n === 1 ? "1 " + t("unit.bar1") : n + " " + t("unit.bars")]), g.loopBars, "data-gloop")}</div>` : ""}</div>
    <div class="gwhere"><div><span class="label">${t("guide.whereOut")}</span><div class="chips">${whereChips(A, g.mixOut, "gout")}</div></div><div><span class="label">${t("guide.whereIn")}</span><div class="chips">${whereChips(B, g.mixIn, "gin")}</div></div></div>
    <div class="toolbar" style="margin-bottom:12px"><span class="label">${t("guide.length")}</span>${UI.seg(Transition.LENGTHS.slice().reverse().map((n) => [n, n + " " + t("unit.bars")]), g.bars, "data-gbars")}<span class="mono dim">${g.bars ? "≈ " + g.seconds + " s" : t("guide.cut")}</span>
      ${g.manual ? `<button class="btn sm" id="guideReset">${t("guide.resetAuto")}</button>` : ""}</div>
    ${UI.sectionHead(t("guide.type") + ": " + t("ttype." + g.type.key), "")}<ul class="why">${reasonList(g.type.reasons, "twhy")}<li class="none">${UI.esc(t("mixout." + g.mixOutWhy))}</li></ul>
    ${compatBlock(d)}`;
  requestAnimationFrame(() => drawGuide(A, B, g));
}
// a grid measured locally can have its bar line on the wrong beat: let the user shift it by one beat
function shiftBlock(A, B) {
  const row = (tr, side) => { const lg = localGridOf(tr); return lg ? `<button class="btn sm" data-gshift="${side}" data-tip="${UI.esc(t("guide.shiftTip"))}">${t("guide.shift", { s: side.toUpperCase(), n: lg.shift || 0 })}</button>` : ""; };
  const a = row(A, "a"), b = row(B, "b"); if (!a && !b) return "";
  return `<div class="toolbar" style="margin-bottom:12px"><span class="mono faint">${t("guide.gridLocalNote")}</span>${a}${b}</div>`;
}
// precise placement: step the mix point by bars or by a beat (bar/4) with arrows
function nudgeRow(side) {
  const b = (d, label) => `<button class="nudge" data-gnudge="${side}:${d}" aria-label="${UI.esc(t("guide.nudge", { n: label }))}">${label}</button>`;
  return `<div class="nudges" role="group" aria-label="${UI.esc(t("guide.nudgeGroup"))}">${b(-4, "«4")}${b(-1, "‹1")}${b(-0.25, "‹¼")}<span class="mono faint">${t("unit.bars")}</span>${b(0.25, "¼›")}${b(1, "1›")}${b(4, "4»")}</div>`;
}
const sectionLine = (p) => (p ? [p.section ? secLabel(p.section) : null, p.bar ? t("guide.bar", { n: p.bar }) : null, fmtTime(p.time)].filter(Boolean).join(" · ") : UI.NA);
// every labelled section of the track is a place to mix out of / into; the current choice is highlighted
function whereChips(tr, cur, attr) {
  const st = structureOf(tr); if (!st) return `<span class="faint">${t("guide.noSections")}</span>`;
  return st.segments.map((sg, i) => `<button class="chip ${cur && cur.section === sg.label && cur.time >= sg.start - 0.05 && cur.time < sg.end ? "on" : ""}" data-${attr}="${i}"><i style="background:${SEC_COLORS()[sg.label] || "#888"}"></i>${UI.esc(secLabel(sg.label))} <span class="mono">${fmtTime(sg.start)}</span></button>`).join("");
}
function compatBlock(d) {
  return `${UI.sectionHead(t("guide.compat"), UI.score("dj", d.overall) + " " + confidenceBadge(d.confidence))}${djBreakdown(d)}<ul class="why">${d.notes.map((n) => `<li class="${n.level}">${UI.esc(noteText(n))}</li>`).join("")}</ul>`;
}

/* ---- drawing: bars on the x axis, anchored at the mix point (0) ---- */
function guideWindow(T, anchor, bars) { const bar = Transition.barSec(T); return { bar, t0: anchor - GUIDE_PRE_BARS * bar, t1: anchor + (Math.max(bars, 16) + 8) * bar }; }
function drawGuide(A, B, g) {
  const SA = trackToEngineShape(A), SB = trackToEngineShape(B), bars = g.bars;
  drawGuideWave(document.getElementById("gwA"), A, SA, g.mixOut.time, bars, "a");
  drawGuideWave(document.getElementById("gwB"), B, SB, g.mixIn.time, bars, "b");
}
function drawGuideWave(canvas, tr, S, anchor, bars, side) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1, cw = canvas.clientWidth, ch = canvas.clientHeight; if (!cw || !ch) return;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
  const w = trackWaveform(tr.id), win = guideWindow(S, anchor, bars), span = win.t1 - win.t0, X = (tt) => ((tt - win.t0) / span) * cw;
  canvas._win = { win, S }; // used by the drag handler
  const segs = S.segments || [], strip = segs.length ? 8 : 0, top = strip ? strip + 3 : 2, mid = (top + ch - 2) / 2, maxH = ch - top - 2;
  if (w) for (let i = 0; i < w.bins; i++) {
    const tt = ((i + 0.5) / w.bins) * tr.durationSec; if (tt < win.t0 || tt > win.t1) continue;
    const h = Math.max(1, (w.amp[i] / 255) * maxH), x = X(tt), bw = Math.max(1.5, (tr.durationSec / w.bins / span) * cw - 0.5);
    ctx.fillStyle = tt >= anchor && tt <= anchor + bars * win.bar ? "rgba(244,244,242,0.95)" : "rgba(244,244,242,0.35)"; ctx.fillRect(x, mid - h / 2, bw, h);
  }
  for (const sg of segs) { const x0 = Math.max(0, X(sg.start)), x1 = Math.min(cw, X(sg.end)); if (x1 <= 0 || x0 >= cw) continue; ctx.fillStyle = SEC_COLORS()[sg.label] || "#888"; ctx.fillRect(x0 + 0.5, 0, Math.max(1, x1 - x0 - 1), strip);
    if (x1 - x0 > 46) { ctx.fillStyle = "#060606"; ctx.font = "8px ui-monospace,monospace"; ctx.textBaseline = "middle"; ctx.fillText(secLabel(sg.label).toUpperCase(), x0 + 4, strip / 2 + 0.5); } }
  // bar ticks (phrase every 16 bars drawn stronger)
  const d = S.downbeats || [];
  for (let i = 0; i < d.length; i++) { if (d[i] < win.t0 || d[i] > win.t1) continue; ctx.fillStyle = i % 16 === 0 ? "rgba(244,244,242,0.45)" : "rgba(244,244,242,0.14)"; ctx.fillRect(X(d[i]), i % 16 === 0 ? top - 3 : ch - 9, 1, i % 16 === 0 ? ch - top + 1 : 7); }
  ctx.fillStyle = "rgba(75,224,122,0.10)"; ctx.fillRect(X(anchor), top, Math.max(0, X(anchor + bars * win.bar) - X(anchor)), ch - top);
  ctx.fillStyle = "#4be07a"; ctx.fillRect(X(anchor) - 1, 0, 2, ch); // the mix point
}
// pointer: place the marker at the nearest bar line
document.addEventListener("pointerdown", (e) => {
  const c = e.target.closest && e.target.closest("#modalRoot canvas[data-side]"); if (!c || !guideState || !c._win) return;
  e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch (er) {} guideState.drag = c;
  guideMove(e);
});
document.addEventListener("pointermove", (e) => { if (guideState && guideState.drag) guideMove(e); });
document.addEventListener("pointerup", () => { if (guideState && guideState.drag) { guideState.drag = null; persistCurrentSet(); renderGuide(); if (state.tab === "setbuilder") renderActiveView(); } });
function guideMove(e) {
  const c = guideState.drag, r = c.getBoundingClientRect(), { win, S } = c._win;
  const tt = win.t0 + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (win.t1 - win.t0);
  const snapped = S.downbeats[Grid.nearest(S.downbeats, tt)];
  const key = guideState.a + "|" + guideState.b, m = (state.currentSet.manualMix[key] = state.currentSet.manualMix[key] || {});
  m[c.dataset.side === "a" ? "mixOutTime" : "mixInTime"] = snapped;
  const A = findTrack(guideState.a), B = findTrack(guideState.b), g = transitionOf(A, B).guide;
  const other = document.getElementById(c.dataset.side === "a" ? "gwA" : "gwB"); // live feedback: marker follows, labels update on release
  drawGuideWave(c, c.dataset.side === "a" ? A : B, S, snapped, g.bars, c.dataset.side);
}
document.addEventListener("click", (e) => {
  if (!guideState || !e.target.closest("#modalRoot")) return;
  const bars = e.target.closest("[data-gbars]"); if (bars) { const key = guideState.a + "|" + guideState.b, m = (state.currentSet.manualMix[key] = state.currentSet.manualMix[key] || {}); m.bars = +bars.dataset.gbars; persistCurrentSet(); renderGuide(); if (state.tab === "setbuilder") renderActiveView(); return; }
  if (e.target.closest("#guideReset")) { delete state.currentSet.manualMix[guideState.a + "|" + guideState.b]; persistCurrentSet(); renderGuide(); if (state.tab === "setbuilder") renderActiveView(); return; }
  const pl = e.target.closest("[data-gplay]"); if (pl) { const side = pl.dataset.gplay, id = side === "a" ? guideState.a : guideState.b, tr = findTrack(id), g = transitionOf(findTrack(guideState.a), findTrack(guideState.b)).guide;
    const barSec = Transition.barSec(trackToEngineShape(tr)); seekTo(id, Math.max(0, (side === "a" ? g.mixOut.time : g.mixIn.time) - 8 * barSec)); }
});

/* ---- listen to the transition: A plays up to the mix-out point, then B comes in over the overlap (Web Audio) ---- */
const guideAudio = { ctx: null, cache: new Map(), nodes: [], raf: 0, playing: false, note: "" };
async function decodeForGuide(id) {
  if (guideAudio.cache.has(id)) return guideAudio.cache.get(id);
  const blob = await getAudioBlob(id); if (!blob) return null;
  const buf = await guideAudio.ctx.decodeAudioData(await blob.arrayBuffer());
  guideAudio.cache.set(id, buf); if (guideAudio.cache.size > 4) guideAudio.cache.delete(guideAudio.cache.keys().next().value);
  return buf;
}
function stopTransition() {
  guideAudio.nodes.forEach((n) => { try { n.stop(); } catch (e) {} try { n.disconnect(); } catch (e) {} });
  guideAudio.nodes = []; cancelAnimationFrame(guideAudio.raf); guideAudio.playing = false;
  ["ghA", "ghB"].forEach((id) => { const h = document.getElementById(id); if (h) h.style.display = "none"; });
  const b = document.getElementById("gPlay"); if (b) b.innerHTML = UI.icon("play") + t("guide.play");
}
async function playTransition() {
  if (guideAudio.playing) { stopTransition(); return; }
  if (!guideState) return;
  const A = findTrack(guideState.a), B = findTrack(guideState.b), g = transitionOf(A, B).guide; if (!g || !g.available) return;
  stopAllAudio("guide");
  guideAudio.ctx = guideAudio.ctx || new (window.AudioContext || window.webkitAudioContext)(); await guideAudio.ctx.resume();
  const note = document.getElementById("gPlayNote"); if (note) note.textContent = t("guide.loading");
  const [bufA, bufB] = await Promise.all([decodeForGuide(A.id), decodeForGuide(B.id)]);
  if (!bufA || !bufB) { toast(t("toast.noAudio")); if (note) note.textContent = ""; return; }
  const ctx = guideAudio.ctx, SA = trackToEngineShape(A), SB = trackToEngineShape(B), barA = Transition.barSec(SA), barB = Transition.barSec(SB), beatA = barA / 4;
  let ratio = SA.bpm / SB.bpm; if (ratio > 1.6) ratio /= 2; else if (ratio < 0.62) ratio *= 2;   // half / double-time pairs
  const rate = Math.max(0.9, Math.min(1.1, ratio)), type = g.type.key, loops = /^loop_/.test(type), loopSec = (g.loopBars || 4) * barA;
  const start = Math.max(0, g.mixOut.time - 8 * barA), pre = g.mixOut.time - start;
  // length of the overlap / effect for each kind of transition
  const rollSec = 2 * barA, L = type === "quick_cut" ? 0.03 : type === "loop_roll" ? rollSec : Math.max(g.bars ? g.bars * barA : 0.25, loops ? 2 * barA : 0.25);
  const post = Math.max(8, 8 * barB / rate), t0 = ctx.currentTime + 0.12, tx0 = t0 + pre, end = tx0 + L + post, steps = 24;
  const curve = (f) => Float32Array.from({ length: steps }, (_, i) => f(i / (steps - 1)));
  const eq = (f) => (x) => f(x);
  const node = (buf, when, offset, r, opt = {}) => {
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = r;
    if (opt.loop) { s.loop = true; s.loopStart = opt.loop[0]; s.loopEnd = opt.loop[1]; }
    const lo = ctx.createBiquadFilter(); lo.type = "lowshelf"; lo.frequency.value = 220;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 10;
    const gn = ctx.createGain(); s.connect(lo); lo.connect(hp); hp.connect(gn); gn.connect(ctx.destination);
    s.start(when, offset); guideAudio.nodes.push(s); return { s, lo, hp, gn };
  };
  const fade = (gn, from, to, when, dur, shape) => { gn.gain.setValueAtTime(from, when); if (dur <= 0.001) gn.gain.setValueAtTime(to, when); else gn.gain.setValueCurveAtTime(curve((x) => from + (to - from) * shape(x)), when, dur); };
  const equal = { out: (x) => 1 - Math.sin(x * Math.PI / 2), in: (x) => Math.sin(x * Math.PI / 2) };   // equal-power pair (gain goes 1 -> 0 / 0 -> 1)
  let a, b, aEnd = tx0 + L + 0.05;
  const mainA = node(bufA, t0, start, 1); mainA.gn.gain.setValueAtTime(1, t0);   // A plays up to the mix-out point in every case
  a = mainA; b = node(bufB, tx0, g.mixIn.time, rate); b.gn.gain.setValueAtTime(0, t0);
  if (type === "quick_cut") { a.gn.gain.setValueAtTime(1, tx0 - 0.005); a.gn.gain.linearRampToValueAtTime(0, tx0 + 0.01); b.gn.gain.setValueAtTime(1, tx0); a.s.stop(tx0 + 0.05); }
  else if (type === "loop_roll") {
    // A is cut at the mix-out point and rolls: loops of 1 bar, 1/2 bar, 1 beat, 1/2 beat, then B hits
    a.gn.gain.setValueAtTime(1, tx0 - 0.005); a.gn.gain.linearRampToValueAtTime(0, tx0 + 0.01); a.s.stop(tx0 + 0.05);
    let when = tx0; for (const [len, times] of [[barA, 1], [barA / 2, 2], [beatA, 2], [beatA / 2, 4]]) { const r = node(bufA, when, g.mixOut.time, 1, { loop: [g.mixOut.time, g.mixOut.time + len] }); r.gn.gain.setValueAtTime(1, when); when += len * times; r.s.stop(when); }
    const bStart = tx0 + (barA + barA + beatA * 2 + beatA * 2); b.s.stop(0); b = node(bufB, bStart, g.mixIn.time, rate); b.gn.gain.setValueAtTime(1, bStart); guideAudio.nodes.push(b.s); aEnd = bStart; guideAudio.rollEnd = bStart - t0;
  }
  else {
    guideAudio.rollEnd = null;
    if (loops) { a.s.stop(tx0); a = node(bufA, tx0, g.mixOut.time, 1, { loop: [g.mixOut.time, g.mixOut.time + loopSec] }); a.gn.gain.setValueAtTime(1, tx0); }
    if (type === "energy_reset") { fade(a.gn, 1, 0, tx0, L / 2, equal.out); b.gn.gain.setValueAtTime(0, tx0 + L / 2); fade(b.gn, 0, 1, tx0 + L / 2, L / 2, equal.in); }
    else if (type === "filter_sweep") { fade(a.gn, 1, 0, tx0 + L * 0.35, L * 0.65, equal.out); a.hp.frequency.setValueAtTime(20, tx0); a.hp.frequency.exponentialRampToValueAtTime(5000, tx0 + L); fade(b.gn, 0, 1, tx0, L, equal.in); }
    else if (type === "echo_out") {
      const dly = ctx.createDelay(2); dly.delayTime.value = beatA * 0.75; const fb = ctx.createGain(), wet = ctx.createGain(); fb.gain.value = 0.5; a.hp.connect(dly); dly.connect(fb); fb.connect(dly); dly.connect(wet); wet.connect(ctx.destination);
      wet.gain.setValueAtTime(0, t0); wet.gain.setValueAtTime(0.8, tx0); wet.gain.linearRampToValueAtTime(0, tx0 + L); fade(a.gn, 1, 0, tx0, Math.min(L, 0.5), equal.out); fade(b.gn, 0, 1, tx0 + L * 0.4, L * 0.6, equal.in); aEnd = tx0 + L + 0.1;
    } else {
      fade(a.gn, 1, 0, tx0, L, equal.out); fade(b.gn, 0, 1, tx0, L, equal.in);   // crossfade (blend / breakdown / drop swap / bass swap)
      if (type === "bass_swap") { const mid = tx0 + L / 2; a.lo.gain.setValueAtTime(0, mid - 0.05); a.lo.gain.linearRampToValueAtTime(-30, mid + 0.05); b.lo.gain.setValueAtTime(-30, t0); b.lo.gain.setValueAtTime(-30, mid - 0.05); b.lo.gain.linearRampToValueAtTime(0, mid + 0.05); }
    }
    a.s.stop(aEnd);
  }
  b.s.stop(end);
  const total = guideAudio.rollEnd != null ? guideAudio.rollEnd + post : pre + L + post;
  guideAudio.playing = true; guideAudio.note = t("guide.playingNote", { a: Math.abs(Math.round((rate - 1) * 1000) / 10) || 0, n: Math.round(total) });
  const btn = document.getElementById("gPlay"); if (btn) btn.innerHTML = UI.icon("pause") + t("guide.stop"); if (note) note.textContent = guideAudio.note;
  const place = (id, canvasId, tt) => { const h = document.getElementById(id), c = document.getElementById(canvasId); if (!h || !c || !c._win) return; const w = c._win.win, f = (tt - w.t0) / (w.t1 - w.t0); h.style.display = f >= 0 && f <= 1 ? "block" : "none"; h.style.left = c.offsetLeft + f * c.clientWidth + "px"; h.style.top = c.offsetTop + "px"; h.style.height = c.clientHeight + "px"; };
  const bAt = guideAudio.rollEnd != null ? guideAudio.rollEnd : pre;
  const tick = () => {
    const e = ctx.currentTime - t0;
    if (e >= total + 0.1 || !guideAudio.playing) { stopTransition(); return; }
    const posA = e < pre ? start + Math.max(0, e) : loops ? g.mixOut.time + ((e - pre) % loopSec) : e < pre + L ? start + e : -1e9;
    place("ghA", "gwA", posA); place("ghB", "gwB", e >= bAt ? g.mixIn.time + (e - bAt) * rate : -1e9);
    guideAudio.raf = requestAnimationFrame(tick);
  };
  guideAudio.raf = requestAnimationFrame(tick);
}
document.addEventListener("click", (e) => {
  if (!guideState || !e.target.closest("#modalRoot")) return;
  if (e.target.closest("#gPlay")) { playTransition(); return; }
  const ty = e.target.closest("[data-gtype]"), lp = e.target.closest("[data-gloop]"), nd = e.target.closest("[data-gnudge]");
  if (ty || lp || nd) {
    const key = guideState.a + "|" + guideState.b, m = (state.currentSet.manualMix[key] = state.currentSet.manualMix[key] || {});
    if (ty) m.type = ty.dataset.gtype; if (lp) m.loopBars = +lp.dataset.gloop;
    if (nd) {
      const [side, d] = nd.dataset.gnudge.split(":"), tr = findTrack(side === "a" ? guideState.a : guideState.b), S = trackToEngineShape(tr), g = transitionOf(findTrack(guideState.a), findTrack(guideState.b)).guide, cur = side === "a" ? g.mixOut.time : g.mixIn.time, bar = Transition.barSec(S), delta = +d;
      let tt; if (Number.isInteger(delta)) { const i = Math.max(0, Math.min(S.downbeats.length - 1, Grid.nearest(S.downbeats, cur) + delta)); tt = S.downbeats[i]; } else tt = Math.max(0, Math.min(tr.durationSec - bar, cur + delta * bar));
      m[side === "a" ? "mixOutTime" : "mixInTime"] = Math.round(tt * 1000) / 1000;
    }
    stopTransition(); persistCurrentSet(); renderGuide(); if (state.tab === "setbuilder") renderActiveView(); return;
  }
  const sh = e.target.closest("[data-gshift]"); if (sh) { const tr = findTrack(sh.dataset.gshift === "a" ? guideState.a : guideState.b), lg = tr.analysis.localGrid; lg.shift = ((lg.shift || 0) + 1) % 4; touchTrack(tr.id); stopTransition(); persistLibrary(); renderGuide(); if (state.tab === "setbuilder") renderActiveView(); return; }
  const go = e.target.closest("[data-gout]"), gi = e.target.closest("[data-gin]");
  if (go || gi) {
    const A = findTrack(guideState.a), B = findTrack(guideState.b), tr = go ? A : B, st = structureOf(tr), seg = st && st.segments[+(go || gi).dataset[go ? "gout" : "gin"]]; if (!seg) return;
    const S = trackToEngineShape(tr), tt = S.downbeats[Grid.nearest(S.downbeats, seg.start)];
    const key = guideState.a + "|" + guideState.b, m = (state.currentSet.manualMix[key] = state.currentSet.manualMix[key] || {}); m[go ? "mixOutTime" : "mixInTime"] = tt;
    stopTransition(); persistCurrentSet(); renderGuide(); if (state.tab === "setbuilder") renderActiveView();
  }
});
