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
      state.messagesByRoom[roomId].push(message);
    },
    setRoomMessages(state, action) {
      const { roomId, messages } = action.payload;
      state.messagesByRoom[roomId] = messages;
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
