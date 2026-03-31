import { createSlice } from '@reduxjs/toolkit';

// Body patterns that indicate a stored message was never successfully decrypted.
// Used by setRoomMessages to ensure live-decrypted messages always win over placeholders.
const UNDECRYPTABLE_PATTERNS = ['Unable to decrypt', 'DecryptionError'];
const msgIsUndecryptable = (m) =>
  m.undecryptable === true ||
  (typeof m.body === 'string' && UNDECRYPTABLE_PATTERNS.some(p => m.body.includes(p)));

const CALL_STATE_IDLE = {
  status: 'idle',   // 'idle' | 'ringing_in' | 'ringing_out' | 'ongoing' | 'ended'
  callId: null,
  roomId: null,
  callType: null,   // 'voice' | 'video'
  callerId: null,
  offerSdp: null,
};

const initialState = {
  rooms: [],
  activeRoomId: null,
  messagesByRoom: {},
  isReady: false,
  currentUserId: null,
  invites: [],
  searchResults: [],
  isSearching: false,
  membersByRoom: {},
  directoryUsers: [],
  matrixAccessToken: null,
  // ── VoIP call state ──────────────────────────────────────────────────────
  callState: { ...CALL_STATE_IDLE },
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setReady(state, action) {
      state.isReady = action.payload;
    },
    setRooms(state, action) {
      state.rooms = action.payload;
    },
    setActiveRoom(state, action) {
      state.activeRoomId = action.payload;
    },
    pushMessage(state, action) {
      const { roomId, message } = action.payload;
      if (!state.messagesByRoom[roomId]) {
        state.messagesByRoom[roomId] = [];
      }
      const list = state.messagesByRoom[roomId];
      const existingIdx = list.findIndex((m) => m.eventId === message.eventId);

      if (existingIdx !== -1) {
        // Replace an undecryptable placeholder with the real decrypted message.
        // Never downgrade a real message back to a placeholder.
        if (list[existingIdx].undecryptable && !message.undecryptable) {
          list[existingIdx] = message;
        }
        // If both are the same type (both placeholder or both real), skip to avoid duplicates.
        return;
      }

      list.push(message);
    },
    setRoomMessages(state, action) {
      const { roomId, messages } = action.payload;
      // Merge SQLite-loaded history with any in-memory live messages, deduplicating by eventId.
      // Real (decrypted) messages always win over undecryptable placeholders regardless of
      // whether the placeholder came from SQLite (undecryptable flag) or body string check.
      const existing = state.messagesByRoom[roomId] || [];
      const merged = new Map();
      for (const m of [...messages, ...existing]) {
        const prev = merged.get(m.eventId);
        if (!prev || (msgIsUndecryptable(prev) && !msgIsUndecryptable(m))) {
          merged.set(m.eventId, m);
        }
      }
      state.messagesByRoom[roomId] = Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
    },
    setCurrentUserId(state, action) {
      state.currentUserId = action.payload;
    },
    setSearchResults(state, action) {
      state.searchResults = action.payload;
    },
    setIsSearching(state, action) {
      state.isSearching = action.payload;
    },
    setRoomMembers(state, action) {
      const { roomId, members } = action.payload;
      state.membersByRoom[roomId] = members;
    },
    setDirectoryUsers(state, action) {
      state.directoryUsers = action.payload;
    },

    setMatrixAccessToken(state, action) {
      state.matrixAccessToken = action.payload;
    },

    // Remove a single message by eventId (used to clean up call event placeholders)
    removeMessage(state, action) {
      const { roomId, eventId } = action.payload;
      if (state.messagesByRoom[roomId]) {
        state.messagesByRoom[roomId] = state.messagesByRoom[roomId].filter(
          m => m.eventId !== eventId
        );
      }
    },

    // ── VoIP / WebRTC call actions ────────────────────────────────────────
    setCallStatus(state, action) {
      Object.assign(state.callState, action.payload);
    },
    setIncomingCall(state, action) {
      state.callState = { status: 'ringing_in', ...action.payload };
    },
    clearCall(state) {
      state.callState = { ...CALL_STATE_IDLE };
    },
  }
});

export const {
  setRooms, setActiveRoom, pushMessage, setRoomMessages, setReady,
  setCurrentUserId, setSearchResults, setIsSearching, setRoomMembers,
  setDirectoryUsers, setMatrixAccessToken,
  removeMessage,
  setCallStatus, setIncomingCall, clearCall,
} = chatSlice.actions;
export default chatSlice.reducer;
