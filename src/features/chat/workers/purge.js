/**
 * Local purge / GDPR-like erasure for the OPFS SQLite cache.
 *
 * Best-effort behavior:
 * - Drops local tables
 * - Closes the DB (if supported by the WASM binding)
 * - Removes OPFS database files (best effort)
 * - Destroys the session-only encryption key in memory
 */

import { destroySessionKey } from "./crypto";

export async function purgeLocalStore(db) {
  // 1) Drop local tables first so decrypted/searchable artifacts go away.
  try {
    if (db) {
      db.exec(`
        DROP TABLE IF EXISTS messages_fts;
        DROP TABLE IF EXISTS messages;
      `);
      db.close?.();
    }
  } catch (_) {
    // Ignore purge errors; best effort.
  }

  // 2) Drop the in-memory encryption key so decrypting cached data is impossible.
  destroySessionKey();

  // 3) Remove OPFS files (best effort).
  try {
    if (navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();

      // Main db file
      try {
        await root.removeEntry("chat_history.sqlite3", { recursive: true });
      } catch (_) {}

      // WAL file (sqlite-wasm may create these)
      try {
        await root.removeEntry("chat_history.sqlite3-wal", { recursive: true });
      } catch (_) {}
    }
  } catch (_) {
    // Ignore.
  }
}

