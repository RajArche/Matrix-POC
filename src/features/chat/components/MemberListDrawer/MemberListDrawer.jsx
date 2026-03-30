import React from 'react';
import { Drawer, List, Avatar, Typography, Button } from 'antd';
import { UserOutlined, CrownOutlined } from '@ant-design/icons';

const { Text } = Typography;

export const MemberListDrawer = ({ isOpen, onClose, members, roomName }) => {
  return (
    <Drawer
      title={`Members in ${roomName}`}
      placement="right"
      onClose={onClose}
      open={isOpen}
      width={350}
    >
      <List
        dataSource={members}
        renderItem={member => (
          <List.Item>
            <List.Item.Meta
              avatar={<Avatar icon={<UserOutlined />} style={{ backgroundColor: '#0c4e4c' }} />}
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Text strong>{member.name}</Text>
                  {member.powerLevel >= 100 && <CrownOutlined style={{ color: '#f1c40f' }} title="Admin" />}
                </div>
              }
              description={member.userId}
            />
          </List.Item>
        )}
      />
      {members.length === 0 && (
        <div style={{ textAlign: 'center', color: '#636e72', marginTop: '20px' }}>
          Fetching members...
        </div>
      )}
    </Drawer>
  );
};
