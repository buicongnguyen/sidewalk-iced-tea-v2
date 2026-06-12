// Local-first persistence: IndexedDB primary, localStorage mirror + backup.

import { SAVE_DB_NAME, SAVE_STORE, SAVE_SLOT, SAVE_LS_KEY, SAVE_LS_BACKUP } from "./config.js";

export function createStorage() {
  return {
    db: null,
    mode: "indexeddb",
    status: "booting",
    inFlight: false,

    async init() {
      try {
        this.db = await openDatabase();
        this.mode = "indexeddb";
        this.status = "ready";
      } catch (error) {
        console.warn("IndexedDB unavailable, falling back to localStorage.", error);
        this.mode = "localstorage";
        this.status = "fallback";
      }
    },

    async load() {
      try {
        let idbData = null;
        if (this.mode === "indexeddb" && this.db) {
          idbData = await idbGet(this.db, SAVE_SLOT).catch(() => null);
        }
        const lsData = parseFirst(
          localStorage.getItem(SAVE_LS_KEY),
          localStorage.getItem(SAVE_LS_BACKUP),
        );
        // a reload can land between the sync localStorage write and the async
        // IndexedDB write — always trust the newer snapshot
        const newest = [idbData, lsData]
          .filter(Boolean)
          .sort((a, b) => (Number(b?.lastSavedAt) || 0) - (Number(a?.lastSavedAt) || 0))[0] ?? null;
        this.status = newest ? "loaded" : "ready";
        return newest;
      } catch (error) {
        console.warn("Save load failed; starting clean.", error);
        this.status = "recovered";
        return null;
      }
    },

    async persist(state, reason = "autosave") {
      // coalesce overlapping saves instead of dropping them: the most recent
      // request always wins, so quick upgrade->reload sequences never lose data
      this.queued = { state, reason };
      if (this.inFlight) return;
      this.inFlight = true;
      try {
        while (this.queued) {
          const job = this.queued;
          this.queued = null;
          const snapshot = structuredClone(job.state);
          snapshot.lastSavedAt = Date.now();
          // localStorage first: synchronous, survives even an instant reload
          try {
            const json = JSON.stringify(snapshot);
            localStorage.setItem(SAVE_LS_KEY, json);
            localStorage.setItem(SAVE_LS_BACKUP, json);
          } catch (error) {
            console.warn("localStorage save failed.", error);
          }
          if (this.mode === "indexeddb" && this.db) {
            await idbPut(this.db, SAVE_SLOT, snapshot);
          }
          this.status = job.reason;
        }
      } catch (error) {
        console.error("Failed to save game state.", error);
        this.status = "save error";
      } finally {
        this.inFlight = false;
        this.queued = null;
      }
    },

    async clear() {
      try {
        if (this.mode === "indexeddb" && this.db) {
          await idbDelete(this.db, SAVE_SLOT);
        }
      } catch (error) {
        console.warn("Failed to clear IndexedDB slot.", error);
      }
      localStorage.removeItem(SAVE_LS_KEY);
      localStorage.removeItem(SAVE_LS_BACKUP);
      this.status = "reset";
    },
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }
    const request = indexedDB.open(SAVE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SAVE_STORE)) {
        db.createObjectStore(SAVE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAVE_STORE, "readonly");
    const request = tx.objectStore(SAVE_STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAVE_STORE, "readwrite");
    const request = tx.objectStore(SAVE_STORE).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function idbDelete(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SAVE_STORE, "readwrite");
    const request = tx.objectStore(SAVE_STORE).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function parseFirst(...sources) {
  for (const raw of sources) {
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn("Unreadable save source, trying next.", error);
    }
  }
  return null;
}
