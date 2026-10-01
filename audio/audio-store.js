/* Persists the original audio files in IndexedDB so tracks stay playable (and
 * can be re-sent to the analysis backend) after a reload. Never throws:
 * every call resolves (false/null on failure, e.g. private mode / quota). */
(function () {
  const DB = "selector-audio", STORE = "files";
  let dbp = null;
  function open() {
    if (!dbp) dbp = new Promise((resolve) => {
      try {
        const rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then((db) => !db ? null : new Promise((resolve) => {
      try {
        const t = db.transaction(STORE, mode), r = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : true);
        t.onerror = t.onabort = () => resolve(null);
      } catch (e) { resolve(null); }
    }));
  }
  window.AudioStore = {
    put: (id, blob) => tx("readwrite", (s) => s.put(blob, id)).then((r) => r === true || r !== null),
    get: (id) => tx("readonly", (s) => s.get(id)).then((r) => (r && r !== true ? r : null)),
    del: (id) => tx("readwrite", (s) => s.delete(id)),
    clear: () => tx("readwrite", (s) => s.clear()),
  };
})();
