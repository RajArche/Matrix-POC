/* eslint-env worker */
import { createClient } from "matrix-js-sdk";
import * as RustCrypto from "@matrix-org/matrix-sdk-crypto-wasm";

// We keep a single instance of the Matrix Client running in this background Web Worker.
let matrixClient = null;
let myUserId = null;

// Rooms that were created as 1:1 but were not encrypted yet.
// We bootstrap encryption after the other side joins.
// Map: roomId -> targetUserId (the other participant)
const pendingDirectEncryption = new Map();

const isUndecryptablePlaceholder = (content = {}) => {
  const body = content?.body || "";
  return typeof body === "string" && body.includes("Unable to decrypt");
};

const tryEnableKeyBackupRecovery = async () => {
  try {
    const crypto = matrixClient?.getCrypto?.();
    if (crypto?.checkKeyBackupAndEnable) {
      await crypto.checkKeyBackupAndEnable();
    }
  } catch (e) {
    // Non-fatal: key backup may not be configured server-side yet.
    console.warn("Key backup auto-enable failed:", e?.message || e);
  }
};

const tryRequestMissingRoomKey = async (matrixEvent) => {
  try {
    if (matrixClient?.requestRoomKeyForEvent) {
      await matrixClient.requestRoomKeyForEvent(matrixEvent);
    }
  } catch (e) {
    console.warn("Room key request failed:", e?.message || e);
  }
};

const postVisibleRooms = () => {
  if (!matrixClient) return;
  const rooms = matrixClient
    .getVisibleRooms()
    .filter((r) => r.getMyMembership() === "join" || r.getMyMembership() === "invite")
    .map((room) => ({
      id: room.roomId,
      name: room?.name,
      membership: room.getMyMembership(),
      unreadCount: room.getUnreadNotificationCount(),
      encryptionEnabled: (() => {
        try {
          // Prefer the SDK's live-timeline check. `currentState` can lag
          // in some cases, which causes our UI to incorrectly think
          // encryption is disabled.
          if (typeof room.hasEncryptionStateEvent === "function") {
            return room.hasEncryptionStateEvent();
          }

          // Fallback: older SDKs / unexpected room state.
          const encEvents = room.currentState?.getStateEvents("m.room.encryption", "");
          return Array.isArray(encEvents) && encEvents.length > 0;
        } catch {
          return false;
        }
      })(),
    }));
  self.postMessage({ type: "ROOMS_UPDATED", payload: rooms });
};

const findExistingDirectRoomWithUser = (targetUserId) => {
  if (!matrixClient || !targetUserId) return null;
  const joinedRooms = matrixClient
    .getVisibleRooms()
    .filter((room) => room.getMyMembership() === "join");

  for (const room of joinedRooms) {
    // If encryption is already enabled, don't treat it as a "plain" DM candidate.
    try {
      if (typeof room.hasEncryptionStateEvent === "function" && room.hasEncryptionStateEvent()) continue;
      const encryptionState = room.currentState?.getStateEvents("m.room.encryption", "");
      if (encryptionState) continue;
    } catch {
      // If state inspection fails, allow room re-use logic to continue.
    }

    const joinedMembers = room.getJoinedMembers();
    if (joinedMembers.length !== 2) continue;
    const hasTarget = joinedMembers.some((m) => m.userId === targetUserId);
    if (hasTarget) return room;
  }

  return null;
};

const roomHasEncryption = (room) => {
  try {
    if (typeof room.hasEncryptionStateEvent === "function") {
      return room.hasEncryptionStateEvent();
    }

    const encEvents = room.currentState?.getStateEvents("m.room.encryption", "");
    return Array.isArray(encEvents) && encEvents.length > 0;
  } catch {
    return false;
  }
};

const enableRoomEncryptionIfNeeded = async (roomId) => {
  if (!matrixClient || !roomId) return;
  const room = matrixClient.getRoom(roomId);
  if (!room) return;
  if (roomHasEncryption(room)) return;

  // For healthcare: only bootstrap when it looks like a real 1:1 DM
  // (two joined members and the SDK indicates it was marked as direct).
  const joinedMembers = room.getJoinedMembers();
  // Security-first policy:
  // If a room has exactly 2 joined members and encryption isn't enabled yet,
  // we enable E2EE so healthcare content can never be sent in plaintext.
  if (joinedMembers.length !== 2) return;
  if (!joinedMembers.some((m) => m.userId === myUserId)) return;

  // Attempt to enable key backup before enabling encryption.
  await tryEnableKeyBackupRecovery();

  await matrixClient.sendStateEvent(
    roomId,
    "m.room.encryption",
    { algorithm: "m.megolm.v1.aes-sha2" },
    ""
  );

  postVisibleRooms();
};

