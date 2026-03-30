/**
 * OPFS SQLite schema initialization for encrypted offline cache.
 *
 * Responsibilities:
 * - Checks schema version via `PRAGMA user_version`
 * - Creates `messages` and `messages_fts` tables
 * - Creates FTS triggers so insert-time plaintext can populate the index
 *
 * Note:
 * - This code intentionally rebuilds the schema when versions change.
 *   In production, use migrations to avoid unnecessary local data loss.
 */

export const SCHEMA_VERSION = 3;

export async function initSchema(db) {
  // Read the current schema version from SQLite.
  let userVersion = 0;
  db.exec({
    sql: "PRAGMA user_version;",
    rowMode: "object",
    callback: (row) => {
      const values = Object.values(row);
      userVersion = Number(values[0] ?? 0);
    },
  });

  if (userVersion !== SCHEMA_VERSION) {
    // Best-effort rebuild for now.
    db.exec(`
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS messages_fts;
    `);
  }

  // Safety + durability pragmas.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  // Core message cache.
  // - body_enc stores ciphertext at rest
  // - body_plain is only used long enough for FTS indexing at insert-time
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
      forwarded_from_sender TEXT,
      original_event_id TEXT,
      forwarded_from_ts INTEGER,
      timestamp INTEGER NOT NULL,
      redacted  INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_room_ts
      ON messages(roomId, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_messages_sender
      ON messages(sender);

    -- FTS5 table for searching cached messages.
    -- Column order matters for the snippet() call in search.js.
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      id UNINDEXED,
      room_id UNINDEXED,
      sender,
      body,
      tokenize = 'porter ascii'
    );

    -- Trigger: populate the FTS row from messages.body_plain at insert-time.
    CREATE TRIGGER IF NOT EXISTS messages_ai
    AFTER INSERT ON messages
    BEGIN
      INSERT INTO messages_fts(id, room_id, sender, body)
      VALUES (new.id, new.roomId, new.sender, new.body_plain);
    END;

    -- Redaction trigger (future): remove FTS entry when local redaction occurs.
    CREATE TRIGGER IF NOT EXISTS messages_ad
    AFTER UPDATE OF redacted ON messages
    WHEN new.redacted = 1
    BEGIN
      DELETE FROM messages_fts WHERE id = old.id;
      UPDATE messages SET body_plain = NULL WHERE id = old.id;
    END;
  `);

  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

