/* eslint-env worker */
/**
 * Thin router for encrypted offline cache worker.
 *
 * This file keeps the public worker message protocol stable:
 * - INIT_DB
 * - INSERT_MESSAGE
 * - DELETE_MESSAGE
 * - SEARCH_MESSAGES
 * - LOAD_OFFLINE_MESSAGES
 * - PURGE_LOCAL_STORE
 *
 * All crypto + schema + search + purge logic lives in separate modules.
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { initSessionKey, destroySessionKey } from './crypto';
import { initSchema } from './schema';
import { searchMessages } from './search';
import { insertMessage, loadOfflineMessages, deleteMessage } from './message-ops';
import { purgeLocalStore } from './purge';

let db = null;

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT_DB':
      try {
        // Initialize the SQLite WASM runtime.
        const sqlite3 = await sqlite3InitModule();

        // Mount DB on OPFS when supported.
        if ('opfs' in sqlite3.vfs) {
          db = new sqlite3.oo1.OpfsDb('/chat_history.sqlite3');
        } else {
          db = new sqlite3.oo1.DB('/chat_history.sqlite3', 'ct');
        }

        // Initialize the session-only encryption key.
        await initSessionKey();

        // Create schema + FTS triggers.
        await initSchema(db);

        self.postMessage({ type: 'DB_READY' });
      } catch (err) {
        console.error('SQLite Init Error:', err);
        self.postMessage({ type: 'ERROR', payload: String(err?.message || err) });
      }
      break;

    case 'INSERT_MESSAGE':
      try {
        if (!db) return;
        await insertMessage(db, payload);
      } catch (err) {
        console.error('INSERT_MESSAGE failed:', err);
      }
      break;

    case 'DELETE_MESSAGE':
      try {
        if (!db) return;
        deleteMessage(db, payload.eventId);
      } catch (err) {
        console.error('DELETE_MESSAGE failed:', err);
      }
      break;

    case 'SEARCH_MESSAGES':
      try {
        if (!db) return;
        const results = await searchMessages(db, payload.query);
        self.postMessage({ type: 'SEARCH_RESULTS', payload: results });
      } catch (err) {
        console.error('SEARCH_MESSAGES failed:', err);
        self.postMessage({ type: 'SEARCH_RESULTS', payload: [] });
      }
      break;

    case 'LOAD_OFFLINE_MESSAGES':
      try {
        if (!db) return;
        const roomId = payload.roomId;
        const history = await loadOfflineMessages(db, roomId);
        self.postMessage({ type: 'OFFLINE_HISTORY_LOADED', payload: { roomId, history } });
      } catch (err) {
        console.error('LOAD_OFFLINE_MESSAGES failed:', err);
        const roomId = payload?.roomId;
        self.postMessage({
          type: 'OFFLINE_HISTORY_LOADED',
          payload: { roomId, history: [] }
        });
      }
      break;

    case 'PURGE_LOCAL_STORE':
      try {
        if (db) {
          await purgeLocalStore(db);
          db = null;
        } else {
          // Even if db isn't available, still destroy encryption key.
          destroySessionKey();
        }
        self.postMessage({ type: 'DB_PURGED' });
      } catch (err) {
        console.error('PURGE_LOCAL_STORE failed:', err);
        self.postMessage({ type: 'DB_PURGED' });
      }
      break;
  }
};

