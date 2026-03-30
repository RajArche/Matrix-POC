import React, { useState } from 'react';
import { Form, Input, Button, Alert } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import axios from 'axios';
import { saveSession } from '../../utils/authStorage';
import styles from './Login.module.scss';

const HOMESERVER = 'http://172.16.7.246:8008';
const LOGIN_URL  = `${HOMESERVER}/_matrix/client/v3/login`;

export const Login = ({ onLogin }) => {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const handleSubmit = async ({ username, password }) => {
    setLoading(true);
    setError(null);

    try {
      const { data } = await axios.post(LOGIN_URL, {
        type:       'm.login.password',
        identifier: { type: 'm.id.user', user: username },
        password,
      });

      const session = {
        accessToken: data.access_token,
        userId:      data.user_id,
        deviceId:    data.device_id,
      };

      saveSession(session);
      onLogin(session);
    } catch (err) {
      const matrixMsg = err?.response?.data?.error;
      setError(matrixMsg || 'Unable to reach the server. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>💬</span>
          <h1 className={styles.appName}>SynApp Chat</h1>
          <p className={styles.tagline}>Secure · Encrypted · Private</p>
        </div>

        {error && (
          <Alert
            type="error"
            message={error}
            showIcon
            className={styles.alert}
            closable
            onClose={() => setError(null)}
          />
        )}

        <Form layout="vertical" onFinish={handleSubmit} autoComplete="off">
          <Form.Item
            name="username"
            rules={[{ required: true, message: 'Please enter your username' }]}
          >
            <Input
              prefix={<UserOutlined className={styles.inputIcon} />}
              placeholder="Username"
              size="large"
              className={styles.input}
              autoFocus
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password
              prefix={<LockOutlined className={styles.inputIcon} />}
              placeholder="Password"
              size="large"
              className={styles.input}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              loading={loading}
              block
              className={styles.loginBtn}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </Button>
          </Form.Item>
        </Form>

        <p className={styles.footer}>
          Connected to <code>{HOMESERVER}</code>
        </p>
      </div>
    </div>
  );
};
