import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  rooms: [],
  activeRoomId: null,
  messagesByRoom: {},
  isReady: false,
  currentUserId: null, // Tracks logged-in user for chat bubble alignment
  invites: [],          // Pending room invites
  searchResults: [],    // FTS5 Global Search cache
  isSearching: false,   // Search loading state
  membersByRoom: {} ,    // Holds user lists mapped by roomId
  directoryUsers: [],
  matrixAccessToken: null,
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
      // Real (decrypted) messages take priority over undecryptable placeholders.
      const existing = state.messagesByRoom[roomId] || [];
      const merged = new Map();
      for (const m of [...messages, ...existing]) {
        const prev = merged.get(m.eventId);
        if (!prev || (prev.undecryptable && !m.undecryptable)) {
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
    }
  }
});

export const { setRooms, setActiveRoom, pushMessage, setRoomMessages, setReady, setCurrentUserId, setSearchResults, setIsSearching, setRoomMembers, setDirectoryUsers, setMatrixAccessToken } = chatSlice.actions;
export default chatSlice.reducer;
