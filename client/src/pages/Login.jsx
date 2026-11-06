import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Form, Input } from 'antd';
import { useDispatch } from 'react-redux';
import AuthLayout from '../components/AuthLayout';
import { useLoginMutation } from '../store/api';
import { beginSession } from '../store/session';
import { errText } from '../utils/format';

export default function Login() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [login, { isLoading }] = useLoginMutation();
  const [error, setError] = useState('');

  const onFinish = async (values) => {
    setError('');
    try {
      const result = await login(values).unwrap();
      beginSession(dispatch, result);
      navigate('/overview');
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to the ledger built from your own messages."
      error={error}
      footer={<>New to LedgerSMS? <Link to="/signup">Create an account</Link></>}
    >
      <Form className="ls-form" layout="vertical" requiredMark={false} onFinish={onFinish}>
        <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}>
          <Input autoComplete="username" placeholder="you@studio.com" size="large" />
        </Form.Item>
        <Form.Item label="Password" name="password" rules={[{ required: true, message: 'Enter your password' }]}>
          <Input.Password autoComplete="current-password" placeholder="Your password" size="large" />
        </Form.Item>
        <Button type="primary" htmlType="submit" size="large" block loading={isLoading}>Sign in</Button>
      </Form>
    </AuthLayout>
  );
}
