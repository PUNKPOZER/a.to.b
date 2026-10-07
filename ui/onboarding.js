/* =================== First-run onboarding: 7 short steps; skip / "don't show again"; re-openable from Settings =================== */
const ONB_STEPS = ["welcome", "import", "analysis", "similar", "setbuilder", "guide", "export"];
let onb = null;

function onbVisual(step) {
  const sample = { analysis: { analysis: { status: "COMPLETE", backend: { status: "AVAILABLE" }, structure: { status: "AVAILABLE" }, sonic: { status: "UNAVAILABLE", reason: "" } } } };
  switch (step) {
    case "welcome": return `<div style="display:grid;place-items:center;padding:12px">${UI.logo(64)}</div>`;
    case "import": return `<div class="panel import" style="min-height:200px;cursor:default">${UI.swirl()}<h1 style="font-size:24px">${t("import.title")}</h1><p>${t("import.sub")}</p><div class="fmt">MP3 · WAV · AIFF · FLAC · M4A</div></div>`;
    case "analysis": return `${UI.stages(sample.analysis ? { analysis: sample.analysis.analysis } : null)}<div class="mono faint">${t("onb.v.analysis")}</div>`;
    case "similar": return `<div class="sim-row" style="grid-template-columns:1fr auto"><div class="nm"><div class="t1">Track B</div><div class="mchips"><span>126 BPM</span><span>8A</span><span>Techno</span></div></div><div class="score"><b class="good num">87%</b><div class="mono dim" style="font-size:10px">${t("score.djShort")} 91%</div></div></div>
      <div class="bd"><div><div class="l"><span>${t("dj.tempo")}</span><span>96</span></div>${UI.bar(96, UI.barTone(96))}</div><div><div class="l"><span>${t("dj.key")}</span><span>85</span></div>${UI.bar(85, UI.barTone(85))}</div><div><div class="l"><span>${t("dj.structure")}</span><span>${UI.NA}</span></div>${UI.bar(0)}</div></div><div>${confidenceBadge({ level: "medium", missing: ["structure"] })}</div>`;
    case "setbuilder": return `<div class="curvebox" style="margin:0"><svg viewBox="0 0 300 80"><polyline points="10,60 60,48 110,30 160,14 210,20 260,44 290,56" fill="none" stroke="#e8b64a" stroke-width="1.6" stroke-dasharray="4 3"/>${[10, 60, 110, 160, 210, 260].map((x, i) => `<circle cx="${x}" cy="${[60, 48, 30, 14, 20, 44][i]}" r="3.4" fill="#060606" stroke="#e8b64a" stroke-width="1.5"/>`).join("")}</svg></div>
      <div class="node" style="grid-template-columns:26px 1fr auto"><span class="handle">${UI.icon("grip")}</span><span class="t1">Track A</span><span class="iconbtn on">${UI.icon("lock")}</span></div>`;
    case "guide": return `<div class="tbtn" style="justify-self:start"><span class="big">32 ${t("unit.bars")}</span><span class="sm">${t("ttype.long_blend")}</span><span class="badge easy">${t("diff.easy")}</span></div>
      <div class="guide-wave" style="margin:0"><div class="gl"><span class="mono">${t("guide.mixOut")} 4:12 · ${t("guide.bar", { n: 97 })}</span></div><svg viewBox="0 0 300 36" width="100%"><rect x="0" y="0" width="300" height="6" fill="var(--sec-chorus)" opacity=".8"/><rect x="190" y="0" width="110" height="6" fill="var(--sec-outro)" opacity=".8"/>${Array.from({ length: 50 }, (_, i) => `<rect x="${i * 6}" y="${18 - (4 + (i * 7) % 12)}" width="3" height="${(4 + (i * 7) % 12) * 2}" fill="#f4f4f2" opacity="${i > 31 ? 0.95 : 0.35}"/>`).join("")}<rect x="189" y="0" width="2" height="36" fill="#4be07a"/></svg></div>`;
    case "export": return `<div class="chips">${["Rekordbox XML", "M3U8", "TXT", t("exp.f.sheet")].map((x) => `<span class="chip">${x}</span>`).join("")}</div><div class="mono faint" style="margin-top:8px">${t("onb.v.export")}</div>`;
  }
  return "";
}
function renderOnboarding() {
  const root = document.getElementById("onboardRoot"); if (!onb) { root.innerHTML = ""; return; }
  const s = ONB_STEPS[onb.i], last = onb.i === ONB_STEPS.length - 1;
  root.innerHTML = `<div class="onb" role="dialog" aria-modal="true" aria-label="${UI.esc(t("onb.aria"))}"><div class="onb-top">${UI.logo(26)}<div class="toolbar"><button class="langbtn" id="onbLang">${LANG === "ru" ? "EN / <b>RU</b>" : "<b>EN</b> / RU"}</button><button class="btn sm" id="onbSkipBtn">${t("onb.skip")}</button></div></div>
    <div class="onb-body"><div class="onb-card"><div><div class="label" style="margin-bottom:10px">${t("onb.step", { n: onb.i + 1, total: ONB_STEPS.length })}</div><h1>${t("onb." + s + ".title")}</h1><p>${t("onb." + s + ".text")}</p>${t("onb." + s + ".text2") !== "onb." + s + ".text2" ? `<p>${t("onb." + s + ".text2")}</p>` : ""}</div><div class="onb-vis">${onbVisual(s)}</div></div></div>
    <div class="onb-foot"><label style="display:flex;gap:8px;align-items:center;font-size:13px;color:var(--text-2)"><input type="checkbox" id="onbNever" ${state.ui.onboardingSkip ? "checked" : ""} style="width:auto"> ${t("onb.dontShow")}</label>
      <div class="dots">${ONB_STEPS.map((_, i) => `<i class="${i === onb.i ? "on" : ""}"></i>`).join("")}</div>
      <div class="toolbar"><button class="btn" id="onbBack" ${onb.i ? "" : "disabled"}>${t("onb.back")}</button><button class="btn primary" id="onbNext">${t(last ? "onb.done" : "onb.next")}</button></div></div></div>`;
  const nb = document.getElementById("onbNext"); if (nb) nb.focus({ preventScroll: true });
}
function startOnboarding(force) {
  if (!force && (state.ui.onboardingDone || state.ui.onboardingSkip)) return;
  onb = { i: 0 }; renderOnboarding();
  if (onb.off) onb.off();
  onb.off = trapKeys(document.getElementById("onboardRoot"), () => finishOnboarding());
}
function finishOnboarding() { if (onb && onb.off) onb.off(); onb = null; state.ui.onboardingDone = true; persistUi(); renderOnboarding(); }
document.addEventListener("click", (e) => {
  if (!onb) return;
  if (e.target.closest("#onbNext")) { if (onb.i === ONB_STEPS.length - 1) finishOnboarding(); else { onb.i++; renderOnboarding(); } }
  else if (e.target.closest("#onbBack")) { onb.i = Math.max(0, onb.i - 1); renderOnboarding(); }
  else if (e.target.closest("#onbSkipBtn")) finishOnboarding();
  else if (e.target.closest("#onbLang")) setLang(LANG === "ru" ? "en" : "ru");
});
document.addEventListener("change", (e) => { if (e.target.id === "onbNever") { state.ui.onboardingSkip = e.target.checked; persistUi(); } });
