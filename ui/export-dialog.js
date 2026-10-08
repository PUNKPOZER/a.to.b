/* =================== Export dialog: Rekordbox XML, M3U8, TXT tracklist, Transition Sheet =================== */
const LS_BASEDIR = "atob_basedir";
let exportOpts = { format: "rekordbox", cues: true, beatGrid: false };

function exportTrack(tr) {
  const g = trackGrid(tr);
  return { id: tr.id, artist: tr.artist === UNKNOWN_ARTIST ? "" : tr.artist, title: tr.title, album: tr.album || "", genre: tr.genre ? tr.genre.primary : "", filename: tr.filename, relPath: tr.relPath || null, path: tr.path || null,
    durationSec: tr.durationSec, bpm: tr.bpm, key: tr.key, format: tr.format, sampleRate: tr.sampleRate, sizeBytes: tr.sizeBytes || null,
    grid: g && g.kind === "analyzed" ? { first: g.downbeats[0], bpm: tr.bpm } : null };   // only an analysed grid is exported as a beat grid
}
function exportTransitions(tracks) {
  return tracks.slice(0, -1).map((a, i) => {
    const tr = transitionOf(a, tracks[i + 1]), g = tr.guide; if (!g || !g.available) return null;
    return { mixOutTime: g.mixOut.time, mixInTime: g.mixIn.time, bars: g.bars, type: g.type.key, compatibility: tr.compat.overall, confidence: g.confidence.level, confidenceLabel: t("conf." + g.confidence.level).toLowerCase(), manual: g.manual,
      mixOut: { section: g.mixOut.section ? secLabel(g.mixOut.section) : null, bar: g.mixOut.bar }, mixIn: { section: g.mixIn.section ? secLabel(g.mixIn.section) : null, bar: g.mixIn.bar } };
  });
}
const exportLabels = () => ({ bars: t("unit.bars"), cut: t("guide.cut"), tracks: t("sb.tracks").toLowerCase(), transitions: t("exp.transitions"), trackA: t("exp.trackA"), trackB: t("exp.trackB"), mixOut: t("guide.mixOut").toLowerCase(), mixIn: t("guide.mixIn").toLowerCase(), bar: t("exp.bar"), confidence: t("guide.confidence").toLowerCase(), manual: t("common.manual"),
  typeNames: Object.fromEntries(Transition.TYPES.map((k) => [k, t("ttype." + k)])) });
function exportBaseDir() { try { return localStorage.getItem(LS_BASEDIR) || ""; } catch (e) { return ""; } }
function exportContext(tracks) {
  return { tracks: tracks.map(exportTrack), transitions: exportTransitions(tracks), name: cur().name, baseDir: exportBaseDir(), cues: exportOpts.cues, beatGrid: exportOpts.beatGrid, labels: exportLabels(), version: APP_VERSION, comment: "" };
}
function buildExport() { const ctx = exportContext(setTracks()), F = SetExport.FORMATS[exportOpts.format]; return { text: F.build(ctx), ext: F.ext, mime: F.mime, ctx }; }

