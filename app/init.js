/* =================== init =================== */
// a status that was mid-flight when the page closed can never complete: settle it
state.library.forEach((tr) => { if (tr.analysis && ["QUEUED", "ADVANCED_ANALYSIS", "STRUCTURE_ANALYSIS", "SONIC_EMBEDDING"].includes(tr.analysis.status)) tr.analysis.status = "LOCAL_ANALYSIS"; });
// genre from stored Discogs-EffNet style activations (tracks analysed before this existed)
state.library.forEach((tr) => { if (tr.analysis && tr.analysis.sonic && tr.genre && tr.genre.method !== "discogs-effnet") applyGenreFromSonic(tr); });
// stored data from the NOESIS versions keeps working: unknown fields are simply absent, nothing is re-analysed
state.library.forEach((tr) => { if (!tr.analysisVersion) tr.analysisVersion = (tr.analysis && tr.analysis.version) || 1; });
persistLibrary();
document.getElementById("searchIcon") && (document.getElementById("searchIcon").innerHTML = UI.icon("search"));
mountPlayerIcons();
applyStaticI18n();
renderChrome();
updateTransportUI();
setActiveTab((location.hash || "#analyze").slice(1), { push: false });
window.addEventListener("hashchange", () => setActiveTab((location.hash || "#analyze").slice(1), { push: false }));
refreshBackendPill();
// the backend may start after the page (desktop app launches it in the background): keep the status honest
setInterval(() => { if (!document.hidden && BackendClient.apiUrl()) refreshBackendPill(); }, 15000);
startOnboarding(false);
libFolderInit();

