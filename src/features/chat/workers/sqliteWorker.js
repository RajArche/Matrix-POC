/* eslint-env worker */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

/**
 * Encrypted offline cache (OPFS + WASM SQLite)
 * ------------------------------------------------
 * This worker:
 * - Opens an OPFS-backed SQLite DB for offline message caching.
 * - Encrypts message bodies before writing to disk (AES-GCM).
 * - Uses an FTS5 index to support text search.
 * - Decrypts message bodies on demand when loading history for rendering.
 *
 * Notes:
 * - The AES-GCM key is session-only (stored in memory). After a hard refresh,
 *   decryption will only work if the key was preserved for the same session.
 * - FTS requires plaintext text in the index. We keep plaintext out of the
 *   main messages table after insert, but FTS still stores searchable text.
 */

let db;

// ──────────────────────────────────────────────────────────────
// Crypto helpers (AES-GCM, session-only key)
// ──────────────────────────────────────────────────────────────
let sessionKey = null; // CryptoKey (in-memory only)

const uint8ToBase64 = (u8) => {
  // Convert Uint8Array -> base64 without assuming TextEncoder for binary data.
  // We chunk to avoid call stack issues on large arrays.
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < u8.length; i += chunkSize) {
    const chunk = u8.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const base64ToUint8 = (b64) => {
  const binary = atob(b64);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
  return u8;
};

const initSessionKey = async () => {
  // AES-GCM with a fresh random key generated per session.
  sessionKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: key never leaves the JS memory boundary
    ['encrypt', 'decrypt']
  );
};

const destroySessionKey = () => {
  // Destroying means dropping the reference; actual key material is managed
  // by the browser/worker runtime.
  sessionKey = null;
};

const encrypt = async (plaintext) => {
  if (!sessionKey) throw new Error('Session key not initialized');

  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV is standard for GCM
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sessionKey, encoded);

  // Store as base64(iv) + ':' + base64(ciphertext)
  return `${uint8ToBase64(iv)}:${uint8ToBase64(new Uint8Array(ciphertext))}`;
};

const decrypt = async (stored) => {
  if (!sessionKey) throw new Error('Session key not initialized');
  if (!stored) return '';

  const [ivB64, ctB64] = stored.split(':');
  const iv = base64ToUint8(ivB64);
  const ct = base64ToUint8(ctB64);

  const plaintextBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sessionKey, ct);
  return new TextDecoder().decode(plaintextBuf);
};

// ──────────────────────────────────────────────────────────────
// DB schema + FTS setup
// ──────────────────────────────────────────────────────────────
const SCHEMA_VERSION = 2;

