/* =================== Player, queue and waveform binding =================== */
const player = { audio: new Audio(), id: null, url: null, wf: null, raf: 0 };
player.audio.preload = "auto";
player.audio.volume = 0.9;
const waveCanvases = new Map(); // canvas element -> track id

function trackWaveform(id) { const t = findTrack(id); return t && t.waveform ? Waveform.decode(t.waveform) : null; }
function structureOf(t) { const st = t && t.analysis && t.analysis.structure; return st && st.status === "AVAILABLE" && st.segments ? st : null; }

// draw options per canvas kind: the main waveform carries section labels + timestamps, small ones only a thin strip
function waveOpts(canvas, id) {
  const t = findTrack(id), st = structureOf(t), kind = canvas.dataset.kind || "main";
  const o = { style: kind === "main" || kind === "mid" ? state.waveStyle : "mono", ruler: kind === "main", duration: t ? t.durationSec : 0 };
  if (st && t.durationSec) { o.segments = st.segments; if (kind === "row") o.strip = 0; }
  return o;
}
function bindWave(canvas, id) {
  waveCanvases.set(canvas, id);
  canvas._wf = null;
  canvas.onclick = (e) => { const r = canvas.getBoundingClientRect(); playTrack(id, Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); };
  redrawWaves();
}
function redrawWaves() {
  waveCanvases.forEach((id, canvas) => {
    if (!canvas.isConnected) { waveCanvases.delete(canvas); return; }
    const d = player.audio.duration;
    const prog = player.id === id && isFinite(d) && d > 0 ? player.audio.currentTime / d : 0;
    Waveform.draw(canvas, canvas._wf ||= trackWaveform(id), prog, waveOpts(canvas, id));
  });
}
function seekTo(id, sec) { const t = findTrack(id); if (!t || !t.durationSec) return; playTrack(id, Math.max(0, Math.min(1, sec / t.durationSec))); }

// preview: jump past the intro (first section the analyzer didn't call intro), else ~25% in
function previewStart(t) {
  const st = structureOf(t);
  if (st && t.durationSec) { const s = st.segments.find((sg) => sg.label !== "intro" && sg.label !== "start"); if (s) return s.start / t.durationSec; }
  return 0.25;
}
function playPreview(id) {
  const t = findTrack(id); if (!t) return;
  if (player.id === id && !player.audio.paused) { player.audio.pause(); return; }
  playTrack(id, player.id === id ? null : previewStart(t));
}

/* ---- transport UI ---- */
function mountPlayerIcons() {
  const set = (id, name) => { const el = document.getElementById(id); if (el) el.innerHTML = UI.icon(name); };
  set("pbShuffle", "shuffle"); set("pbPrev", "prev"); set("pbNext", "next"); set("pbRepeat", "repeat"); set("pbQueue", "queue"); set("pbClose", "close");
  document.getElementById("pbVolIcon").innerHTML = UI.icon("volume", "");
  document.getElementById("pbVolIcon").firstChild.style.cssText = "width:16px;height:16px";
}
function updateTransportUI() {
  const a = player.audio, playing = !a.paused && !a.ended;
  document.getElementById("pbPlay").innerHTML = UI.icon(playing ? "pause" : "play");
  document.getElementById("pbCur").textContent = fmtTime(a.currentTime);
  document.getElementById("pbDur").textContent = fmtTime(a.duration);
  document.getElementById("pbShuffle").classList.toggle("on", state.shuffle); document.getElementById("pbShuffle").setAttribute("aria-pressed", state.shuffle);
  const rp = document.getElementById("pbRepeat"); rp.classList.toggle("on", state.repeat !== "off"); rp.setAttribute("aria-pressed", state.repeat !== "off"); rp.title = "Repeat: " + state.repeat;
  document.querySelectorAll("[data-trackplay]").forEach((b) => { const on = player.id === b.dataset.trackplay && playing; b.innerHTML = UI.icon(on ? "pause" : "play"); b.setAttribute("aria-label", on ? "Pause" : "Play"); });
  document.querySelectorAll("[data-simplay]").forEach((b) => { const on = player.id === b.dataset.simplay && playing; b.classList.toggle("on", on); b.innerHTML = UI.icon(on ? "pause" : "play"); });
}
function uiLoop() { redrawWaves(); updateTransportUI(); player.raf = player.audio.paused ? 0 : requestAnimationFrame(uiLoop); }
["play", "playing"].forEach((ev) => player.audio.addEventListener(ev, () => { if (!player.raf) player.raf = requestAnimationFrame(uiLoop); }));
["pause", "loadedmetadata", "seeked"].forEach((ev) => player.audio.addEventListener(ev, () => { redrawWaves(); updateTransportUI(); }));
player.audio.addEventListener("ended", () => { if (state.repeat === "one") { player.audio.currentTime = 0; player.audio.play(); } else playAdjacent(1, true); redrawWaves(); updateTransportUI(); });

