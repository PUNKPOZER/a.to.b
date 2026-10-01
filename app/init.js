/* =================== init =================== */
// a status that was mid-flight when the page closed can never complete: settle it
state.library.forEach((t) => { if (t.analysis && ["ADVANCED_ANALYSIS", "STRUCTURE_ANALYSIS", "SONIC_EMBEDDING"].includes(t.analysis.status)) t.analysis.status = "LOCAL_ANALYSIS"; });
// genre from stored Discogs-EffNet style activations (tracks analysed before this existed)
state.library.forEach((t) => { if (t.analysis && t.analysis.sonic && t.genre && t.genre.method !== "discogs-effnet") applyGenreFromSonic(t); });
persistLibrary();
// icons + brand
document.getElementById("brandMark").innerHTML = UI.logo(28);
document.getElementById("searchIcon").innerHTML = UI.icon("search");
document.getElementById("settingsBtn").innerHTML = UI.icon("gear");
mountPlayerIcons();
updateTransportUI();
renderFilterTags();
setActiveTab((location.hash || "#analyze").slice(1), { push: false });
window.addEventListener("hashchange", () => setActiveTab((location.hash || "#analyze").slice(1), { push: false }));
refreshBackendPill();
// the backend may start after the page (desktop app launches it in the background): keep the status honest
setInterval(() => { if (!document.hidden && BackendClient.apiUrl()) refreshBackendPill(); }, 15000);
