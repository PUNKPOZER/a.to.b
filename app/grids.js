/* =================== Transition preparation: a bar grid + rough sections measured in the browser =================== */
// Mix points need a bar grid. All-In-One (backend) gives an exact one; without it the grid is measured here from the audio
// (audio/local-grid.js) and always labelled as an estimate.
const gridJobs = { running: new Set(), queued: new Set(), done: 0, total: 0, chain: Promise.resolve(), skip: new Set() };
const hasBarGrid = (tr) => !!trackGrid(tr);
const gridState = (id) => (gridJobs.running.has(id) ? "running" : gridJobs.queued.has(id) ? "queued" : "idle");

async function decodeMono(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const ab = await ctx.decodeAudioData(await blob.arrayBuffer()), mono = new Float32Array(ab.length);
    for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < ab.length; i++) mono[i] += d[i] / ab.numberOfChannels; }
    return { mono, sr: ab.sampleRate };
  } finally { ctx.close(); }
}
async function buildLocalGrid(id) {
  const tr = findTrack(id); if (!tr || hasBarGrid(tr)) return true;
  const blob = await getAudioBlob(id); if (!blob) { gridJobs.skip.add(id); return false; }
  const { mono, sr } = await decodeMono(blob);
  await new Promise((r) => setTimeout(r, 0));
  const r = LocalGrid.analyze(mono, sr, tr.bpm);
  tr.analysis = tr.analysis || {};
  if (!r) { tr.analysis.localGrid = { status: "UNAVAILABLE", bpm: tr.bpm, reason: "no stable beat found" }; persistLibrary(); return false; }
  const bar = (r.downbeats[r.downbeats.length - 1] - r.downbeats[0]) / (r.downbeats.length - 1);
  tr.analysis.localGrid = { status: "AVAILABLE", bpm: tr.bpm, grid: Grid.encode(r.downbeats), firstDownbeat: r.downbeats[0], barSeconds: Math.round(bar * 1000) / 1000, downbeatCount: r.downbeats.length,
    segments: r.segments, barLineRatio: r.barLineRatio, gridStrength: r.gridStrength, shift: 0, createdAt: Date.now() };
  touchTrack(id); persistLibrary(); return true;
}
// queue tracks (sequential: decoding is memory heavy); returns when this batch is done
function prepareGrids(ids) {
  const todo = [...new Set(ids)].filter((id) => { const tr = findTrack(id); return tr && !hasBarGrid(tr) && !gridJobs.running.has(id) && !gridJobs.queued.has(id) && !gridJobs.skip.has(id) && !(tr.analysis && tr.analysis.localGrid && tr.analysis.localGrid.status === "UNAVAILABLE" && tr.analysis.localGrid.bpm === tr.bpm); });
  if (!todo.length) return gridJobs.chain;
  todo.forEach((id) => gridJobs.queued.add(id)); gridJobs.total += todo.length;
  gridJobs.chain = gridJobs.chain.then(async () => {
    for (const id of todo) {
      gridJobs.queued.delete(id); gridJobs.running.add(id); refreshTrackViews(id);
      try { const ok = await buildLocalGrid(id); if (!ok && !(await getAudioBlob(id))) { toast(tx("toast.noAudio")); } }
      catch (e) { console.warn("local grid", e); gridJobs.skip.add(id); const tr = findTrack(id); if (tr) toast(tx("toast.gridFail", { name: tr.title })); }
      gridJobs.running.delete(id); gridJobs.done++; refreshTrackViews(id);
    }
    if (!gridJobs.running.size && !gridJobs.queued.size) { gridJobs.done = 0; gridJobs.total = 0; }
  });
  return gridJobs.chain;
}
const prepareSetGrids = () => prepareGrids(state.currentSet.trackIds);
const gridBusy = () => gridJobs.running.size + gridJobs.queued.size > 0;
