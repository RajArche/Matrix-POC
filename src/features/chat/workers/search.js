/**
 * FTS search over OPFS SQLite cached messages.
 *
 * Design:
 * - Uses SQLite FTS5 virtual table `messages_fts`.
 * - Returns results in a shape your UI expects for the encrypted vault search popover.
 */

const sanitizeFtsQuery = (q) => {
  // Remove/replace FTS special characters to reduce parse errors.
  // This is not a cryptographic sanitization; it's for query syntax stability.
  return String(q ?? "")
    .replace(/["*^]/g, " ")
    .trim();
};

export async function searchMessages(db, query) {
  const safeQuery = sanitizeFtsQuery(query);
  if (!safeQuery) return [];

  const results = [];

  // We join messages_fts to messages to access timestamp.
  // snippet(messages_fts, 3, ...) uses the 4th FTS column (index 3), i.e. `body`.
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
    rowMode: "object",
    callback: function (row) {
      results.push({
        roomId: row.roomId,
        sender: row.sender,
        body: row.body,
        timestamp: row.timestamp,
      });
    },
  });

  return results;
}