const tryBootstrapPendingDirectEncryption = async () => {
  if (!matrixClient || pendingDirectEncryption.size === 0) return;

  for (const [roomId, targetUserId] of pendingDirectEncryption.entries()) {
    const room = matrixClient.getRoom(roomId);
    if (!room) continue;
    if (roomHasEncryption(room)) {
      pendingDirectEncryption.delete(roomId);
      continue;
    }

    const joinedMembers = room.getJoinedMembers();
    const bothJoined =
      joinedMembers.length === 2 &&
      joinedMembers.some((m) => m.userId === myUserId) &&
      joinedMembers.some((m) => m.userId === targetUserId);

    if (bothJoined) {
      try {
        // Enable encryption only after both parties are in the room.
        await enableRoomEncryptionIfNeeded(roomId);
      } finally {
        pendingDirectEncryption.delete(roomId);
      }
    }
  }
};

// The Web Worker listens for messages dispatched from the main React UI thread (useMatrixInit hook).
self.onmessage = async (event) => {
  const { type, payload } = event.data;

  // SECURITY: avoid logging sensitive message bodies/payloads in console.
  console.log(type, "type");

  switch (type) {
    case "INIT_MATRIX":
      try {
        // 1. matrix-js-sdk AS A WRAPPER:
        // Here we initialize the outer wrapper. The js-sdk handles all Matrix HTTP networking, 
        // /sync loops, retries, and API endpoints for us.
        matrixClient = createClient({
          baseUrl: payload.baseUrl || "http://172.16.7.246:8008",
          accessToken: payload.accessToken,
          userId: payload.userId,
          // Do not hard-force a fallback device ID; Matrix crypto keys are device-bound.
          deviceId: payload.deviceId && payload.deviceId !== "UNKNOWN_DEVICE" ? payload.deviceId : undefined,
        });
        myUserId = payload.userId;

        // 2. EXPLICITLY BINDING matrix-rust-sdk-crypto:
        // By passing `cryptoModule: RustCrypto`, we instruct the js-sdk wrapper to delegate 
        // ALL E2EE cryptographic state machines and ratchets directly into the explicit 
        // `@matrix-org/matrix-sdk-crypto-wasm` WASM module you requested.
        await matrixClient.initRustCrypto({
          cryptoModule: RustCrypto, // <-- Explicitly injecting the Rust Crypto WebAssembly module!
          storePrefix: `healthcare_crypto_${payload.userId}_${payload.deviceId || "auto"}_`,
          storageBackend: "opfs",
        });
        console.log(matrixClient, "matrixClient");
        console.log(matrixClient.getVisibleRooms(), "matrixClient.getVisibleRooms()");
        // 4. START SYNCING:
        await matrixClient.startClient({ initialSyncLimit: 20 });
        await tryEnableKeyBackupRecovery();

        // Send userId so React can identify which bubbles are "mine"
        self.postMessage({ type: "MATRIX_READY", payload: { userId: payload.userId } });

        // 5. TIMELINE LISTENER:
        // For encrypted rooms, messages arrive as m.room.encrypted first.
        // This handles UNENCRYPTED rooms and messages that decrypt instantly.
        matrixClient.on("Room.timeline", (matrixEvent, room) => {
          if (matrixEvent?.isDecryptionFailure?.()) {
            void tryRequestMissingRoomKey(matrixEvent);
            return;
          }

          const msgType = matrixEvent.getType();
          // If already decrypted to m.room.message, forward it immediately
          if (msgType === "m.room.message" && !matrixEvent.isRedacted()) {
            const content = matrixEvent.getContent();
            if (isUndecryptablePlaceholder(content)) {
              // Avoid rendering Matrix fallback decrypt-error text as a normal chat message.
              void tryRequestMissingRoomKey(matrixEvent);
              return;
            }
            self.postMessage({
              type: "NEW_MESSAGE",
              payload: {
                roomId: room.roomId,
                eventId: matrixEvent.getId(),
                sender: matrixEvent.getSender(),
                body: content.body,
                msgtype: content.msgtype || "m.text",
                url: content.url ? matrixClient.mxcUrlToHttp(content.url) : null,
                format: content.format || null,
                formattedBody: content.formatted_body || null,
                info: content.info || null,
                forwardedFrom: content.forwarded_from || null,
                timestamp: matrixEvent.getTs(),
              }
            });
          }
        });

        // 5b. DECRYPTION LISTENER:
        // In E2EE rooms, the real payload arrives AFTER the timeline event via Event.decrypted.
        // This is the critical listener for encrypted healthcare messages.
        matrixClient.on("Event.decrypted", (matrixEvent) => {
          if (matrixEvent.getType() === "m.room.message" && !matrixEvent.isRedacted()) {
            const content = matrixEvent.getContent();
            if (isUndecryptablePlaceholder(content)) {
              return;
            }
            self.postMessage({
              type: "NEW_MESSAGE",
              payload: {
                roomId: matrixEvent.getRoomId(),
                eventId: matrixEvent.getId(),
                sender: matrixEvent.getSender(),
                body: content.body,
                msgtype: content.msgtype || "m.text",
                url: content.url ? matrixClient.mxcUrlToHttp(content.url) : null,
                format: content.format || null,
                formattedBody: content.formatted_body || null,
                info: content.info || null,
                forwardedFrom: content.forwarded_from || null,
                timestamp: matrixEvent.getTs(),
              }
            });
          }
        });

        // 6. SYNC LISTENER: Refresh room list after every sync cycle
        matrixClient.on("sync", (state) => {
          if (state === "PREPARED" || state === "SYNCING") {
            postVisibleRooms();
            void tryBootstrapPendingDirectEncryption();
            // Also cover the "creator wasn't running" case:
            // if we see a 1:1 DM without encryption, bootstrap it.
            void (async () => {
              for (const room of matrixClient.getVisibleRooms().filter((r) => r.getMyMembership() === "join")) {
                if (!roomHasEncryption(room) && room.getJoinedMembers().length === 2) {
                  await enableRoomEncryptionIfNeeded(room.roomId);
                }
              }
            })();
          }
        });

        // 7. INVITE LISTENER: Surface incoming room invites to the UI
        matrixClient.on("RoomMember.membership", (event, member) => {
          if (member.userId === payload.userId && member.membership === "invite") {
            self.postMessage({
              type: "ROOM_INVITE",
              payload: {
                roomId: member.roomId,
                invitedBy: event.getSender(),
                roomName: matrixClient.getRoom(member.roomId)?.name || member.roomId
              }
            });
          }
        });
      } catch (err) {
        console.log(err, "err");
        self.postMessage({ type: "ERROR", payload: err.message });
      }
      break;

    case "SEND_MESSAGE":
      if (matrixClient) {
        await matrixClient.sendTextMessage(payload.roomId, payload.text);
      }
      break;

    case "FORWARD_MESSAGE":
      if (matrixClient) {
        try {
          const { sourceRoomId, sourceEventId, targetRoomId } = payload || {};

          if (!sourceRoomId || !sourceEventId || !targetRoomId) {
            throw new Error("Missing forward payload fields");
          }

          const targetRoom = matrixClient.getRoom(targetRoomId);
          if (!targetRoom) throw new Error("Target room not found");

          // Security: never forward into a non-encrypted room.
          if (typeof targetRoom.hasEncryptionStateEvent === "function") {
            if (!targetRoom.hasEncryptionStateEvent()) {
              throw new Error("Target room is not E2EE enabled");
            }
          } else {
            // Fallback check: if SDK method is absent, be conservative.
            const encEvents = targetRoom?.currentState?.getStateEvents("m.room.encryption", "");
            if (!Array.isArray(encEvents) || encEvents.length === 0) {
              throw new Error("Target room is not E2EE enabled");
            }
          }

          const sourceRoom = matrixClient.getRoom(sourceRoomId);
          if (!sourceRoom) throw new Error("Source room not found");

          const sourceEvent = sourceRoom.findEventById(sourceEventId);
          if (!sourceEvent) throw new Error("Source event not available in client timeline");

          if (sourceEvent.getType?.() !== "m.room.message") {
            throw new Error("Source event is not a message");
          }
          if (sourceEvent.isRedacted?.()) {
            throw new Error("Cannot forward a redacted message");
          }

          const originalContent = sourceEvent.getContent?.() || {};
          if (isUndecryptablePlaceholder(originalContent)) {
            throw new Error("Cannot forward an undecryptable message");
          }

          // Forward by re-sending semantic content as a NEW event.
          // Encryption will happen automatically for the target room.
          const forwardedContent = {
            ...originalContent,
            forwarded_from: {
              sender: sourceEvent.getSender?.() || null,
              original_event_id: sourceEventId,
              // Timestamp is safe metadata for UI label/audit (still encrypted inside E2EE content).
              original_ts: sourceEvent.getTs?.() || null,
            },
          };

          await matrixClient.sendMessage(targetRoomId, forwardedContent);

          // Update room list so the target conversation becomes visible.
          postVisibleRooms();
        } catch (e) {
          self.postMessage({ type: "ERROR", payload: e?.message || String(e) });
        }
      }
      break;

    case "GET_ROOMS":
      if (matrixClient) {
        postVisibleRooms();
      }
      break;

    case "CREATE_GROUP_ROOM":
      if (matrixClient) {
        try {
          const response = await matrixClient.createRoom({
            name: payload.groupName,
            visibility: "private",
            preset: "private_chat",
            invite: payload.userIdsArray || [], // Array of matrix user IDs
            initial_state: [{
              type: "m.room.encryption",
              state_key: "",
              content: { algorithm: "m.megolm.v1.aes-sha2" } // Force Group E2EE
            }]
          });
          postVisibleRooms();
          self.postMessage({
            type: "GROUP_CREATED",
            payload: { roomId: response.room_id, groupName: payload.groupName },
          });
        } catch(e) {
          self.postMessage({ type: "ERROR", payload: e.message });
        }
      }
      break;

    case "CREATE_DIRECT_ROOM":
      if (matrixClient) {
        try {
          const existingRoom = findExistingDirectRoomWithUser(payload?.userId);
          if (existingRoom) {
            if (!roomHasEncryption(existingRoom)) {
              pendingDirectEncryption.set(existingRoom.roomId, payload?.userId);
            }
            self.postMessage({
              type: "DIRECT_CHAT_CREATED",
              payload: { roomId: existingRoom.roomId, userId: payload?.userId, reused: true },
            });
            break;
          }

          const response = await matrixClient.createRoom({
            visibility: "private",
            preset: "private_chat",
            is_direct: true,
            invite: payload?.userId ? [payload.userId] : [],
            // Keep new DM bootstrap reliable; encrypted-DM setup can be layered later.
          });

          if (payload?.userId) {
            pendingDirectEncryption.set(response.room_id, payload.userId);
          }
          postVisibleRooms();
          self.postMessage({
            type: "DIRECT_CHAT_CREATED",
            payload: { roomId: response.room_id, userId: payload?.userId },
          });
        } catch (e) {
          self.postMessage({ type: "ERROR", payload: e.message });
        }
      }
      break;

    case "GET_ROOM_MEMBERS":
      if (matrixClient) {
        const room = matrixClient.getRoom(payload.roomId);
        if (room) {
          const members = room
            .getMembers()
            .filter((m) => m.membership === "join" || m.membership === "invite")
            .map((m) => ({
            userId: m.userId,
            name: m.name || m.userId,
            powerLevel: m.powerLevel,
            membership: m.membership,
          }));
          self.postMessage({ type: 'ROOM_MEMBERS', payload: { roomId: payload.roomId, members } });
        }
      }
      break;

    case "INVITE_USER":
      if (matrixClient) {
        try {
          await matrixClient.invite(payload.roomId, payload.userId);
          self.postMessage({ type: 'USER_INVITED', payload: { roomId: payload.roomId, userId: payload.userId } });
        } catch(e) {
          self.postMessage({ type: "ERROR", payload: e.message });
        }
      }
      break;

    case "JOIN_ROOM":
      if (matrixClient) {
        try {
          await matrixClient.joinRoom(payload.roomId);
          postVisibleRooms();
          self.postMessage({ type: 'ROOM_JOINED', payload: { roomId: payload.roomId } });
        } catch(e) {
          self.postMessage({ type: "ERROR", payload: e.message });
        }
      }
      break;

    case "LEAVE_ROOM":
      if (matrixClient) {
        try {
          await matrixClient.leave(payload.roomId);
          postVisibleRooms();
          self.postMessage({ type: 'ROOM_LEFT', payload: { roomId: payload.roomId } });
        } catch(e) {
          self.postMessage({ type: "ERROR", payload: e.message });
        }
      }
      break;

    case "GET_USER_DIRECTORY":
      if (matrixClient) {
        try {
          const searchTerm = payload?.term || "";
          const result = await matrixClient.searchUserDirectory({
            term: searchTerm,
            limit: payload?.limit || 50,
          });
          const users = (result?.results || []).map((u) => ({
            userId: u.user_id,
            displayName: u.display_name || u.user_id,
            avatarUrl: u.avatar_url ? matrixClient.mxcUrlToHttp(u.avatar_url) : null,
          }));
          self.postMessage({ type: "USER_DIRECTORY_UPDATED", payload: users });
        } catch (e) {
          self.postMessage({ type: "ERROR", payload: e.message });
        }
      }
      break;

    case "UPLOAD_FILE":
      if (matrixClient) {
        try {
          // 1. Upload the raw content to the Matrix Media Repo
          const { content_uri } = await matrixClient.uploadContent(payload.file, {
            name: payload.name,
            type: payload.type
          });

          // 2. Wrap it in a proper Matrix message event
          // For E2EE rooms, sendTextMessage/sendMessage handles encryption transparently
          const content = {
            body: payload.name,
            msgtype: payload.type.startsWith('image/') ? "m.image" : "m.file",
            url: content_uri,
            info: {
              size: payload.size,
              mimetype: payload.type
            }
          };

          await matrixClient.sendMessage(payload.roomId, content);
          console.log("📎 File successfully uploaded and encrypted:", payload.name);
        } catch(e) {
          console.error("❌ File Upload Error:", e);
          self.postMessage({ type: "ERROR", payload: "File upload failed: " + e.message });
        }
      }
      break;
  }
};
