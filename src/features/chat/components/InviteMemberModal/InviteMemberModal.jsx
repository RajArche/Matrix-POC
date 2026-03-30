import React, { useState } from 'react';
import { Modal, Form, Input, Typography, Alert } from 'antd';
import { UserAddOutlined } from '@ant-design/icons';

const { Text } = Typography;

export const InviteMemberModal = ({ isOpen, onClose, onInvite, currentRoomName }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleInvite = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      
      // Call the invite function passed from ChatWindow
      onInvite(values.userId);

      setLoading(false);
      form.resetFields();
      onClose();
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <UserAddOutlined style={{ color: '#0c4e4c' }} />
          <span>Invite to {currentRoomName || 'Room'}</span>
        </div>
      }
      open={isOpen}
      onOk={handleInvite}
      onCancel={onClose}
      confirmLoading={loading}
      okText="Send Invite"
      okButtonProps={{ style: { backgroundColor: '#0c4e4c' } }}
    >
      <div style={{ marginTop: '16px' }}>
        <Alert
          message="E2EE Security Note"
          description="When you invite a new member, the room's encryption keys will be securely shared with their authorized devices once they join."
          type="info"
          showIcon
          style={{ marginBottom: '20px' }}
        />
        
        <Form form={form} layout="vertical">
          <Form.Item
            name="userId"
            label="Matrix User ID"
            rules={[
              { required: true, message: 'Please enter the Matrix ID' },
              { pattern: /^@.+:.+$/, message: 'Format must be @user:homeserver.com' }
            ]}
          >
            <Input placeholder="@colleague:localhost" size="large" autoFocus />
          </Form.Item>
        </Form>
        <Text type="secondary" style={{ fontSize: '12px' }}>
          Example: @admin:localhost
        </Text>
      </div>
    </Modal>
  );
};
