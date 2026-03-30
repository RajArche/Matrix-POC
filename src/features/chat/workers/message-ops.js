/**
 * Encrypted message insert + offline load helpers.
 *
 * This matches the worker's existing message protocol:
 * - INSERT_MESSAGE encrypts `payload.body` before storing.
 * - LOAD_OFFLINE_MESSAGES decrypts cached bodies for UI rendering.
 */

import { encrypt, decrypt } from "./crypto";

// Bodies that indicate a message never successfully decrypted during the session it arrived.
const UNDECRYPTABLE_PATTERNS = ['Unable to decrypt', 'DecryptionError'];
const isStoredUndecryptable = (body) =>
  typeof body === 'string' && UNDECRYPTABLE_PATTERNS.some(p => body.includes(p));

export async function insertMessage(db, payload) {
  // payload.body is plaintext decrypted by matrix-rust-sdk-crypto.
  // We must never persist it as-is; encrypt before inserting.
  const plaintextBody = payload.body ?? "";
  const isUndecryptable = payload.undecryptable === true || isStoredUndecryptable(plaintextBody);
  const bodyEnc = await encrypt(String(plaintextBody));

  const forwardedFrom = payload.forwardedFrom || null;
  const forwardedFromSender = forwardedFrom?.sender ?? null;
  const originalEventId = forwardedFrom?.original_event_id ?? null;
  const forwardedFromTs = forwardedFrom?.original_ts ?? null;

  db.exec({
    sql: `
      INSERT OR IGNORE INTO messages
        (eventId, roomId, sender, msgtype, body_enc, body_plain, url, forwarded_from_sender, original_event_id, forwarded_from_ts, timestamp, redacted)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `,
    bind: [
      payload.eventId,
      payload.roomId,
      payload.sender,
      payload.msgtype || "m.text",
      bodyEnc,
      String(plaintextBody),
      payload.url ?? null,
      forwardedFromSender,
      originalEventId,
      forwardedFromTs,
      payload.timestamp,
    ],
  });

  // If this is the REAL decrypted message (not a placeholder), always overwrite whatever
  // was previously stored for this eventId. INSERT OR IGNORE silently skips duplicate rows,
  // so without this UPDATE an earlier undecryptable placeholder would stay forever.
  if (!isUndecryptable) {
    db.exec({
      sql: `UPDATE messages SET body_enc = ?, msgtype = ?, url = ? WHERE eventId = ?`,
      bind: [bodyEnc, payload.msgtype || "m.text", payload.url ?? null, payload.eventId],
    });
  }

  // Clear plaintext so it is never at rest in the main table.
  // FTS still retains a searchable copy inside its own structure.
  db.exec({
    sql: "UPDATE messages SET body_plain = NULL WHERE eventId = ?",
    bind: [payload.eventId],
  });
}

export async function loadOfflineMessages(db, roomId) {
  const rows = [];

  // Load encrypted message bodies for the room.
  db.exec({
    sql: `
      SELECT
        eventId,
        roomId,
        sender,
        msgtype,
        body_enc,
        url,
        forwarded_from_sender,
        original_event_id,
        forwarded_from_ts,
        timestamp
      FROM messages
      WHERE roomId = ?
        AND redacted = 0
      ORDER BY timestamp ASC
    `,
    bind: [roomId],
    rowMode: "object",
    callback: function (row) {
      rows.push(row);
    },
  });

  const history = [];

  // Decrypt sequentially to avoid spawning too many crypto operations at once.
  for (const row of rows) {
    const forwardedFrom = row.forwarded_from_sender
      ? {
          sender: row.forwarded_from_sender,
          original_event_id: row.original_event_id,
          original_ts: row.forwarded_from_ts,
        }
      : null;

    try {
      const body = await decrypt(row.body_enc);
      // Flag rows that still contain a placeholder body so setRoomMessages can
      // merge them correctly — real live messages always win over these.
      const undecryptable = isStoredUndecryptable(body);
      history.push({
        eventId: row.eventId,
        roomId: row.roomId,
        sender: row.sender,
        msgtype: row.msgtype,
        body,
        undecryptable,
        url: row.url,
        forwardedFrom,
        timestamp: row.timestamp,
      });
    } catch (_) {
      // Local session-key decryption failed (key rotation / fresh device).
      history.push({
        eventId: row.eventId,
        roomId: row.roomId,
        sender: row.sender,
        msgtype: row.msgtype || "m.text",
        body: "[Unable to decrypt locally]",
        undecryptable: true,
        url: row.url,
        forwardedFrom,
        timestamp: row.timestamp,
      });
    }
  }

  return history;
}

/**
 * Delete a message row (and its FTS entry) by eventId.
 * Used to clean up call-signaling placeholders that were stored before decryption.
 */
export function deleteMessage(db, eventId) {
  // Retrieve the internal id first so we can clean up the FTS table.
  let rowId = null;
  db.exec({
    sql: 'SELECT id FROM messages WHERE eventId = ?',
    bind: [eventId],
    rowMode: 'object',
    callback: (row) => { rowId = row.id; },
  });

  if (rowId !== null) {
    db.exec({ sql: 'DELETE FROM messages_fts WHERE id = ?', bind: [rowId] });
  }
  db.exec({ sql: 'DELETE FROM messages WHERE eventId = ?', bind: [eventId] });
}

