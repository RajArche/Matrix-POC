import React, { useEffect, useState } from 'react';
import styles from './ChatLayout.module.scss';
import { SidebarMenu } from '../SidebarMenu/SidebarMenu';
import { ConversationList } from '../ConversationList/ConversationList';
import { ChatWindow } from '../ChatWindow/ChatWindow';
import { useMatrixInit } from '../../hooks/useMatrixInit';
import { Input, Avatar, Badge, Popover, List, Spin } from 'antd';
import { SearchOutlined, BellOutlined, GlobalOutlined, MessageOutlined } from '@ant-design/icons';
import { useSelector, useDispatch } from 'react-redux';
import { setActiveRoom } from '../../chatSlice';
import axios from 'axios';

export const ChatLayout = () => {
  const dispatch = useDispatch();
  const searchResults = useSelector(state => state.chat.searchResults);
  const isSearching = useSelector(state => state.chat.isSearching);
  const rooms = useSelector(state => state.chat.rooms);
  const directoryUsers = useSelector(state => state.chat.directoryUsers);

  console.log(rooms, "rooms")

  const [searchQuery, setSearchQuery] = useState("");

  const { sendMessage, searchMessages, createGroupChat, createDirectChat, getRoomMembers, inviteUser, joinRoom, leaveRoom, uploadFile, searchDirectoryUsers, forwardMessage } = useMatrixInit(
    "@admin:localhost",
    "syt_YWRtaW4_hvVgepCsgOrhNDhNPOjs_22VskB",
    "http://172.16.7.246:8008",
    "FPQKSKQZHQ"
  );

  // Dispatch the search query natively to the SQLite Worker
  const handleSearch = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    searchMessages(val);
  };
  console.log(searchResults, "searchResults")

  // useEffect(() => {
  //   axios.post("https://glary-xiomara-stupefactive.ngrok-free.dev/api/auth/login", {
  //     username: "@admin:localhost",
  //     password: "12345678"
  //   }).then((res)=>{
  //  if(res?.status === 200){
  //   dispatch(setMatrixAccessToken(res?.data));
  //  }
  // }).catch((err)=>{
  //   console.log(err, "err")
  // })
  // }, [])


  const popoverContent = (
    <div style={{ width: '450px', maxHeight: '400px', overflowY: 'auto' }}>
      {isSearching ? (
        <div style={{ textAlign: 'center', padding: '30px' }}><Spin /></div>
      ) : searchResults.length === 0 && searchQuery ? (
        <div style={{ padding: '20px', textAlign: 'center', color: '#636e72' }}>No messages found for "{searchQuery}"</div>
      ) : (
        <List
          dataSource={searchResults}
          renderItem={(msg) => (
            <List.Item
              onClick={() => {
                dispatch(setActiveRoom(msg.roomId));
                setSearchQuery("");
                searchMessages("");
              }}
              style={{ cursor: 'pointer', padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f6fa'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <List.Item.Meta
                avatar={<Avatar style={{ backgroundColor: '#0c4e4c' }} icon={<MessageOutlined />} />}
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600 }}>{msg.sender.split(':')[0]}</span>
                    <span style={{ fontSize: '10px', color: '#b2bec3' }}>
                      {new Date(msg.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                }
                description={
                  <div>
                    <div style={{ color: '#2d3436', fontSize: '14px', marginBottom: '4px' }}>{msg.body}</div>
                    <div style={{ fontSize: '11px', color: '#27ae60' }}>In Room: {rooms.find(r => r.id === msg.roomId)?.name || msg.roomId}</div>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );

  return (
    <div className={styles.layoutContainer}>
      <div className={styles.sidebar}>
        <SidebarMenu />
      </div>
      <div className={styles.mainContent}>
        {/* Top App Header */}
        <div className={styles.topHeader}>
          <div className={styles.searchContainer}>
            <Popover
              content={popoverContent}
              title="Encrypted Vault Search"
              trigger="click"
              open={searchQuery.length > 0}
              placement="bottomLeft"
            >
              <Input
                prefix={<SearchOutlined style={{ color: '#bfbfbf', fontSize: '16px' }} />}
                placeholder="Search across all encrypted chats..."
                value={searchQuery}
                onChange={handleSearch}
                style={{ borderRadius: '8px', backgroundColor: '#f5f6fa', border: 'none', height: '40px', width: '500px' }}
                suffix={<span style={{ color: '#bfbfbf', fontSize: '11px', border: '1px solid #d9d9d9', borderRadius: '4px', padding: '2px 6px' }}>⌘K</span>}
              />
            </Popover>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.languageSelect}>
              <GlobalOutlined style={{ fontSize: '18px' }} /> <span>English</span> <span style={{ color: '#e0e6ed', margin: '0 8px' }}>|</span> <span style={{ color: '#636e72', fontWeight: 'normal' }}>Fr</span>
            </div>
            <Badge dot color="#e74c3c" offset={[-2, 6]}>
              <BellOutlined style={{ fontSize: '20px', color: '#2d3436' }} />
            </Badge>
            <Avatar src="https://i.pravatar.cc/150?img=11" size="large" />
          </div>
        </div>

        {/* Chat Interface Area */}
        <div className={styles.chatArea}>
          <div className={styles.conversationList}>
            <ConversationList
              createGroupChat={createGroupChat}
              createDirectChat={createDirectChat}
              joinRoom={joinRoom}
              leaveRoom={leaveRoom}
              directoryUsers={directoryUsers}
              searchDirectoryUsers={searchDirectoryUsers}
            />
          </div>
          <div className={styles.chatWindow}>
            {/* Pass the Matrix API functions down to the UI component */}
            <ChatWindow
              sendMessage={sendMessage}
              getRoomMembers={getRoomMembers}
              inviteUser={inviteUser}
              leaveRoom={leaveRoom}
              uploadFile={uploadFile}
              joinRoom={joinRoom}
              forwardMessage={forwardMessage}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
