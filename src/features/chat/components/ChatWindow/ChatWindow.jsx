import React, { useState, useRef, useEffect } from 'react';
import { Input, Button, Dropdown, Menu, Tooltip, Typography, message as antdMessage } from 'antd';
import { PhoneOutlined, VideoCameraOutlined, MoreOutlined, SendOutlined, TeamOutlined, UserAddOutlined, PaperClipOutlined, LogoutOutlined, UnorderedListOutlined, CheckOutlined, CloseOutlined, MailOutlined, CopyOutlined, ShareAltOutlined } from '@ant-design/icons';
import { useSelector, useDispatch } from 'react-redux';
import { InviteMemberModal } from '../InviteMemberModal/InviteMemberModal';
import { MemberListDrawer } from '../MemberListDrawer/MemberListDrawer';
import { ForwardModal } from '../ForwardModal/ForwardModal';
import { setActiveRoom } from '../../chatSlice';

const { Text } = Typography;

export const ChatWindow = ({ sendMessage, getRoomMembers, inviteUser, leaveRoom, uploadFile, joinRoom, forwardMessage, placeVoiceCall, placeVideoCall }) => {
  const dispatch = useDispatch();
  const [text, setText] = useState("");
  const lastSendAtRef = useRef(0);
  const [callError, setCallError] = useState(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isMemberListOpen, setIsMemberListOpen] = useState(false);
  const fileInputRef = useRef(null);
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);
  const [forwardSourceEventId, setForwardSourceEventId] = useState(null);
  const [forwardSourceSender, setForwardSourceSender] = useState(null);
  const [forwardSourceBodyPreview, setForwardSourceBodyPreview] = useState(null);

  // 1. Get active room, logged-in user from Redux
  const activeRoomId   = useSelector(state => state.chat.activeRoomId);
  const currentUserId  = useSelector(state => state.chat.currentUserId);
  const rooms          = useSelector(state => state.chat.rooms);
  const membersByRoom  = useSelector(state => state.chat.membersByRoom);
  const callState      = useSelector(state => state.chat.callState);
  const activeRoom     = rooms.find(r => r.id === activeRoomId);
  const encryptionEnabled = !!activeRoom?.encryptionEnabled;

  // Call precondition: calls are only available when the room is encrypted,
  // the current user has joined, and at least one other member is present.
  const roomMembers    = membersByRoom[activeRoomId] || [];
  const joinedMembers  = roomMembers.filter(m => m.membership === 'join');
  const callsAvailable =
    encryptionEnabled &&
    activeRoom?.membership === 'join' &&
    joinedMembers.length >= 2 &&
    callState.status === 'idle';

  const handleCall = async (type) => {
    setCallError(null);
    const fn = type === 'video' ? placeVideoCall : placeVoiceCall;
    try {
      await fn(activeRoomId);
    } catch (e) {
      setCallError(e.message);
      // Auto-clear after 4 s
      setTimeout(() => setCallError(null), 4000);
    }
  };

  // 2. Fetch messages and members for this room
  const messages = useSelector(state => activeRoomId ? state.chat.messagesByRoom[activeRoomId] || [] : []);
  const members = useSelector(state => activeRoomId ? state.chat.membersByRoom[activeRoomId] || [] : []);

  const isUndecryptable = (msg) => {
    const body = msg?.body || "";
    return typeof body === "string" && (body.includes("Unable to decrypt") || body.includes("[Unable to decrypt"));
  };

  const handleCopyMessage = async (msg) => {
    try {
      if (!msg || isUndecryptable(msg)) return;

      // For media, copy URL (if present); for text copy body.
      if (msg.msgtype === "m.image" || msg.msgtype === "m.file") {
        const url = msg.url || "";
        const meta = msg.body ? ` (${msg.body})` : "";
        await navigator.clipboard.writeText(`${url}${meta}`.trim());
      } else {
        // If we have formatted HTML, try to copy both text/plain + text/html.
        // If the browser does not support rich clipboard writes, fall back to plain text.
        if (msg.formattedBody) {
          try {
            const htmlBlob = new Blob([msg.formattedBody], { type: "text/html" });
            const textBlob = new Blob([msg.body || ""], { type: "text/plain" });
            await navigator.clipboard.write([
              new ClipboardItem({
                "text/plain": textBlob,
                "text/html": htmlBlob,
              }),
            ]);
          } catch (_) {
            await navigator.clipboard.writeText(msg.body || "");
          }
        } else {
          await navigator.clipboard.writeText(msg.body || "");
        }
      }
      antdMessage.success("Copied to clipboard");
    } catch (e) {
      antdMessage.error("Copy failed");
    }
  };

  const openForwardModal = (msg) => {
    if (!msg || isUndecryptable(msg)) return;
    setForwardSourceEventId(msg.eventId);
    setForwardSourceSender(msg.sender);
    setForwardSourceBodyPreview(msg.msgtype === "m.image" || msg.msgtype === "m.file" ? (msg.body || "Media") : (msg.body || ""));
    setIsForwardModalOpen(true);
  };

  const handleForwardConfirmed = (targetRoomId) => {
    if (!forwardMessage) return;
    if (!forwardSourceEventId) return;

    // Security: still rely on worker E2EE enforcement as final gate.
    forwardMessage(activeRoomId, forwardSourceEventId, targetRoomId);
    // UX: navigate user to the target room immediately.
    dispatch(setActiveRoom(targetRoomId));
    setIsForwardModalOpen(false);
    setForwardSourceEventId(null);
  };

  // 3. Fetch members whenever the active room changes
  useEffect(() => {
    if (activeRoomId && getRoomMembers) {
      getRoomMembers(activeRoomId);
    }
  }, [activeRoomId, getRoomMembers]);

  // 4. Auto-scroll to bottom on new messages
  const bottomRef = useRef(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 4. The Send Flow Trigger
  const handleSend = () => {
    const now = Date.now();
    // Prevent accidental double-sends (Enter + click) within a short window.
    if (now - lastSendAtRef.current < 500) return;
    lastSendAtRef.current = now;
    if (!encryptionEnabled) return;
    if (text.trim() && activeRoomId) {
      sendMessage(activeRoomId, text); // Fires postMessage to the Worker!
      setText("");                     // Clear the input
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!encryptionEnabled) return;
    if (file && activeRoomId) {
      uploadFile(activeRoomId, file);
      // Clear for next upload
      e.target.value = null;
    }
  };

  const menuItems = [
    {
      key: 'members',
      icon: <UnorderedListOutlined />,
      label: 'Member List',
      onClick: () => setIsMemberListOpen(true)
    },
    {
      type: 'divider',
    },
    {
      key: 'leave',
      icon: <LogoutOutlined />,
      label: 'Leave Room',
      danger: true,
      onClick: () => leaveRoom(activeRoomId)
    }
  ];

  // If no room is selected, show an empty state
  if (!activeRoomId) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#636e72', height: '100%' }}>Select a conversation from the sidebar to start messaging.</div>;
  }

  // NEW: Invitation Management UI
  if (activeRoom?.membership === 'invite') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f6fa', height: '100%' }}>
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.05)', maxWidth: '500px', width: '90%', textAlign: 'center' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', backgroundColor: '#e8f3f1', color: '#0c4e4c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', margin: '0 auto 24px' }}>
            <MailOutlined />
          </div>
          <h2 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>Security Invitation</h2>
          <p style={{ color: '#636e72', fontSize: '16px', marginBottom: '32px' }}>
            You have been invited to join <Text strong style={{ color: '#0c4e4c' }}>{activeRoom?.name || activeRoomId}</Text>. 
            Upon joining, your device will automatically negotiate E2EE session keys to secure your medical data.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
            <Button 
              type="primary" 
              size="large" 
              icon={<CheckOutlined />} 
              onClick={() => joinRoom(activeRoomId)}
              style={{ backgroundColor: '#0c4e4c', borderRadius: '12px', height: '48px', padding: '0 32px' }}
            >
              Accept & Join
            </Button>
            <Button 
              size="large" 
              icon={<CloseOutlined />} 
              onClick={() => leaveRoom(activeRoomId)}
              style={{ borderRadius: '12px', height: '48px', padding: '0 32px' }}
            >
              Reject
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {!encryptionEnabled && (
        <div style={{ padding: '12px 24px', backgroundColor: '#fffbe6', color: '#614700', borderBottom: '1px solid #ffe58f' }}>
          Encrypted chat is not ready yet. Sending is disabled until E2EE is enabled for this room.
        </div>
      )}
      {callError && (
        <div style={{ padding: '10px 24px', backgroundColor: '#fff2f0', color: '#a8071a', borderBottom: '1px solid #ffccc7', fontSize: '13px' }}>
          ⚠ {callError}
        </div>
      )}
      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #e0e6ed', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#0c4e4c', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
            {(activeRoom?.name || 'R').charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {activeRoom?.name || activeRoomId}
              {members.length > 2 && (
                <span style={{ fontSize: '12px', backgroundColor: '#e8f3f1', color: '#0c4e4c', padding: '2px 8px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <TeamOutlined /> {members.length} members
                </span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: '#27ae60' }}>🔒 End-to-End Encrypted</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '16px', fontSize: '20px', color: '#2d3436' }}>
          <UserAddOutlined 
            style={{ cursor: 'pointer', color: '#0c4e4c' }} 
            onClick={() => setIsInviteModalOpen(true)}
            title="Invite someone to this room"
          />
          <Tooltip title={callsAvailable ? 'Voice call' : joinedMembers.length < 2 ? 'User not available yet' : 'Call unavailable'}>
            <PhoneOutlined
              onClick={() => callsAvailable && handleCall('voice')}
              style={{
                cursor: callsAvailable ? 'pointer' : 'not-allowed',
                color:  callsAvailable ? '#2d3436' : '#b2bec3',
              }}
            />
          </Tooltip>
          <Tooltip title={callsAvailable ? 'Video call' : joinedMembers.length < 2 ? 'User not available yet' : 'Call unavailable'}>
            <VideoCameraOutlined
              onClick={() => callsAvailable && handleCall('video')}
              style={{
                cursor: callsAvailable ? 'pointer' : 'not-allowed',
                color:  callsAvailable ? '#2d3436' : '#b2bec3',
              }}
            />
          </Tooltip>
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <MoreOutlined style={{ cursor: 'pointer' }} />
          </Dropdown>
        </div>
      </div>

      <InviteMemberModal 
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        currentRoomName={activeRoom?.name}
        onInvite={(userId) => inviteUser(activeRoomId, userId)}
      />

      <MemberListDrawer 
        isOpen={isMemberListOpen}
        onClose={() => setIsMemberListOpen(false)}
        members={members}
        roomName={activeRoom?.name}
      />

      <ForwardModal
        isOpen={isForwardModalOpen}
        onClose={() => setIsForwardModalOpen(false)}
        rooms={rooms}
        sourceRoomId={activeRoomId}
        sourceSender={forwardSourceSender}
        sourceBodyPreview={forwardSourceBodyPreview}
        onForward={handleForwardConfirmed}
      />

      {/* Message Timeline Area */}
      <div style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: '#fafafa' }}>
        {messages.map((msg, index) => {
          // Use currentUserId from Redux for correct bubble side alignment
          const isMe = msg.sender === currentUserId;
          const showForwarded = !!msg.forwardedFrom;
          const forwardedFromSender = msg.forwardedFrom?.sender;
          return (
            <div key={index} style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', display: 'flex', flexDirection: 'column', maxWidth: '70%' }}>
              {!isMe && (
                <div style={{ fontSize: '11px', color: '#636e72', marginBottom: '4px', paddingLeft: '4px' }}>{msg.sender}</div>
              )}
              {showForwarded && (
                <div style={{ fontSize: '11px', color: '#0c4e4c', marginBottom: '6px', paddingLeft: '4px', fontWeight: 500 }}>
                  Forwarded{forwardedFromSender ? ` from ${forwardedFromSender}` : ''}
                </div>
              )}
              <div style={{
                backgroundColor: isMe ? '#0c4e4c' : '#ffffff',
                color: isMe ? 'white' : '#2d3436',
                padding: '12px 16px',
                borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                wordBreak: 'break-word'
              }}>
                <div style={{ fontSize: '14px', lineHeight: '1.5' }}>
                  {msg.msgtype === "m.image" ? (
                    <img 
                      src={msg.url} 
                      alt={msg.body} 
                      style={{ maxWidth: '100%', borderRadius: '8px', cursor: 'pointer', marginTop: '4px' }}
                      onClick={() => window.open(msg.url, '_blank')}
                    />
                  ) : msg.msgtype === "m.file" ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', backgroundColor: isMe ? '#ffffff22' : '#f5f6fa', borderRadius: '8px', marginTop: '4px' }}>
                      <PaperClipOutlined />
                      <a href={msg.url} target="_blank" rel="noopener noreferrer" style={{ color: isMe ? 'white' : '#0c4e4c', textDecoration: 'underline' }}>
                        {msg.body}
                      </a>
                    </div>
                  ) : (
                    msg.body
                  )}
                </div>
                <div style={{ fontSize: '10px', marginTop: '4px', opacity: 0.7, textAlign: isMe ? 'right' : 'left' }}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              {/* Message actions (Copy + Forward) */}
              <div style={{ display: 'flex', gap: '12px', marginTop: '6px', alignSelf: isMe ? 'flex-end' : 'flex-start' }}>
                <Tooltip title="Copy message">
                  <CopyOutlined
                    onClick={() => handleCopyMessage(msg)}
                    style={{ cursor: isUndecryptable(msg) ? 'not-allowed' : 'pointer', color: '#636e72' }}
                  />
                </Tooltip>
                <Tooltip title="Forward message">
                  <ShareAltOutlined
                    onClick={() => openForwardModal(msg)}
                    style={{ cursor: isUndecryptable(msg) ? 'not-allowed' : 'pointer', color: '#636e72' }}
                  />
                </Tooltip>
              </div>
            </div>
          );
        })}
        {/* Auto-scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div style={{ padding: '20px 24px', borderTop: '1px solid #e0e6ed' }}>
        <Input
          size="large"
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPressEnter={handleSend}
          disabled={!encryptionEnabled}
          suffix={
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                onChange={handleFileUpload}
              />
              <Tooltip title="Attach File or Image">
                <PaperClipOutlined 
                  onClick={() => encryptionEnabled && fileInputRef.current?.click()} 
                  style={{ fontSize: '18px', cursor: 'pointer', color: '#636e72' }}
                />
              </Tooltip>
              <Button type="text" icon={<SendOutlined />} onClick={handleSend} style={{ color: '#0c4e4c' }} />
            </div>
          }
          style={{ borderRadius: '20px' }}
        />
      </div>
    </div>
  );
};