function openExportDialog() {
  const tracks = setTracks(); if (!tracks.length) { toast(t("sb.empty")); return; }
  const dlg = openModal("", "wide"); renderExport(dlg);
}
function renderExport(dlg) {
  dlg = dlg || document.querySelector("#modalRoot .dialog"); if (!dlg) return;
  const tracks = setTracks(), ctx = exportContext(tracks), v = SetExport.validate(ctx.tracks, { baseDir: ctx.baseDir });
  const needsPath = exportOpts.format === "rekordbox" || exportOpts.format === "m3u8", anyNoAbs = ctx.tracks.some((x) => !x.path);
  const formats = [["rekordbox", "exp.f.rekordbox"], ["m3u8", "exp.f.m3u8"], ["txt", "exp.f.txt"], ["sheet", "exp.f.sheet"], ["sheetjson", "exp.f.sheetjson"]];
  const issueText = (x) => t("exp.issue." + x.code, { n: x.index + 1, name: UI.esc(tracks[x.index] ? tracks[x.index].title : ""), f: x.format || "" });
  const real = v.issues.filter((x) => !(x.code === "noLocation" && !needsPath));
  dlg.innerHTML = `<div class="dhead"><h3>${t("exp.title")}</h3><button class="iconbtn" data-close-modal aria-label="${UI.esc(t("common.close"))}">${UI.icon("close")}</button></div>
    <label class="lab">${t("exp.format")}</label><div class="tagrow">${formats.map(([k, l]) => `<button class="chip ${exportOpts.format === k ? "on" : ""}" data-expfmt="${k}">${t(l)}</button>`).join("")}</div>
    ${exportOpts.format === "rekordbox" ? `<div style="margin-top:12px;display:grid;gap:8px">
      <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="expCues" ${exportOpts.cues ? "checked" : ""} style="width:auto"> ${t("exp.cues")}${UI.help("expcues")}</label>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px"><input type="checkbox" id="expGrid" ${exportOpts.beatGrid ? "checked" : ""} style="width:auto"> ${t("exp.beatGrid")}${UI.help("expgrid")}</label></div>` : ""}
    ${needsPath ? `<label class="lab" for="expBase">${t("exp.baseDir")}${UI.help("expbase")}</label><input id="expBase" value="${UI.esc(ctx.baseDir)}" placeholder="${UI.esc(t("exp.baseDirPh"))}" autocomplete="off">
      <div class="mono faint" style="margin-top:6px">${anyNoAbs ? t("exp.baseDirWhy") : t("exp.pathsKnown")}</div>` : ""}
    ${UI.sectionHead(t("exp.validation"), v.ok || !real.length ? "" : t("exp.attention", { n: v.needAttention }))}
    ${real.length ? `<ul class="why">${real.slice(0, 8).map((x) => `<li class="warn">${issueText(x)}</li>`).join("")}${real.length > 8 ? `<li class="none">+${real.length - 8}</li>` : ""}</ul>` : `<ul class="why"><li>${t("exp.allOk", { n: tracks.length })}</li></ul>`}
    ${exportOpts.format === "rekordbox" ? `<details style="margin-top:16px"><summary class="label" style="cursor:pointer">${t("exp.guideTitle")}</summary><ol class="mono" style="margin:10px 0 0;padding-left:18px;display:grid;gap:6px;line-height:1.5;color:var(--text-2)">${[1, 2, 3, 4, 5].map((n) => `<li>${t("exp.guide." + n)}</li>`).join("")}</ol><p class="mono faint" style="margin-top:10px">${t("exp.guideNote")}</p></details>` : ""}
    <div class="row"><button class="btn" data-close-modal>${t("common.close")}</button>${exportOpts.format !== "rekordbox" || true ? `<button class="btn" id="expCopy">${t("exp.copy")}</button>` : ""}<button class="btn primary" id="expDownload">${UI.icon("download")}${t("exp.download")}</button></div>`;
}
function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" }), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
document.addEventListener("click", async (e) => {
  if (!e.target.closest("#modalRoot")) return;
  const f = e.target.closest("[data-expfmt]"); if (f) { exportOpts.format = f.dataset.expfmt; renderExport(); return; }
  if (e.target.closest("#expDownload")) { const x = buildExport(), name = cur().name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "set"; downloadText(x.text, name + (exportOpts.format.startsWith("sheet") ? " (transitions)" : "") + "." + x.ext, x.mime); toast(t("exp.saved")); return; }
  if (e.target.closest("#expCopy")) { try { await navigator.clipboard.writeText(buildExport().text); toast(t("exp.copied")); } catch (er) { toast(t("exp.copyFail")); } return; }
});
document.addEventListener("change", (e) => {
  if (!e.target.closest || !e.target.closest("#modalRoot")) return;
  if (e.target.id === "expCues") exportOpts.cues = e.target.checked;
  if (e.target.id === "expGrid") exportOpts.beatGrid = e.target.checked;
  if (e.target.id === "expBase") { try { localStorage.setItem(LS_BASEDIR, e.target.value.trim()); } catch (er) {} renderExport(); }
});
