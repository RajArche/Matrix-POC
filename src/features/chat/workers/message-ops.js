/**
 * Encrypted message insert + offline load helpers.
 *
 * This matches the worker's existing message protocol:
 * - INSERT_MESSAGE encrypts `payload.body` before storing.
 * - LOAD_OFFLINE_MESSAGES decrypts cached bodies for UI rendering.
 */

import { encrypt, decrypt } from "./crypto";

export async function insertMessage(db, payload) {
  // payload.body is plaintext decrypted by matrix-rust-sdk-crypto.
  // We must never persist it as-is; encrypt before inserting.
  const plaintextBody = payload.body ?? "";
  const bodyEnc = await encrypt(String(plaintextBody));

  // Store:
  // - body_enc: ciphertext at rest
  // - body_plain: plaintext used by the FTS trigger at insert time
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

  // Immediately clear plaintext from the main table so it isn't retained.
  // Note: FTS still stores searchable text inside the FTS structure.
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
    try {
      const body = await decrypt(row.body_enc);
      history.push({
        eventId: row.eventId,
        roomId: row.roomId,
        sender: row.sender,
        msgtype: row.msgtype,
        body,
        url: row.url,
        forwardedFrom: row.forwarded_from_sender
          ? {
              sender: row.forwarded_from_sender,
              original_event_id: row.original_event_id,
              original_ts: row.forwarded_from_ts,
            }
          : null,
        timestamp: row.timestamp,
      });
    } catch (_) {
      // If decryption fails (e.g. key not available after reload),
      // we return a placeholder so the UI doesn't crash.
      history.push({
        eventId: row.eventId,
        roomId: row.roomId,
        sender: row.sender,
        msgtype: row.msgtype || "m.text",
        body: "[Unable to decrypt locally]",
        url: row.url,
        forwardedFrom: row.forwarded_from_sender
          ? {
              sender: row.forwarded_from_sender,
              original_event_id: row.original_event_id,
              original_ts: row.forwarded_from_ts,
            }
          : null,
        timestamp: row.timestamp,
      });
    }
  }

  return history;
}

