import React from 'react';
import { Button, Avatar } from 'antd';
import { PhoneOutlined, CloseOutlined, VideoCameraOutlined } from '@ant-design/icons';
import styles from './CallOverlay.module.scss';

/**
 * CallOverlay — shown when callState.status === 'ringing_in'.
 * Lets the callee accept or reject the incoming call.
 */
export const CallOverlay = ({ callState, onAnswer, onReject }) => {
  if (callState.status !== 'ringing_in') return null;

  const isVideo = callState.callType === 'video';
  const callerName = callState.callerId?.split(':')[0] ?? 'Unknown';

  return (
    <div className={styles.backdrop}>
      <div className={styles.card}>
        <div className={styles.pulse} />

        <Avatar
          size={72}
          style={{ backgroundColor: '#0c4e4c', fontSize: 28, fontWeight: 700, zIndex: 1 }}
        >
          {callerName.replace('@', '').charAt(0).toUpperCase()}
        </Avatar>

        <div className={styles.callerName}>{callerName}</div>
        <div className={styles.callType}>
          {isVideo ? 'Incoming video call…' : 'Incoming voice call…'}
        </div>

        <div className={styles.actions}>
          <button className={styles.rejectBtn} onClick={onReject} title="Decline">
            <CloseOutlined />
          </button>
          <button className={styles.acceptBtn} onClick={onAnswer} title="Accept">
            {isVideo ? <VideoCameraOutlined /> : <PhoneOutlined />}
          </button>
        </div>
      </div>
    </div>
  );
};
