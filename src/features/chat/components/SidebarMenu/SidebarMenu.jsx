import React, { useState } from 'react';
import {
  HomeOutlined,
  MessageOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  CloudOutlined,
  AppstoreOutlined,
  DownOutlined,
  UpOutlined,
  HeartOutlined
} from '@ant-design/icons';

export const SidebarMenu = () => {
  const [messagingOpen, setMessagingOpen] = useState(true);

  const NavItem = ({ icon, label, active, onClick, hasChildren, isOpen }) => (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 14px',
        margin: '4px 16px',
        borderRadius: '8px',
        backgroundColor: active ? '#0c4e4c' : 'transparent',
        color: active ? 'white' : '#636e72',
        cursor: 'pointer',
        fontWeight: active ? 500 : 400,
        transition: 'all 0.2s',
      }}
    >
      <div style={{ marginRight: '12px', fontSize: '18px', display: 'flex' }}>
        {icon}
      </div>
      <div style={{ flex: 1, fontSize: '14px' }}>{label}</div>
      {hasChildren && (
        <div style={{ fontSize: '12px' }}>
          {isOpen ? <UpOutlined /> : <DownOutlined />}
        </div>
      )}
    </div>
  );

  const SubItem = ({ label, active }) => (
    <div
      style={{
        padding: '8px 16px 8px 46px',
        margin: '2px 16px',
        borderRadius: '8px',
        backgroundColor: active ? '#f0f5f4' : 'transparent',
        color: active ? '#0c4e4c' : '#636e72',
        cursor: 'pointer',
        fontWeight: active ? 500 : 400,
        fontSize: '13px'
      }}
    >
      {label}
    </div>
  );

  return (
    <div style={{ padding: '20px 0', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Brand Logo */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#0c4e4c', fontSize: '24px', fontWeight: 700 }}>
          <HeartOutlined style={{ WebkitTextStroke: '1px #0c4e4c' }} />
          <span>SynApp</span>
        </div>
        <div style={{ border: '1px solid #e0e6ed', borderRadius: '6px', padding: '2px 6px', cursor: 'pointer', color: '#636e72', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ transform: 'rotate(90deg)', fontSize: '12px' }}>◫</span>
        </div>
      </div>

      {/* Nav Menu */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <NavItem icon={<HomeOutlined />} label="Home" />
        
        <NavItem 
          icon={<MessageOutlined />} 
          label="Clinical Messaging" 
          active={true} 
          hasChildren={true}
          isOpen={messagingOpen}
          onClick={() => setMessagingOpen(!messagingOpen)}
        />
        {messagingOpen && (
          <div style={{ marginBottom: '8px' }}>
            <SubItem label="Conversation" active={true} />
            <SubItem label="Communities" />
          </div>
        )}

        <NavItem icon={<CheckCircleOutlined />} label="Expertise" hasChildren={true} isOpen={false} />
        <NavItem icon={<FileTextOutlined />} label="Notes" />
        <NavItem icon={<CloudOutlined />} label="Cloud" />
        <NavItem icon={<AppstoreOutlined />} label="Clinical Tools" />
      </div>
    </div>
  );
};
