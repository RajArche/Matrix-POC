import React, { useState } from 'react';
import { Input, List } from 'antd';
import { SearchOutlined, PlusCircleOutlined } from '@ant-design/icons';
import { useSelector, useDispatch } from 'react-redux';
import { setActiveRoom } from '../../chatSlice';
import { CreateGroupModal } from '../CreateGroupModal/CreateGroupModal';

export const ConversationList = ({ createGroupChat, createDirectChat, joinRoom, leaveRoom, directoryUsers, searchDirectoryUsers }) => {
  // Get active rooms and selection state from Redux
  const rooms = useSelector((state) => state.chat.rooms);
  const activeRoomId = useSelector((state) => state.chat.activeRoomId);
  const dispatch = useDispatch();

  const [activeTab, setActiveTab] = useState('All');
  const tabs = ['All', 'Unread', 'Direct', 'Groups', 'Communities'];
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search Header */}
      <div style={{ padding: '24px 24px 16px 24px', borderBottom: '1px solid #e0e6ed' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>Conversation</h2>
          <PlusCircleOutlined 
             onClick={() => setIsModalOpen(true)} 
             style={{ fontSize: '20px', cursor: 'pointer', color: '#2d3436' }} 
             title="Start a new message or group chat"
          />
        </div>

        <Input
          prefix={<SearchOutlined style={{ color: '#bfbfbf', fontSize: '16px' }} />}
          placeholder="Search conversations..."
          size="large"
          style={{ borderRadius: '24px', marginBottom: '20px', backgroundColor: '#f5f6fa', border: 'none' }}
        />

        {/* Custom Pill Tabs to perfectly mimic SynApp Reference and fix specific spacing issues */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {tabs.map(tab => (
            <div
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '6px 16px',
                borderRadius: '20px',
                border: activeTab === tab ? '1px solid #0c4e4c' : '1px solid #e0e6ed',
                backgroundColor: activeTab === tab ? '#0c4e4c' : 'transparent',
                color: activeTab === tab ? 'white' : '#636e72',
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap' // Prevents text squishing
              }}
            >
              {tab}
            </div>
          ))}
        </div>
      </div>

      {/* Room List Engine */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {rooms.length === 0 ? (
          <div style={{ padding: '32px 24px', textAlign: 'center', color: '#636e72', backgroundColor: '#f9fafa', margin: '24px', borderRadius: '12px' }}>
            <p style={{ lineHeight: '1.6', marginBottom: '16px' }}>Let's check your directory together and connect with your colleagues to chat on SynApp.</p>
            <a href="#new" style={{ color: '#0c4e4c', textDecoration: 'underline', fontWeight: 500 }}>Start New Conversation</a>
          </div>
        ) : (
          <List
            dataSource={rooms}
            renderItem={room => (
              <List.Item
                // Click a room to set it Active in Redux
                onClick={() => dispatch(setActiveRoom(room.id))}
                style={{
                  padding: '16px 24px',
                  cursor: 'pointer',
                  backgroundColor: activeRoomId === room.id ? '#f5f6fa' : 'white',
                  borderLeft: activeRoomId === room.id ? '4px solid #0c4e4c' : '4px solid transparent',
                  transition: 'background-color 0.2s ease',
                  borderBottom: '1px solid #f0f0f0'
                }}
              >
                <List.Item.Meta
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: activeRoomId === room.id ? 600 : 400 }}>{room.name || room.id}</span>
                      {room.membership === 'invite' && (
                        <span style={{ fontSize: '10px', backgroundColor: '#fffbe6', color: '#faad14', border: '1px solid #ffe58f', padding: '1px 6px', borderRadius: '4px' }}>
                          Pending
                        </span>
                      )}
                    </div>
                  }
                  description={room.membership === 'invite' ? "You've been invited" : (room.unreadCount > 0 ? `${room.unreadCount} unread` : "No new messages")}
                />
              </List.Item>
            )}
          />
        )}
      </div>

      <CreateGroupModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreate={createGroupChat}
        onCreateDirect={createDirectChat}
        directoryUsers={directoryUsers}
        onSearchUsers={searchDirectoryUsers}
      />
    </div>
  );
};