const initSchema = async () => {
  // Read current user_version to decide whether we need to rebuild.
  let userVersion = 0;
  db.exec({
    sql: 'PRAGMA user_version;',
    rowMode: 'object',
    callback: (row) => {
      // PRAGMA returns a single numeric field; exact column name can vary.
      const values = Object.values(row);
      userVersion = Number(values[0] ?? 0);
    },
  });

  if (userVersion !== SCHEMA_VERSION) {
    // For now, we rebuild the local cache when the schema changes.
    // In production, implement proper migrations instead of dropping data.
    db.exec(`
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS messages_fts;
    `);
  }

  // SQLite pragmas for correctness and crash safety.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  // messages table:
  // - body_enc: encrypted message body persisted on disk
  // - body_plain: plaintext used only for FTS indexing during insert, then cleared
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      eventId   TEXT UNIQUE,
      roomId    TEXT NOT NULL,
      sender    TEXT NOT NULL,
      msgtype   TEXT NOT NULL DEFAULT 'm.text',
      body_enc  TEXT NOT NULL,
      body_plain TEXT,
      url       TEXT,
      timestamp INTEGER NOT NULL,
      redacted  INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_room_ts
      ON messages(roomId, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_messages_sender
      ON messages(sender);

    -- Contentless FTS table:
    -- We store the fields we want searchable. The 3rd column (index 3) is "body".
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      id UNINDEXED,
      room_id UNINDEXED,
      sender,
      body,
      tokenize = 'porter ascii'
    );

    -- Insert trigger keeps FTS in sync.
    -- Important: this indexes new.body_plain at insert-time.
    CREATE TRIGGER IF NOT EXISTS messages_ai
    AFTER INSERT ON messages
    BEGIN
      INSERT INTO messages_fts(id, room_id, sender, body)
      VALUES (new.id, new.roomId, new.sender, new.body_plain);
    END;

    -- Redaction trigger:
    -- If you later implement server-side redaction handling, this will remove
    -- cached plaintext text from the FTS index.
    CREATE TRIGGER IF NOT EXISTS messages_ad
    AFTER UPDATE OF redacted ON messages
    WHEN new.redacted = 1
    BEGIN
      DELETE FROM messages_fts WHERE id = old.id;
      UPDATE messages SET body_plain = NULL WHERE id = old.id;
    END;
  `);

  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
};

// ──────────────────────────────────────────────────────────────
// Worker message loop
// ──────────────────────────────────────────────────────────────
self.onmessage = async (event) => {
  const { type, payload } = event.data;

  // WARNING: Never log decrypted PHI contents here in production.
  // These logs are intentionally minimal.
  // console.log('[sqliteWorker]', type, payload);

  switch (type) {
    case 'INIT_DB':
      try {
        // 1. Initialize the SQLite WASM runtime.
        const sqlite3 = await sqlite3InitModule();

        // 2. Mount DB on OPFS when supported.
        //    - OPFS gives persistent storage per browser origin.
        //    - The VFS controls where the db file lives.
        if ('opfs' in sqlite3.vfs) {
          db = new sqlite3.oo1.OpfsDb('/chat_history.sqlite3');
        } else {
          // Fallback: in-memory/transient sqlite (no OPFS guarantees)
          db = new sqlite3.oo1.DB('/chat_history.sqlite3', 'ct');
        }

        // 3. Initialize in-memory encryption key.
        await initSessionKey();

        // 4. Create/migrate schema and FTS triggers.
        await initSchema();

        self.postMessage({ type: 'DB_READY' });
      } catch (err) {
        console.error('SQLite Init Error:', err);
        self.postMessage({ type: 'ERROR', payload: String(err?.message || err) });
      }
      break;

    case 'INSERT_MESSAGE': {
      if (!db) return;
      try {
        // Encrypt message body before persisting.
        // We keep body_plain only until the FTS insert trigger runs.
        const plaintextBody = payload.body ?? '';
        const bodyEnc = await encrypt(String(plaintextBody));

        // Store:
        // - body_enc: encrypted persisted payload
        // - body_plain: plaintext used by messages_ai trigger to fill messages_fts
        // Then, immediately clear body_plain so the main messages table doesn't
        // retain plaintext after insert.
        db.exec({
          sql: `
            INSERT OR IGNORE INTO messages
              (eventId, roomId, sender, msgtype, body_enc, body_plain, url, timestamp, redacted)
            VALUES
              (?, ?, ?, ?, ?, ?, ?, ?, 0)
          `,
          bind: [
            payload.eventId,
            payload.roomId,
            payload.sender,
            payload.msgtype || 'm.text',
            bodyEnc,
            String(plaintextBody),
            payload.url ?? null,
            payload.timestamp,
          ],
        });

        // Clear plaintext from the main messages table after FTS indexing.
        db.exec({
          sql: 'UPDATE messages SET body_plain = NULL WHERE eventId = ?',
          bind: [payload.eventId],
        });
      } catch (err) {
        console.error('[sqliteWorker] INSERT_MESSAGE failed:', err);
      }
      break;
    }

    case 'SEARCH_MESSAGES': {
      if (!db) return;

      // Client-provided query. We must handle FTS special characters safely.
      const rawQuery = String(payload.query ?? '');
      const safeQuery = rawQuery.replace(/["*^]/g, ' ').trim();

      if (!safeQuery) {
        self.postMessage({ type: 'SEARCH_RESULTS', payload: [] });
        break;
      }

      const results = [];

      // FTS MATCH searches against messages_fts.body (column index 3).
      // snippet(..., 3, ...) uses body column to generate an excerpt.
      db.exec({
        sql: `
          SELECT
            fts.room_id AS roomId,
            fts.sender  AS sender,
            snippet(messages_fts, 3, '', '', '...', 16) AS body,
            m.timestamp AS timestamp
          FROM messages_fts fts
          JOIN messages m ON m.id = fts.id
          WHERE messages_fts MATCH ?
          ORDER BY m.timestamp DESC
          LIMIT 50
        `,
        bind: [safeQuery],
        rowMode: 'object',
        callback: function (row) {
          // This shape is what ChatLayout expects for the search popover.
          results.push({
            roomId: row.roomId,
            sender: row.sender,
            body: row.body,
            timestamp: row.timestamp,
          });
        },
      });

      self.postMessage({ type: 'SEARCH_RESULTS', payload: results });
      break;
    }

    case 'LOAD_OFFLINE_MESSAGES': {
      if (!db) return;

      const roomId = payload.roomId;
      const rows = [];

      // Load encrypted payload from disk. We decrypt in JS because:
      // - The SQLite WASM engine doesn't have access to WebCrypto keys.
      // - Decryption must happen off the main thread.
      db.exec({
        sql: `
          SELECT
            eventId,
            roomId,
            sender,
            msgtype,
            body_enc,
            url,
            timestamp
          FROM messages
          WHERE roomId = ?
            AND redacted = 0
          ORDER BY timestamp ASC
        `,
        bind: [roomId],
        rowMode: 'object',
        callback: function (row) {
          rows.push(row);
        },
      });

      const history = [];

      // Decrypt sequentially to avoid spawning too many crypto operations at once.
      for (const row of rows) {
        try {
          const body = await decrypt(row.body_enc);
          history.push({
            eventId: row.eventId,
            roomId: row.roomId,
            sender: row.sender,
            msgtype: row.msgtype,
            body,
            url: row.url,
            timestamp: row.timestamp,
          });
        } catch (e) {
          // If decryption fails, we return a non-sensitive placeholder.
          // This prevents the UI from crashing due to missing keys.
          history.push({
            eventId: row.eventId,
            roomId: row.roomId,
            sender: row.sender,
            msgtype: row.msgtype || 'm.text',
            body: '[Unable to decrypt locally]',
            url: row.url,
            timestamp: row.timestamp,
          });
        }
      }

      self.postMessage({
        type: 'OFFLINE_HISTORY_LOADED',
        payload: { roomId, history },
      });
      break;
    }

    case 'PURGE_LOCAL_STORE': {
      // GDPR-like local erasure:
      // - Drop tables
      // - Close DB
      // - Remove OPFS file (best-effort)
      // - Destroy in-memory session key
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

      destroySessionKey();

      try {
        if ('storage' in navigator && navigator.storage?.getDirectory) {
          const root = await navigator.storage.getDirectory();
          try {
            await root.removeEntry('chat_history.sqlite3', { recursive: true });
          } catch (_) {
            // Some engines use different filenames for WAL/shm/journal. It's ok.
          }
          try {
            await root.removeEntry('chat_history.sqlite3-wal', { recursive: true });
          } catch (_) {}
        }
      } catch (_) {}

      self.postMessage({ type: 'DB_PURGED' });
      break;
    }
  }
};
