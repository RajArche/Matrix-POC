import { useEffect, useRef, useCallback, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { setCallStatus, setIncomingCall, clearCall } from '../chatSlice';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

let _callIdSeq = 0;
const generateCallId = () => `call_${Date.now()}_${++_callIdSeq}`;

// Stable empty array so selectors that fall back to [] don't return a new
// reference on every render, which would cause infinite React-Redux loops.
const EMPTY_ARRAY = [];

/**
 * useCallManager
 *
 * Manages the full WebRTC call lifecycle on the main thread.
 * Matrix call signaling (m.call.*) is relayed through the existing matrixWorker
 * via `sendCallEvent` — no second Matrix client is created.
 *
 * Call events arrive via `callEventRef`, a shared ref populated by useMatrixInit.
 * This avoids routing every ICE-candidate through Redux (which caused rapid
 * dispatch cycles and "Maximum update depth exceeded" errors).
 *
 * Returns:
 *   placeVoiceCall(roomId) — start an outgoing audio call
 *   placeVideoCall(roomId) — start an outgoing video call
 *   answerCall()           — accept the current incoming call
 *   rejectCall()           — reject the current incoming call
 *   hangup()               — end the active / ringing call
 *   localStream            — MediaStream of local camera/mic (or null)
 *   remoteStream           — MediaStream of remote peer (or null)
 *   callState              — current call state slice from Redux
 */
export const useCallManager = (sendCallEvent, callEventRef) => {
  const dispatch = useDispatch();

  const callState     = useSelector(s => s.chat.callState);
  const rooms         = useSelector(s => s.chat.rooms);
  const membersByRoom = useSelector(s => s.chat.membersByRoom);
  const currentUserId = useSelector(s => s.chat.currentUserId);

  // Keep a ref-stable snapshot of callState so async WebRTC callbacks
  // don't close over stale values.
  const callStateRef = useRef(callState);
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  const pcRef             = useRef(null);
  const localStreamRef    = useRef(null);
  const pendingCandidates = useRef([]);

  const [localStream,  setLocalStream]  = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  // ── Precondition validation ──────────────────────────────────────────────
  const validateCallPreconditions = useCallback((roomId) => {
    const room = rooms.find(r => r.id === roomId);
    if (!room) throw new Error('Room not found.');
    if (!room.encryptionEnabled) throw new Error('Room is not E2EE encrypted.');
    if (room.membership !== 'join') throw new Error('You have not joined this room.');
    const members = membersByRoom[roomId] ?? EMPTY_ARRAY;
    const joined  = members.filter(m => m.membership === 'join');
    if (joined.length < 2) throw new Error('User is not available yet — they need to join the room first.');
  }, [rooms, membersByRoom]);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  const cleanupCall = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.onicecandidate         = null;
      pcRef.current.ontrack                = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    pendingCandidates.current = [];
    setLocalStream(null);
    setRemoteStream(null);
  }, []);

  // ── RTCPeerConnection factory ─────────────────────────────────────────────
  const createPeerConnection = useCallback((roomId, callId) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendCallEvent(roomId, 'm.call.candidates', {
          call_id: callId,
          version: 1,
          candidates: [e.candidate.toJSON()],
        });
      }
    };

    pc.ontrack = (e) => {
      if (e.streams?.[0]) setRemoteStream(e.streams[0]);
    };

    // Detect remote hangup / network drop via connection-state changes.
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'failed' || st === 'disconnected' || st === 'closed') {
        dispatch(clearCall());
        cleanupCall();
      }
    };

    return pc;
  }, [sendCallEvent, dispatch, cleanupCall]);

  // ── getUserMedia helper ───────────────────────────────────────────────────
  const acquireMedia = async (callType) => {
    const constraints = callType === 'video'
      ? { audio: true, video: true }
      : { audio: true, video: false };
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      throw new Error(`Media permission denied: ${e.message}`);
    }
  };

  // ── Place outgoing call ───────────────────────────────────────────────────
  const placeCall = useCallback(async (roomId, callType) => {
    validateCallPreconditions(roomId);

    const callId = generateCallId();
    const stream = await acquireMedia(callType);
    localStreamRef.current = stream;
    setLocalStream(stream);

    const pc = createPeerConnection(roomId, callId);
    pcRef.current = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    dispatch(setCallStatus({ status: 'ringing_out', callId, roomId, callType }));

    sendCallEvent(roomId, 'm.call.invite', {
      call_id: callId,
      version:  1,
      lifetime: 60000,
      offer:    { type: offer.type, sdp: offer.sdp },
      capabilities: { m_call_transfer: false },
    });
  }, [validateCallPreconditions, createPeerConnection, sendCallEvent, dispatch]);

  const placeVoiceCall = useCallback((roomId) => placeCall(roomId, 'voice'), [placeCall]);
  const placeVideoCall = useCallback((roomId) => placeCall(roomId, 'video'), [placeCall]);

  // ── Answer incoming call ──────────────────────────────────────────────────
  const answerCall = useCallback(async () => {
    const { callId, roomId, callType, offerSdp } = callStateRef.current;
    if (!callId || !offerSdp) return;

    const stream = await acquireMedia(callType);
    localStreamRef.current = stream;
    setLocalStream(stream);

    const pc = createPeerConnection(roomId, callId);
    pcRef.current = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });

    for (const candidate of pendingCandidates.current) {
      await pc.addIceCandidate(candidate).catch(() => {});
    }
    pendingCandidates.current = [];

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    dispatch(setCallStatus({ status: 'ongoing' }));

    sendCallEvent(roomId, 'm.call.answer', {
      call_id: callId,
      version: 1,
      answer: { type: answer.type, sdp: answer.sdp },
    });
  }, [createPeerConnection, sendCallEvent, dispatch]);

  // ── Reject / hangup ───────────────────────────────────────────────────────
  const sendHangup = useCallback((reason = 'user_hangup') => {
    const { callId, roomId } = callStateRef.current;
    if (callId && roomId) {
      sendCallEvent(roomId, 'm.call.hangup', { call_id: callId, version: 1, reason });
    }
  }, [sendCallEvent]);

  const rejectCall = useCallback(() => {
    sendHangup('user_hangup');
    cleanupCall();
    dispatch(clearCall());
  }, [sendHangup, cleanupCall, dispatch]);

  const hangup = useCallback(() => {
    sendHangup('user_hangup');
    cleanupCall();
    dispatch(clearCall());
  }, [sendHangup, cleanupCall, dispatch]);

  // ── Process incoming Matrix call events ──────────────────────────────────
  // This function is registered into callEventRef so useMatrixInit can call
  // it directly (no Redux roundtrip) whenever a CALL_EVENT arrives from the
  // worker. Bypassing Redux for signaling eliminates the rapid dispatch cycle
  // that caused "Maximum update depth exceeded" during ICE negotiation.
  const processCallEvent = useCallback((event) => {
    const { callEventType, sender, content, roomId } = event;

    // Ignore events we ourselves sent (Matrix echoes them back to us).
    if (sender === currentUserId) return;

    const current = callStateRef.current;

    switch (callEventType) {

      case 'm.call.invite': {
        if (current.status !== 'idle') {
          sendCallEvent(roomId, 'm.call.hangup', {
            call_id: content.call_id, version: 1, reason: 'user_busy',
          });
          return;
        }
        const hasVideo = content.offer?.sdp?.includes('m=video') ?? false;
        dispatch(setIncomingCall({
          callId:   content.call_id,
          roomId,
          callType: hasVideo ? 'video' : 'voice',
          callerId: sender,
          offerSdp: content.offer?.sdp ?? null,
        }));
        break;
      }

      case 'm.call.answer': {
        if (
          current.status === 'ringing_out' &&
          content.call_id === current.callId &&
          pcRef.current
        ) {
          pcRef.current
            .setRemoteDescription({ type: 'answer', sdp: content.answer?.sdp })
            .then(() => {
              pendingCandidates.current.forEach(c =>
                pcRef.current?.addIceCandidate(c).catch(() => {})
              );
              pendingCandidates.current = [];
            })
            .catch(e => console.warn('[Call] setRemoteDescription(answer) failed:', e));
          dispatch(setCallStatus({ status: 'ongoing' }));
        }
        break;
      }

      case 'm.call.candidates': {
        if (content.call_id !== current.callId || !content.candidates) break;
        content.candidates.forEach(raw => {
          // Skip end-of-gathering sentinel (empty candidate string)
          if (!raw || raw.candidate === '' || raw.candidate == null) return;
          if (raw.sdpMid == null && raw.sdpMLineIndex == null) return;
          try {
            const candidate = new RTCIceCandidate(raw);
            if (pcRef.current?.remoteDescription) {
              pcRef.current.addIceCandidate(candidate).catch(() => {});
            } else {
              pendingCandidates.current.push(candidate);
            }
          } catch (e) {
            console.warn('[Call] Ignoring malformed ICE candidate:', e.message);
          }
        });
        break;
      }

      case 'm.call.hangup':
      case 'm.call.reject': {
        if (content.call_id === current.callId) {
          cleanupCall();
          dispatch(clearCall());
        }
        break;
      }

      default:
        break;
    }
  }, [currentUserId, sendCallEvent, cleanupCall, dispatch]);

  // Register the handler into the shared ref every render so it always has
  // fresh closures. The ref is written synchronously (no useEffect delay),
  // ensuring it's ready before any CALL_EVENT can arrive.
  if (callEventRef) {
    callEventRef.current = processCallEvent;
  }

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => {
    cleanupCall();
    if (callEventRef) callEventRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanupCall]);

  return {
    placeVoiceCall,
    placeVideoCall,
    answerCall,
    rejectCall,
    hangup,
    localStream,
    remoteStream,
    callState,
  };
};
