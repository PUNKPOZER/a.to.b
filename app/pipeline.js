/* =================== upload + analysis =================== */
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const folderInput = document.getElementById("folderInput");
const SUPPORTED_EXT = /\.(mp3|wav|aiff?|flac|m4a)$/i;

dropzone.addEventListener("click", e => { if (!e.target.closest("button")) fileInput.click(); });
dropzone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
document.getElementById("pickFilesBtn").addEventListener("click", () => fileInput.click());
document.getElementById("pickFolderBtn").addEventListener("click", () => folderInput.click());
["dragenter","dragover"].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add("dragover"); }));
["dragleave"].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove("dragover"); }));

dropzone.addEventListener("drop", async e => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  const items = e.dataTransfer.items;
  let files = [];
  if (items && items.length && items[0].webkitGetAsEntry) {
    // Folder-aware drop: walk any dropped directories recursively.
    const entries = Array.from(items).map(it => it.webkitGetAsEntry()).filter(Boolean);
    files = (await Promise.all(entries.map(walkEntry))).flat();
  } else {
    files = Array.from(e.dataTransfer.files);
  }
  files = files.filter(f => SUPPORTED_EXT.test(f.name));
  if (files.length) handleFiles(files);
});

function walkEntry(entry) {
  return new Promise(resolve => {
    if (entry.isFile) {
      entry.file(file => resolve([file]), () => resolve([]));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      const readBatch = () => reader.readEntries(async batch => {
        if (!batch.length) { resolve(all); return; }
        const nested = await Promise.all(batch.map(walkEntry));
        nested.forEach(arr => all.push(...arr));
        readBatch(); // directory readers can require several calls to drain fully
      }, () => resolve(all));
      readBatch();
    } else resolve([]);
  });
}

fileInput.addEventListener("change", () => {
  const files = Array.from(fileInput.files).filter(f => SUPPORTED_EXT.test(f.name));
  if (files.length) handleFiles(files);
  fileInput.value = "";
});
folderInput.addEventListener("change", () => {
  const files = Array.from(folderInput.files).filter(f => SUPPORTED_EXT.test(f.name));
  if (files.length) handleFiles(files); else toast("В папке не найдено поддерживаемых аудиофайлов");
  folderInput.value = "";
});

function tick(ms) { return new Promise(r => setTimeout(r, ms)); }

/* progress: a thin line + step words (no spinners) */
function renderProgress(stepIndex, errorMsg) {
  const box = document.getElementById("analyzeProgress");
  box.classList.remove("hidden");
  if (errorMsg) { box.innerHTML = `<div class="status"><span class="s fail"><i class="dot"></i>Analysis failed — ${escapeHtml(errorMsg)}</span></div>`; return; }
  const pct = Math.round(((stepIndex + 1) / ANALYSIS_STEPS.length) * 100);
  box.innerHTML = `<div class="status" role="status"><span class="s run"><i class="dot"></i>${ANALYSIS_STEPS[Math.min(stepIndex, ANALYSIS_STEPS.length - 1)]}</span><span class="mono faint">${stepIndex + 1}/${ANALYSIS_STEPS.length}</span></div><div class="progressline"><i style="width:${pct}%"></i></div>`;
}
function renderBatchProgress(done, total, filename) {
  const box = document.getElementById("analyzeProgress");
  box.classList.remove("hidden");
  const pct = Math.round((done / total) * 100);
  box.innerHTML = `<div class="status" role="status"><span class="s run"><i class="dot"></i>Analyzing ${done}/${total}${filename ? " — " + escapeHtml(filename) : ""}</span></div><div class="progressline"><i style="width:${pct}%"></i></div>`;
}

// Embedded tags (ID3v2): artist / title / cover thumbnail. Missing tags simply stay null.
async function thumbFromPicture(pic) {
  try {
    const bmp = await createImageBitmap(new Blob([pic.data], { type: pic.mime }));
    const c = document.createElement("canvas"); c.width = c.height = 96;
    const side = Math.min(bmp.width, bmp.height), ctx = c.getContext("2d");
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 96, 96);
    return c.toDataURL("image/jpeg", 0.72);
  } catch (e) { return null; }
}
async function readTags(arrayBuffer) {
  try {
    const t = Id3.parse(new Uint8Array(arrayBuffer, 0, Math.min(arrayBuffer.byteLength, 6_000_000)));
    return { title: t.title, artist: t.artist, cover: t.picture ? await thumbFromPicture(t.picture) : null };
  } catch (e) { return { title: null, artist: null, cover: null }; }
}

async function simpleHash(arrayBuffer) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", arrayBuffer.slice(0, Math.min(arrayBuffer.byteLength, 2_000_000)));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,"0")).join("").slice(0,32) + "_" + arrayBuffer.byteLength;
  } catch (e) { return "len" + arrayBuffer.byteLength + "_" + Date.now(); }
}

