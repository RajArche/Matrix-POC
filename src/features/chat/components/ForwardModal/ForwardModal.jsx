import React, { useEffect, useState } from "react";
import { Modal, Form, Select, Typography, Alert } from "antd";

const { Text } = Typography;

/**
 * ForwardModal
 * - Shows a list of rooms the user can forward to.
 * - Only rooms with E2EE enabled (and joined) are offered for healthcare safety.
 */
export const ForwardModal = ({
  isOpen,
  onClose,
  rooms,
  sourceRoomId,
  sourceSender,
  sourceBodyPreview,
  onForward,
}) => {
  const [form] = Form.useForm();
  const [initialTargetId, setInitialTargetId] = useState(null);

  const eligibleRooms = (rooms || []).filter(
    (r) => r.membership === "join" && r.encryptionEnabled && r.id !== sourceRoomId
  );

  useEffect(() => {
    // Default to the first eligible room whenever the modal opens.
    if (isOpen) {
      const first = eligibleRooms[0]?.id ?? null;
      setInitialTargetId(first);
      form.setFieldsValue({ targetRoomId: first });
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal
      title="Forward message"
      open={isOpen}
      onOk={() => form.submit()}
      onCancel={onClose}
      okText="Forward"
      cancelText="Cancel"
    >
      <div style={{ marginBottom: 16 }}>
        <Alert
          type="info"
          showIcon
          message="Forward as a new encrypted message"
          description="The forwarded message is sent as a new event in the target room (never reuses the original event id)."
          style={{ marginBottom: 16 }}
        />
        {sourceSender && (
          <Text type="secondary">
            Forwarded from: <Text strong>{sourceSender}</Text>
          </Text>
        )}
        {sourceBodyPreview && (
          <div style={{ marginTop: 8 }}>
            <Text>{sourceBodyPreview}</Text>
          </div>
        )}
      </div>

      {eligibleRooms.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="No eligible target rooms"
          description="You can only forward to rooms where E2EE is enabled."
        />
      ) : (
        <Form form={form} layout="vertical" onFinish={(values) => onForward(values.targetRoomId)}>
          <Form.Item
            name="targetRoomId"
            label="Target room"
            rules={[{ required: true, message: "Select a room" }]}
          >
            <Select
              options={eligibleRooms.map((r) => ({
                label: r.name || r.id,
                value: r.id,
              }))}
            />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
};