function showPlayer(on) {
    document.getElementById("playerBar").classList.toggle("idle", !on);
}
async function playTrack(id, seekFrac) {
  const t = findTrack(id); if (!t) return;
  if (player.id !== id) {
    const blob = await getAudioBlob(id);
    if (!blob) { toast("This track has no audio file — choose one"); attachAudioPicker(id); return; }
    if (player.url) URL.revokeObjectURL(player.url);
    player.url = URL.createObjectURL(blob);
    player.audio.src = player.url;
    player.id = id; player.wf = trackWaveform(id);
    document.getElementById("pbTitle").textContent = t.title;
    document.getElementById("pbArtist").textContent = t.artist;
    document.getElementById("pbArt").innerHTML = UI.art(t, "xs");
  }
  showPlayer(true);
  const wc = document.getElementById("pbWave"); wc.dataset.kind = "row"; bindWave(wc, id);
  const seek = () => { if (seekFrac != null && isFinite(player.audio.duration)) player.audio.currentTime = seekFrac * player.audio.duration; };
  if (isFinite(player.audio.duration)) seek(); else player.audio.addEventListener("loadedmetadata", seek, { once: true });
  try { await player.audio.play(); } catch (e) { toast("Could not play: " + (e.message || e)); }
  updateTransportUI();
}
function togglePlay(id) { if (player.id === id && !player.audio.paused) player.audio.pause(); else playTrack(id); }
function stopPlayer() {
  player.audio.pause(); player.audio.removeAttribute("src"); player.audio.load();
  if (player.url) URL.revokeObjectURL(player.url);
  player.url = null; player.id = null; player.wf = null;
  document.getElementById("pbTitle").textContent = "Nothing playing"; document.getElementById("pbArtist").textContent = ""; document.getElementById("pbArt").innerHTML = "";
  showPlayer(false); updateTransportUI(); redrawWaves();
}

/* ---- queue: explicit queue first, otherwise library order ---- */
function enqueue(id) { if (!state.queue.includes(id)) state.queue.push(id); toast("Added to queue"); renderQueueIfOpen(); }
function playAdjacent(dir, auto = false) {
  let order = state.queue.length ? state.queue.slice() : state.library.map((t) => t.id);
  if (!order.length) return;
  let i = order.indexOf(player.id);
  if (dir > 0 && state.queue.length && i >= 0) { state.queue.splice(i, 1); order = state.queue.slice(); i = -1; } // consume the queue as it plays
  let next;
  if (state.shuffle && dir > 0) next = order[Math.floor(Math.random() * order.length)];
  else { const j = i < 0 ? (dir > 0 ? 0 : order.length - 1) : i + dir; if (j >= order.length || j < 0) { if (state.repeat === "all" || !auto) next = order[(j + order.length) % order.length]; else { updateTransportUI(); return; } } else next = order[j]; }
  if (next) playTrack(next);
  renderQueueIfOpen();
}
function openQueue() {
  const root = document.getElementById("drawerRoot");
  if (root.firstChild && root.firstChild.dataset.kind === "queue") { root.innerHTML = ""; return; }
  const rows = state.queue.map(findTrack).filter(Boolean);
  root.innerHTML = `<aside class="drawer open" data-kind="queue" aria-label="Queue"><div class="ctx-head"><span class="label">Queue · ${rows.length}</span><button class="iconbtn" data-qclose aria-label="Close">${UI.icon("close")}</button></div>
    ${rows.length ? rows.map((t, i) => `<div class="trow" data-open-track="${t.id}">${`<span class="artplay">${UI.art(t, "sm")}</span>`}<div style="min-width:0"><div class="t1">${escapeHtml(t.title)}</div><div class="t2">${escapeHtml(t.artist)}</div></div><button class="iconbtn" data-qremove="${i}" aria-label="Remove">${UI.icon("close")}</button></div>`).join("") : `<div class="empty">Queue is empty. Use “Add to → Queue” on any track.</div>`}</aside>`;
  root.querySelector("[data-qclose]").onclick = () => (root.innerHTML = "");
  root.querySelectorAll("[data-qremove]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); state.queue.splice(+b.dataset.qremove, 1); openQueue(); openQueue(); }));
}
function renderQueueIfOpen() { const r = document.getElementById("drawerRoot"); if (r.firstChild && r.firstChild.dataset.kind === "queue") { r.innerHTML = ""; openQueue(); } }

document.getElementById("pbPlay").addEventListener("click", () => { if (player.id) togglePlay(player.id); else if (state.currentTrackId) playTrack(state.currentTrackId); else if (state.library[0]) playTrack(state.library[0].id); });
document.getElementById("pbPrev").addEventListener("click", () => { if (player.audio.currentTime > 3) player.audio.currentTime = 0; else playAdjacent(-1); });
document.getElementById("pbNext").addEventListener("click", () => playAdjacent(1));
document.getElementById("pbShuffle").addEventListener("click", () => { state.shuffle = !state.shuffle; updateTransportUI(); });
document.getElementById("pbRepeat").addEventListener("click", () => { state.repeat = { off: "all", all: "one", one: "off" }[state.repeat]; updateTransportUI(); });
document.getElementById("pbQueue").addEventListener("click", openQueue);
document.getElementById("pbClose").addEventListener("click", stopPlayer);
document.getElementById("pbVol").addEventListener("input", (e) => { player.audio.volume = +e.target.value; });
window.addEventListener("resize", redrawWaves);
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || !player.id) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (/^(input|textarea|select|button)$/.test(tag) || e.target.isContentEditable) return;
  e.preventDefault(); togglePlay(player.id);
});
// delegated: any element with data-simplay plays a preview; any trow with data-open-track opens the track page
document.addEventListener("click", (e) => {
  const p = e.target.closest("[data-simplay]");
  if (p) { e.stopPropagation(); playPreview(p.dataset.simplay); return; }
  const tp = e.target.closest("[data-trackplay]");
  if (tp) { togglePlay(tp.dataset.trackplay); return; }
});