// Decode + run the DSP pipeline for one file and store it in the library.
// Returns { track, duplicate }. Throws on decode/analysis failure so batch
// callers can catch per-file and keep going.
async function analyzeAndStoreFile(file, progressCb) {
  const arrayBuffer = await file.arrayBuffer();
  const hash = await simpleHash(arrayBuffer);
  const existing = state.library.find(t => t.hash === hash);
  if (existing) {
    // same file dropped again: upgrade an older track (no audio / waveform / advanced analysis yet)
    upgradeTrackAudio(existing, file).catch(e => console.warn("upgrade failed", e));
    return { track: existing, duplicate: true };
  }

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    if (progressCb) progressCb(1);
    if (progressCb) progressCb(2);
    if (progressCb) progressCb(3);

    const nCh = audioBuffer.numberOfChannels, len = audioBuffer.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < nCh; c++) { const d = audioBuffer.getChannelData(c); for (let i=0;i<len;i++) mono[i] += d[i]/nCh; }

    // Essentia.js runs in a worker (WASM); any failure degrades to legacy-only.
    const essentia = window.EssentiaLocal
      ? await EssentiaLocal.analyze(mono, audioBuffer.sampleRate, 90)
      : { status: "UNAVAILABLE", reason: "essentia client not loaded" };
    const result = analyzeChannelData(mono, audioBuffer.sampleRate, { maxSeconds: 90, essentia });
    if (progressCb) [4,5,6,7,8,9].forEach(progressCb);

    const id = "t_" + Math.random().toString(36).slice(2,10);
    const tags = await readTags(arrayBuffer);
    const track = {
      id, hash, filename: file.name, artist: tags.artist || "Unknown artist",
      title: tags.title || file.name.replace(/\.[^.]+$/, ""), cover: tags.cover || null,
      format: (file.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toUpperCase() || "", sampleRate: audioBuffer.sampleRate,
      durationSec: audioBuffer.duration, analyzedSeconds: result.analyzedSeconds, truncated: result.truncated,
      bpm: result.bpm, key: result.key, genre: result.genre, profile: result.profile,
      structure: result.structure, featureGroups: result.featureGroups, unknownFields: result.unknownFields,
      analysis: result.analysis, manualOverrides: {},
      waveform: Waveform.encode(Waveform.compute(mono, audioBuffer.sampleRate)),
      analyzedAt: Date.now(),
    };
    state.library.push(track);
    persistLibrary();
    keepAudio(id, file);      // keeps the track playable / re-analyzable (IndexedDB + in-memory fallback)
    queueAdvanced(id, file);  // background; never blocks the UI
    return { track, duplicate: false };
  } finally {
    audioCtx.close();
  }
}

async function handleFiles(files) {
  document.getElementById("analyzeProgress").classList.add("hidden");
  if (state.tab !== "analyze") setActiveTab("analyze");

  if (files.length === 1) {
    // single file: show the step readout
    renderProgress(0);
    await tick(50);
    try {
      const { track, duplicate } = await analyzeAndStoreFile(files[0], (step) => { renderProgress(step); });
      renderProgress(9); await tick(80);
      document.getElementById("analyzeProgress").classList.add("hidden");
      onTrackReady(track.id);
      toast(duplicate ? "Already in library: " + track.title : "Analyzed: " + track.title);
    } catch (err) {
      console.error(err);
      renderProgress(0, err.message || String(err));
    }
    return;
  }

  // batch (folder / multi-select): compact progress, keep going on individual errors
  let okCount = 0, dupCount = 0, errCount = 0, lastTrackId = null;
  for (let i = 0; i < files.length; i++) {
    renderBatchProgress(i, files.length, files[i].name);
    try {
      const { track, duplicate } = await analyzeAndStoreFile(files[i]);
      lastTrackId = track.id;
      duplicate ? dupCount++ : okCount++;
      renderFilterTags();
    } catch (err) {
      console.error("Failed to analyze", files[i].name, err);
      errCount++;
    }
    await tick(10); // yield to the UI between files
  }
  renderBatchProgress(files.length, files.length);
  await tick(150);
  document.getElementById("analyzeProgress").classList.add("hidden");
  const parts = [`Analyzed: ${okCount}`];
  if (dupCount) parts.push(`already there: ${dupCount}`);
  if (errCount) parts.push(`failed: ${errCount}`);
  toast(parts.join(" · "));
  if (lastTrackId) onTrackReady(lastTrackId);
}

function onTrackReady(id) {
  state.currentTrackId = id;
  state.libRef = id;
  state.trackTab = "overview";
  renderFilterTags();
  if (state.tab !== "analyze") setActiveTab("analyze"); else renderActiveView();
}
// every track click in the app opens the track page in Analyze
function openTrack(id, tab) { if (tab) state.trackTab = tab; state.currentTrackId = id; state.libRef = id; if (state.tab !== "analyze") setActiveTab("analyze"); else renderActiveView(); }
const showTrackDetail = (id) => openTrack(id);
