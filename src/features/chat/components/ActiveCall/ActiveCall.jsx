import React, { useEffect, useRef, useState } from 'react';
import { Button, Tooltip } from 'antd';
import {
  PhoneOutlined,
  AudioOutlined, AudioMutedOutlined,
  VideoCameraOutlined, StopOutlined,
} from '@ant-design/icons';
import styles from './ActiveCall.module.scss';

/**
 * ActiveCall — shown when callState.status is 'ringing_out' or 'ongoing'.
 * Displays local and remote video streams (audio-only calls hide video elements).
 */
export const ActiveCall = ({ callState, localStream, remoteStream, onHangup }) => {
  const isVisible =
    callState.status === 'ringing_out' ||
    callState.status === 'ongoing';

  if (!isVisible) return null;

  const localVideoRef  = useRef(null);
  const remoteVideoRef = useRef(null);

  const [muted,    setMuted]    = useState(false);
  const [camOff,   setCamOff]   = useState(false);
  const isVideo = callState.callType === 'video';

  // Attach local stream to the local <video> element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Attach remote stream to the remote <video/audio> element
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const toggleMute = () => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setMuted(m => !m);
  };

  const toggleCamera = () => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    setCamOff(c => !c);
  };

  const peerLabel = callState.callerId
    ? callState.callerId.split(':')[0]
    : (callState.status === 'ringing_out' ? 'Calling…' : 'Connected');

  return (
    <div className={styles.overlay}>
      <div className={styles.window}>

        {/* Remote stream */}
        <div className={styles.remoteArea}>
          {isVideo ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={styles.remoteVideo}
            />
          ) : (
            /* Audio-only: hidden audio element + avatar placeholder */
            <>
              <audio ref={remoteVideoRef} autoPlay />
              <div className={styles.audioAvatar}>
                {peerLabel.replace('@', '').charAt(0).toUpperCase()}
              </div>
            </>
          )}
          <div className={styles.peerLabel}>{peerLabel}</div>
          {callState.status === 'ringing_out' && (
            <div className={styles.statusBadge}>Ringing…</div>
          )}
        </div>

        {/* Local stream preview (video calls only) */}
        {isVideo && localStream && (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={styles.localVideo}
          />
        )}

        {/* Controls */}
        <div className={styles.controls}>
          <Tooltip title={muted ? 'Unmute' : 'Mute'}>
            <button className={`${styles.ctrlBtn} ${muted ? styles.active : ''}`} onClick={toggleMute}>
              {muted ? <AudioMutedOutlined /> : <AudioOutlined />}
            </button>
          </Tooltip>

          {isVideo && (
            <Tooltip title={camOff ? 'Camera on' : 'Camera off'}>
              <button className={`${styles.ctrlBtn} ${camOff ? styles.active : ''}`} onClick={toggleCamera}>
                {camOff ? <StopOutlined /> : <VideoCameraOutlined />}
              </button>
            </Tooltip>
          )}

          <Tooltip title="End call">
            <button className={`${styles.ctrlBtn} ${styles.hangupBtn}`} onClick={onHangup}>
              <PhoneOutlined rotate={135} />
            </button>
          </Tooltip>
        </div>

      </div>
    </div>
  );
};
