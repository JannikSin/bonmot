// IndexedDB persistence + export/import. IndexedDB (not localStorage)
// because navigator.storage.persist() only protects quota-managed
// storage on iOS. Even so, iOS can evict; the export file is the real
// durability layer and the UI nags when the last backup is stale.

const DB_NAME = "bonmot";
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("progress"))
        db.createObjectStore("progress", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req instanceof IDBRequest ? req.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function loadProgress() {
  const db = await openDb();
  const rows = await tx(db, "progress", "readonly", (s) => s.getAll());
  return new Map(rows.map((r) => [r.id, r]));
}

export async function saveProgress(record) {
  const db = await openDb();
  await tx(db, "progress", "readwrite", (s) => s.put(record));
}

export async function saveProgressBulk(records) {
  const db = await openDb();
  await tx(db, "progress", "readwrite", (s) => {
    for (const r of records) s.put(r);
  });
}

export async function loadMeta() {
  const db = await openDb();
  const val = await tx(db, "meta", "readonly", (s) => s.get("meta"));
  return val || {};
}

export async function saveMeta(meta) {
  const db = await openDb();
  await tx(db, "meta", "readwrite", (s) => s.put(meta, "meta"));
}

/** Ask the browser to protect this origin's storage from eviction. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    /* unsupported: nothing to do */
  }
  return false;
}

// ---------- export / import ----------

export async function exportState() {
  const progress = await loadProgress();
  const meta = await loadMeta();
  return {
    app: "bonmot",
    version: 1,
    exportedAt: new Date().toISOString(),
    meta,
    progress: [...progress.values()],
  };
}

const STATES = new Set(["learning", "known", "buried"]);

/** Clamp a number into [lo, hi]; fall back when not finite. */
function num(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function validDate(v, fallback) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

/**
 * Pure validation of an import payload. Clamps SRS numbers, drops
 * unknown word ids and malformed records. Never throws on bad data;
 * returns what survived plus a drop count.
 * @param {any} data parsed JSON
 * @param {Set<string>} bankIds valid word ids
 */
export function validateImport(data, bankIds) {
  if (!data || data.app !== "bonmot" || !Array.isArray(data.progress)) {
    return { ok: false, reason: "Not a Bonmot backup file." };
  }
  const nowIso = new Date().toISOString();
  const cleaned = [];
  let dropped = 0;
  for (const r of data.progress) {
    if (!r || typeof r.id !== "string" || !bankIds.has(r.id) || !r.card) {
      dropped++;
      continue;
    }
    const c = r.card;
    cleaned.push({
      id: r.id,
      state: STATES.has(r.state) ? r.state : "learning",
      addedAt: validDate(r.addedAt, nowIso),
      resurfaceAt: r.resurfaceAt ? validDate(r.resurfaceAt, null) : null,
      resurfaceDone: !!r.resurfaceDone,
      card: {
        due: validDate(c.due, nowIso),
        stability: num(c.stability, 0, 36500, 0),
        difficulty: num(c.difficulty, 1, 10, 5),
        elapsed_days: num(c.elapsed_days, 0, 36500, 0),
        scheduled_days: num(c.scheduled_days, 0, 36500, 0),
        learning_steps: num(c.learning_steps, 0, 10, 0),
        reps: num(c.reps, 0, 1e6, 0),
        lapses: num(c.lapses, 0, 1e6, 0),
        state: num(c.state, 0, 3, 0),
        last_review: c.last_review ? validDate(c.last_review, null) : null,
      },
    });
  }
  const meta = data.meta && typeof data.meta === "object" ? data.meta : {};
  return { ok: true, cleaned, meta, dropped };
}

/**
 * Atomic import: snapshot current state, replace, restore on failure.
 */
export async function importState(data, bankIds) {
  const verdict = validateImport(data, bankIds);
  if (!verdict.ok) return verdict;
  const snapProgress = await loadProgress();
  const snapMeta = await loadMeta();
  try {
    const db = await openDb();
    await tx(db, "progress", "readwrite", (s) => {
      s.clear();
      for (const r of verdict.cleaned) s.put(r);
    });
    await saveMeta({ ...verdict.meta, lastBackup: snapMeta.lastBackup });
    return verdict;
  } catch (err) {
    await saveProgressBulk([...snapProgress.values()]);
    await saveMeta(snapMeta);
    return { ok: false, reason: "Import failed, previous progress restored." };
  }
}
