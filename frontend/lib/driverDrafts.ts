// What a driver has entered for a stop but not yet finished — receiver
// name, the proof photo and the GPS reading + time it was taken at — kept
// in IndexedDB so a refresh, a closed tab or a phone that drops the page
// while the camera is open loses nothing. The delivery is recorded at the
// photo's place and time however late Done is tapped.
//
// Best-effort throughout: private mode or blocked storage just means the
// draft lives only as long as the page, as it used to.

export type DraftFix = { latitude: number; longitude: number; accuracy?: number };

export type StopDraft = {
  stopId: string;
  receivedBy?: string;
  // Dropped once uploaded — the server has it then (hasProofPhoto).
  photo?: File;
  photoFix?: DraftFix;
  photoTakenAt?: string;
  savedAt: number;
};

const DB_NAME = 'waresys-driver';
const STORE = 'stopDrafts';
// Older than this is a draft for a stop nobody is coming back to.
export const DRAFT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'stopId' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Older browsers can hand a stored File back as a plain Blob.
function asFile(photo: Blob | undefined): File | undefined {
  if (!photo) return undefined;
  if (photo instanceof File) return photo;
  return new File([photo], 'photo.jpg', { type: photo.type || 'image/jpeg' });
}

export async function listDrafts(): Promise<StopDraft[]> {
  try {
    const rows = await run<StopDraft[]>('readonly', (s) => s.getAll() as IDBRequest<StopDraft[]>);
    return rows.map((r) => ({ ...r, photo: asFile(r.photo) }));
  } catch {
    return [];
  }
}

// Merges into what's saved; a field set to undefined is removed.
export async function saveDraft(stopId: string, patch: Partial<Omit<StopDraft, 'stopId' | 'savedAt'>>) {
  try {
    // Read and write in one transaction, so a keystroke saving the name
    // can't race a photo save and drop it.
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const get = store.get(stopId);
      get.onsuccess = () => {
        const next: StopDraft = { ...((get.result as StopDraft | undefined) ?? { stopId }), ...patch, stopId, savedAt: Date.now() };
        for (const k of Object.keys(next) as (keyof StopDraft)[]) {
          if (next[k] === undefined) delete next[k];
        }
        store.put(next);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // storage blocked — the draft lives only in the page
  }
}

export async function deleteDraft(stopId: string) {
  try {
    await run('readwrite', (s) => s.delete(stopId));
  } catch {
    // ignore
  }
}
