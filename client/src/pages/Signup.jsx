import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Form, Input } from 'antd';
import { useDispatch } from 'react-redux';
import AuthLayout from '../components/AuthLayout';
import { useSignupMutation } from '../store/api';
import { beginSession } from '../store/session';
import { errText, passwordScore, PASSWORD_LABELS } from '../utils/format';

export default function Signup() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [signup, { isLoading }] = useSignupMutation();
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const score = passwordScore(password);

  const onFinish = async (values) => {
    setError('');
    try {
      const result = await signup(values).unwrap();
      beginSession(dispatch, result);
      navigate('/overview');
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <AuthLayout
      title="Open your ledger"
      subtitle="A private workspace for the SMS your banks already send."
      error={error}
      footer={<>Already registered? <Link to="/login">Sign in</Link></>}
    >
      <Form className="ls-form" layout="vertical" requiredMark={false} onFinish={onFinish}>
        <Form.Item label="Name" name="name" rules={[{ required: true, min: 2, message: 'Enter your name' }]}>
          <Input autoComplete="name" placeholder="Khizar" size="large" />
        </Form.Item>
        <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}>
          <Input autoComplete="email" placeholder="you@studio.com" size="large" />
        </Form.Item>
        <Form.Item
          label="Password"
          name="password"
          rules={[
            { required: true, message: 'Choose a password' },
            { min: 8, message: 'Use at least 8 characters' },
            { pattern: /[A-Za-z]/, message: 'Include a letter' },
            { pattern: /\d/, message: 'Include a number' },
          ]}
        >
          <Input.Password autoComplete="new-password" placeholder="8+ characters, a letter and a number" size="large" onChange={(event) => setPassword(event.target.value)} />
        </Form.Item>
        <div className="ls-strength" aria-hidden="true">
          {[1, 2, 3, 4].map((bar) => <span key={bar} className={password && score >= bar ? `on-${score}` : ''} />)}
        </div>
        <div className="ls-strength-label">{password ? PASSWORD_LABELS[score] : 'Use a letter and a number'}</div>
        <Form.Item
          label="Confirm password"
          name="confirm"
          dependencies={['password']}
          rules={[
            { required: true, message: 'Confirm your password' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) return Promise.resolve();
                return Promise.reject(new Error('Passwords need to match'));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" size="large" />
        </Form.Item>
        <Button type="primary" htmlType="submit" size="large" block loading={isLoading}>Create account</Button>
      </Form>
    </AuthLayout>
  );
}
