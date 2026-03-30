import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { setRooms, pushMessage, setRoomMessages, setReady, setCurrentUserId, setSearchResults, setIsSearching, setRoomMembers, setActiveRoom, setDirectoryUsers, setPendingCallEvent, removeMessage } from '../chatSlice';

// Module-level set of eventIds that are Matrix call signaling events.
// These must never appear as chat bubbles. Persists for the session lifetime.
const callEventIds = new Set();

export const useMatrixInit = (userId, accessToken, baseUrl = "http://172.16.7.246:8008", deviceId = null) => {
  const dispatch = useDispatch();

  // We manage BOTH Web Workers outside the React render thread to guarantee 60fps UI
  const matrixWorkerRef = useRef(null);
  const sqliteWorkerRef = useRef(null);

  useEffect(() => {
    // 1. ISOLATING matrix-rust-sdk-crypto
    matrixWorkerRef.current = new Worker(new URL('../workers/matrixWorker.js', import.meta.url), { type: 'module' });

    // 2. ISOLATING OPFS SQLite Storage
    sqliteWorkerRef.current = new Worker(new URL('../workers/sqliteWorkerRouter.js', import.meta.url), { type: 'module' });

    // --- SQLITE WORKER EVENT LISTENER ---
    sqliteWorkerRef.current.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'DB_READY') {
        console.log("✅ Local SQLite OPFS Database Ready");
      } else if (type === 'OFFLINE_HISTORY_LOADED') {
        // Filter out any call signaling events that were stored as undecryptable
        // placeholders before this fix, so they never appear as chat bubbles.
        const filtered = payload.history.filter(m => !callEventIds.has(m.eventId));
        dispatch(setRoomMessages({ roomId: payload.roomId, messages: filtered }));
      } else if (type === 'SEARCH_RESULTS') {
        dispatch(setSearchResults(payload));
        dispatch(setIsSearching(false));
      }
    };

    // Boot up the OPFS Database System first
    sqliteWorkerRef.current.postMessage({ type: 'INIT_DB' });

    console.log(matrixWorkerRef, "matrixWorkerRef")

    // --- MATRIX WORKER EVENT LISTENER ---
    matrixWorkerRef.current.onmessage = (event) => {
      const { type, payload } = event.data;

      if (type === 'MATRIX_READY') {
        dispatch(setReady(true));
        dispatch(setCurrentUserId(payload?.userId)); // Store logged-in user for bubble alignment
        matrixWorkerRef.current.postMessage({ type: 'GET_ROOMS' });
        matrixWorkerRef.current.postMessage({ type: 'GET_USER_DIRECTORY', payload: { term: '', limit: 100 } });

      } else if (type === 'ROOM_INVITE') {
        // Log the invite — you can surface this in UI in a later iteration
        console.log('📨 Room invite received:', payload);

      } else if (type === 'ROOM_MEMBERS') {
        dispatch(setRoomMembers(payload));

      } else if (type === 'USER_DIRECTORY_UPDATED') {
        dispatch(setDirectoryUsers(payload));

      } else if (type === 'USER_INVITED') {
        console.log(`👤 User ${payload.userId} invited to room ${payload.roomId}`);
        // Refresh members list
        matrixWorkerRef.current.postMessage({ type: 'GET_ROOM_MEMBERS', payload: { roomId: payload.roomId } });

      } else if (type === 'ROOM_JOINED') {
        console.log("✅ Successfully joined room:", payload.roomId);
        matrixWorkerRef.current.postMessage({ type: 'GET_ROOMS' });

      } else if (type === 'ROOM_LEFT') {
        console.log("🚪 Left room:", payload.roomId);
        // If it was the active room, clear it
        dispatch(setActiveRoom(null));
        matrixWorkerRef.current.postMessage({ type: 'GET_ROOMS' });

      } else if (type === 'GROUP_CREATED') {
        console.log("🎉 Secure Group successfully created via Matrix Worker:", payload);
        // Immediately fetch updated rooms to see the new group
        matrixWorkerRef.current.postMessage({ type: 'GET_ROOMS' });
        if (payload?.roomId) {
          dispatch(setActiveRoom(payload.roomId));
          matrixWorkerRef.current.postMessage({ type: 'GET_ROOM_MEMBERS', payload: { roomId: payload.roomId } });
        }
      } else if (type === 'DIRECT_CHAT_CREATED') {
        console.log("💬 Direct chat invite sent:", payload);
        matrixWorkerRef.current.postMessage({ type: 'GET_ROOMS' });
        if (payload?.roomId) {
          dispatch(setActiveRoom(payload.roomId));
          matrixWorkerRef.current.postMessage({ type: 'GET_ROOM_MEMBERS', payload: { roomId: payload.roomId } });
        }

      } else if (type === 'ROOMS_UPDATED') {
        dispatch(setRooms(payload));

        // Immediately trigger offline cache loads for all visible rooms!
        payload.forEach(room => {
          sqliteWorkerRef.current.postMessage({ type: 'LOAD_OFFLINE_MESSAGES', payload: { roomId: room.id } });
        });

      } else if (type === 'NEW_MESSAGE') {
        // Push real-time newly decrypted messages to Redux for <ChatWindow />
        dispatch(pushMessage({ roomId: payload.roomId, message: payload }));

        // ✨ MAGIC PIPELINE ✨: Transparently sink the new message into the SQLite worker for permanent local storage!
        sqliteWorkerRef.current.postMessage({ type: 'INSERT_MESSAGE', payload });

      } else if (type === 'CALL_EVENT') {
        // VoIP: forward raw Matrix call event to the main-thread call manager.
        dispatch(setPendingCallEvent(payload));

      } else if (type === 'REMOVE_CALL_PLACEHOLDER') {
        // A decrypted call event (m.call.invite etc.) had previously been stored
        // as an "[Unable to decrypt yet]" placeholder. Clean it up everywhere.
        const { roomId, eventId } = payload;
        callEventIds.add(eventId);                                    // block future LOAD re-adds
        dispatch(removeMessage({ roomId, eventId }));                 // remove from Redux
        sqliteWorkerRef.current?.postMessage({                        // remove from SQLite
          type: 'DELETE_MESSAGE',
          payload: { eventId },
        });

      } else if (type === 'ERROR' || type === 'CALL_ERROR') {
        console.error("Matrix Worker Error:", payload);
      }
    };

    // Boot up the Matrix Engine
    matrixWorkerRef.current.postMessage({
      type: 'INIT_MATRIX',
      payload: { userId, accessToken, baseUrl, deviceId }
    });

    // Cleanup both heavy web workers on unmount
    return () => {
      matrixWorkerRef.current.terminate();
      sqliteWorkerRef.current.terminate();
    };
  }, [userId, accessToken, baseUrl, dispatch]);

  const sendMessage = (roomId, text) => {
    if (matrixWorkerRef.current) {
      matrixWorkerRef.current.postMessage({ type: 'SEND_MESSAGE', payload: { roomId, text } });
    }
  };

  // The Lightning-Fast SQLite FTS5 Search Tunnel
  const searchMessages = (query) => {
    console.log(sqliteWorkerRef, "sqliteWorkerRef")
    console.log(query, "query")
    if (sqliteWorkerRef.current) {
      if (!query.trim()) {
        dispatch(setSearchResults([]));
        return;
      }
      dispatch(setIsSearching(true));
      sqliteWorkerRef.current.postMessage({ type: 'SEARCH_MESSAGES', payload: { query } });
    }
  };

  // Group Room Features (E2EE)
  const createGroupChat = (groupName, userIdsArray) => {
    if (matrixWorkerRef.current) {
      matrixWorkerRef.current.postMessage({ 
        type: 'CREATE_GROUP_ROOM', 
        payload: { groupName, userIdsArray } 
      });
    }
  };

  const createDirectChat = (userId) => {
    if (matrixWorkerRef.current) {
      matrixWorkerRef.current.postMessage({
        type: 'CREATE_DIRECT_ROOM',
        payload: { userId }
      });
    }
  };

  const searchDirectoryUsers = (term = "") => {
    if (matrixWorkerRef.current) {
      matrixWorkerRef.current.postMessage({
        type: 'GET_USER_DIRECTORY',
        payload: { term, limit: 100 }
      });
    }
  };

  const getRoomMembers = (roomId) => {
    if (matrixWorkerRef.current) {
      matrixWorkerRef.current.postMessage({ type: 'GET_ROOM_MEMBERS', payload: { roomId } });
    }
  };

  const inviteUser = (roomId, userId) => {
    if (matrixWorkerRef.current) {
      matrixWorkerRef.current.postMessage({ type: 'INVITE_USER', payload: { roomId, userId } });
    }
  };

  const joinRoom = (roomId) => {
    if (matrixWorkerRef.current) {
      matrixWorkerRef.current.postMessage({ type: 'JOIN_ROOM', payload: { roomId } });
    }
  };

  const leaveRoom = (roomId) => {
    if (matrixWorkerRef.current) {
      matrixWorkerRef.current.postMessage({ type: 'LEAVE_ROOM', payload: { roomId } });
    }
  };

  const uploadFile = (roomId, file) => {
    if (matrixWorkerRef.current) {
      // Pass the raw File object. Web Workers handle Blobs/Files natively via cloning.
      matrixWorkerRef.current.postMessage({ 
        type: 'UPLOAD_FILE', 
        payload: { 
          roomId, 
          file, 
          name: file.name, 
          type: file.type, 
          size: file.size 
        } 
      });
    }
  };

  const forwardMessage = (sourceRoomId, sourceEventId, targetRoomId) => {
    if (matrixWorkerRef.current) {
      matrixWorkerRef.current.postMessage({
        type: "FORWARD_MESSAGE",
        payload: { sourceRoomId, sourceEventId, targetRoomId },
      });
    }
  };

  // VoIP: send a Matrix call signaling event through the existing worker.
  // The main-thread useCallManager hook calls this to relay SDP offer/answer
  // and ICE candidates without needing a second Matrix client.
  const sendCallEvent = (roomId, eventType, content) => {
    if (matrixWorkerRef.current) {
      matrixWorkerRef.current.postMessage({
        type: 'SEND_CALL_EVENT',
        payload: { roomId, eventType, content },
      });
    }
  };

  return { sendMessage, searchMessages, createGroupChat, createDirectChat, getRoomMembers, inviteUser, joinRoom, leaveRoom, uploadFile, searchDirectoryUsers, forwardMessage, sendCallEvent };
};
