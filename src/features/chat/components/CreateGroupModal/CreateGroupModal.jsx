import React, { useState } from 'react';
import { Modal, Form, Input, Select, Typography, Segmented } from 'antd';
import { SafetyCertificateOutlined, UserAddOutlined } from '@ant-design/icons';

const { Text } = Typography;

export const CreateGroupModal = ({ isOpen, onClose, onCreate, onCreateDirect, directoryUsers = [], onSearchUsers }) => {
  const [form] = Form.useForm();
  const [directForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('direct');

  const handleCreateGroup = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      // Execute the Matrix room creation passing name and member array
      onCreate(values.groupName, values.users || []);
      
      // Keep UI snappy: reset instantly on success assumption
      setTimeout(() => {
        setLoading(false);
        form.resetFields();
        onClose();
      }, 300);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const handleCreateDirect = async () => {
    try {
      const values = await directForm.validateFields();
      setLoading(true);
      onCreateDirect(values.userId);
      setTimeout(() => {
        setLoading(false);
        directForm.resetFields();
        onClose();
      }, 300);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {mode === 'direct' ? (
            <UserAddOutlined style={{ color: '#0c4e4c', fontSize: '20px' }} />
          ) : (
            <SafetyCertificateOutlined style={{ color: '#0c4e4c', fontSize: '20px' }} />
          )}
          <span>{mode === 'direct' ? 'Start New Chat' : 'Create Secure Group'}</span>
        </div>
      }
      open={isOpen}
      onOk={mode === 'direct' ? handleCreateDirect : handleCreateGroup}
      onCancel={onClose}
      confirmLoading={loading}
      okText={mode === 'direct' ? "Send Invite" : "Create Group"}
      okButtonProps={{ style: { backgroundColor: '#0c4e4c' }, size: 'large' }}
      cancelButtonProps={{ size: 'large' }}
    >
      <div style={{ marginTop: '16px', marginBottom: '16px' }}>
        <Segmented
          block
          options={[
            { label: 'Direct Chat', value: 'direct' },
            { label: 'Group Chat', value: 'group' }
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>

      {mode === 'direct' ? (
        <Form form={directForm} layout="vertical">
          <Form.Item
            name="userId"
            label={<span style={{ fontWeight: 500 }}>Invite User</span>}
            rules={[{ required: true, message: 'Please select or enter a user ID' }]}
            extra="Search by username and send 1:1 invite"
          >
            <Select
              showSearch
              placeholder="Search user (e.g. @dr.smith:localhost)"
              size="large"
              filterOption={false}
              onSearch={(value) => onSearchUsers?.(value)}
              onFocus={() => onSearchUsers?.("")}
              options={directoryUsers.map((u) => ({
                label: `${u.displayName} (${u.userId})`,
                value: u.userId
              }))}
            />
          </Form.Item>
        </Form>
      ) : (
        <>
          <div style={{ marginBottom: '24px', backgroundColor: '#e8f3f1', border: '1px solid #bce0d8', padding: '12px 16px', borderRadius: '8px' }}>
            <Text style={{ color: '#0c4e4c', fontSize: '13px' }}>
              🔒 This group will be permanently end-to-end encrypted using the Megolm algorithm. Medical records shared here cannot be decrypted by the Synapse server.
            </Text>
          </div>

          <Form form={form} layout="vertical">
            <Form.Item
              name="groupName"
              label={<span style={{ fontWeight: 500 }}>Group Name</span>}
              rules={[{ required: true, message: 'Please enter a group name' }]}
            >
              <Input placeholder="e.g. Cardiology Consults" size="large" />
            </Form.Item>

            <Form.Item
              name="users"
              label={<span style={{ fontWeight: 500 }}>Invite Members (Matrix IDs)</span>}
              extra="Search existing users or type exact Matrix IDs (e.g. @dr.smith:localhost)"
            >
              <Select
                mode="tags"
                placeholder="Search directory or type IDs..."
                size="large"
                tokenSeparators={[',', ' ']}
                showSearch
                filterOption={false}
                onSearch={(value) => onSearchUsers?.(value)}
                onFocus={() => onSearchUsers?.("")}
                options={directoryUsers.map((u) => ({
                  label: `${u.displayName} (${u.userId})`,
                  value: u.userId
                }))}
              />
            </Form.Item>
          </Form>
        </>
      )}
    </Modal>
  );
};
