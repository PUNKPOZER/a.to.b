/* =================== Music folder (desktop app): analyze straight from the folder, no copies =================== */
// The browser cannot see folders on disk; the desktop app can. Pick a folder once: a.to.b lists its audio files, tells you which
// are new, analyzes them one at a time in the background and plays them directly from the folder (no copy in IndexedDB).
const LibFolder = { dir: null, files: [], known: 0, fresh: [], scanning: false, importing: null };
const hasDesktopLibrary = () => !!(window.atobDesktop && window.atobDesktop.library);
const MIME_BY_EXT = { mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", m4a: "audio/mp4", aif: "audio/aiff", aiff: "audio/aiff" };

async function libFolderInit() {
  if (!hasDesktopLibrary()) return;
  const r = await atobDesktop.library.get(); LibFolder.dir = r.dir;
  if (LibFolder.dir) libFolderScan(true);
}
// compares the folder with the library; tracks imported earlier by name + size are linked to their file (their stored copy is dropped)
async function libFolderScan(quiet) {
  if (!hasDesktopLibrary() || !LibFolder.dir) return;
  LibFolder.scanning = true; if (state.tab === "library") renderActiveView();
  const r = await atobDesktop.library.scan(); LibFolder.files = r.files || []; LibFolder.dir = r.dir;
  const byRel = new Map(state.library.filter((x) => x.libRel).map((x) => [x.libRel, x])), bySig = new Map(state.library.filter((x) => x.sizeBytes).map((x) => [x.filename + "|" + x.sizeBytes, x]));
  let linked = 0; LibFolder.fresh = []; LibFolder.known = 0;
  for (const f of LibFolder.files) {
    const base = f.rel.split("/").pop();
    if (byRel.has(f.rel)) { LibFolder.known++; continue; }
    const old = bySig.get(base + "|" + f.size);
    if (old) { old.libRel = f.rel; old.path = f.path; AudioStore.del(old.id); sessionFiles.delete(old.id); old.hasAudio = false; LibFolder.known++; linked++; continue; }
    LibFolder.fresh.push(f);
  }
  if (linked) persistLibrary();
  LibFolder.scanning = false;
  if (!quiet && !LibFolder.fresh.length) toast(t("folder.noNew"));
  if (state.tab === "library" || state.tab === "analyze") renderActiveView();
}
async function libFolderPick() {
  const r = await atobDesktop.library.pick(); if (r.canceled && !r.dir) return;
  LibFolder.dir = r.dir; await libFolderScan(true);
  if (LibFolder.fresh.length) libFolderImport();
  else toast(t("folder.noNew"));
}
async function libFolderForget() {
  if (!(await askConfirm(t("folder.forgetAsk"), t("folder.forget"), false))) return;
  await atobDesktop.library.clear(); Object.assign(LibFolder, { dir: null, files: [], known: 0, fresh: [] }); renderActiveView();
}
// analyze the new files one by one; the heavy work is in workers, so the UI stays usable
async function libFolderImport() {
  if (LibFolder.importing || !LibFolder.fresh.length) return;
  const todo = LibFolder.fresh.slice(); LibFolder.importing = { done: 0, total: todo.length }; let ok = 0, fail = 0, last = null;
  for (const f of todo) {
    renderBatchProgress(LibFolder.importing.done, todo.length, f.rel.split("/").pop());
    try {
      const resp = await fetch(atobDesktop.library.url(f.rel)); if (!resp.ok) throw new Error("HTTP " + resp.status);
      const name = f.rel.split("/").pop(), ext = (name.split(".").pop() || "").toLowerCase();
      const file = new File([await resp.blob()], name, { type: MIME_BY_EXT[ext] || "" });
      Object.defineProperty(file, "_libRel", { value: f.rel }); Object.defineProperty(file, "_abs", { value: f.path }); Object.defineProperty(file, "_rel", { value: f.rel });
      const r = await analyzeAndStoreFile(file); last = r.track.id; ok++;
    } catch (e) { console.warn("folder import", f.rel, e); fail++; }
    LibFolder.importing.done++; await tick(40);   // breathe: keep the UI and the audio playback smooth
  }
  LibFolder.importing = null; document.getElementById("analyzeProgress").classList.add("hidden");
  toast([t("import.summaryOk", { n: ok }), fail ? t("import.summaryFail", { n: fail }) : ""].filter(Boolean).join(" · "));
  await libFolderScan(true);
  if (last && state.tab === "analyze") onTrackReady(last);
}
function libFolderPanel() {
  if (!hasDesktopLibrary()) return "";
  const L = LibFolder, busy = !!L.importing;
  if (!L.dir) return `<div class="folderbar"><div><b>${t("folder.title")}</b><div class="dim" style="font-size:12px;margin-top:2px">${t("folder.hint")}</div></div><button class="btn primary" id="folderPick">${UI.icon("folder")}${t("folder.choose")}</button></div>`;
  return `<div class="folderbar"><div style="min-width:0"><b>${t("folder.title")}</b> <span class="mono dim" style="word-break:break-all">${UI.esc(L.dir)}</span>
      <div class="mono faint" style="font-size:11px;margin-top:4px">${L.scanning ? t("folder.scanning") : t("folder.stats", { found: L.files.length, known: L.known, fresh: L.fresh.length })}</div></div>
    <div class="toolbar">${L.fresh.length ? `<button class="btn primary" id="folderImport" ${busy ? "disabled" : ""}>${busy ? t("folder.importing", { done: L.importing.done, total: L.importing.total }) : t("folder.importNew", { n: L.fresh.length })}</button>` : ""}
      <button class="btn" id="folderRescan" ${L.scanning || busy ? "disabled" : ""}>${t("folder.rescan")}</button><button class="btn" id="folderPick">${t("folder.change")}</button><button class="linkbtn" id="folderForget">${t("folder.forget")}</button></div></div>`;
}
document.addEventListener("click", (e) => {
  if (e.target.closest("#folderPick")) libFolderPick();
  else if (e.target.closest("#folderRescan")) libFolderScan(false);
  else if (e.target.closest("#folderImport")) libFolderImport();
  else if (e.target.closest("#folderForget")) libFolderForget();
});
window.addEventListener("focus", () => { if (hasDesktopLibrary() && LibFolder.dir && !LibFolder.importing && !LibFolder.scanning) libFolderScan(true); });
