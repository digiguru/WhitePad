import { Board, validateBoard } from "./protocol";
export type SavedBoard = {
  board: Board;
  controlEpoch: number;
  revision: number;
  questionRevision: number;
  confirmedSeq?: number;
  beforeClear?: Board;
  updated: number;
};
type Head = Omit<SavedBoard, "board"> & {
  seq: number;
  epoch: number;
  firstSeq: number;
};
const RETENTION = 24 * 60 * 60 * 1000;
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("whitepad-peer-v1", 2);
    request.onupgradeneeded = () => {
      for (const store of ["boards", "heads", "ops"])
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
const range = (key: string) =>
  IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]);
export async function loadBoard(key: string): Promise<SavedBoard | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["boards", "heads", "ops"], "readwrite");
    const heads = tx.objectStore("heads"),
      ops = tx.objectStore("ops"),
      legacy = tx.objectStore("boards");
    // Cleanup is lazy and bounded by the number of local room sessions, not network activity.
    for (const store of [heads, legacy]) {
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          if (c.value.updated < Date.now() - RETENTION) {
            c.delete();
            if (store === heads) ops.delete(range(String(c.key)));
          }
          c.continue();
        }
      };
    }
    let value: SavedBoard | undefined;
    const head = heads.get(key);
    head.onsuccess = () => {
      const h = head.result as Head | undefined;
      if (!h) {
        const old = legacy.get(key);
        old.onsuccess = () => {
          const v = old.result;
          if (v && v.updated > Date.now() - RETENTION && validateBoard(v.board))
            value = v;
        };
        return;
      }
      if (h.updated < Date.now() - RETENTION) return;
      const board: Board = { seq: h.seq, epoch: h.epoch, operations: [] };
      const cursor = ops.openCursor(range(key));
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          board.operations.push(c.value);
          c.continue();
        } else if (validateBoard(board)) {
          const { seq: _seq, epoch: _epoch, firstSeq: _first, ...metadata } = h;
          value = { ...metadata, board };
        }
      };
    };
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
/** Append local operations and a small head record; do not clone the entire board per pen-up. */
export async function saveBoard(key: string, value: SavedBoard) {
  // Freeze this save's logical prefix before awaiting the database. Operations are immutable.
  const { board, ...metadata } = value;
  const operations = board.operations.slice();
  const next: Head = {
    ...metadata,
    seq: board.seq,
    epoch: board.epoch,
    firstSeq: operations[0]?.seq ?? 0,
  };
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction(["boards", "heads", "ops"], "readwrite");
    const heads = tx.objectStore("heads"),
      ops = tx.objectStore("ops");
    const read = heads.get(key);
    read.onsuccess = () => {
      const previous = read.result as Head | undefined;
      const reset =
        !previous ||
        previous.controlEpoch !== next.controlEpoch ||
        previous.revision !== next.revision ||
        previous.seq > next.seq ||
        previous.firstSeq !== next.firstSeq;
      if (reset) ops.delete(range(key));
      for (const op of operations)
        if (reset || op.seq > previous!.seq) ops.put(op, [key, op.seq]);
      heads.put(next, key);
      tx.objectStore("boards").delete(key); // Retire v1 full-snapshot storage after successful migration.
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
