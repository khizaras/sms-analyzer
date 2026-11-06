import { App, Button, Form, Input } from 'antd';
import { useDispatch } from 'react-redux';
import PageHeader from '../components/PageHeader';
import { PageError, PageSkeleton } from '../components/States';
import { useChangePasswordMutation, useGetMeQuery, useUpdateProfileMutation } from '../store/api';
import { setCredentials } from '../store/authSlice';
import { errText, when } from '../utils/format';

export default function Settings() {
  const { message } = App.useApp();
  const dispatch = useDispatch();
  const me = useGetMeQuery();
  const [updateProfile, { isLoading }] = useUpdateProfileMutation();
  const [changePassword, { isLoading: savingPassword }] = useChangePasswordMutation();

  if (me.isLoading) return <PageSkeleton />;
  if (me.isError) return <div className="ls-page"><PageError message={errText(me.error)} onRetry={me.refetch} /></div>;
  const { user, llm } = me.data;

  const saveProfile = async (values) => {
    try {
      const result = await updateProfile(values).unwrap();
      dispatch(setCredentials(result));
      message.success('Profile saved');
    } catch (err) {
      message.error(errText(err));
    }
  };

  const savePassword = async (values) => {
    try {
      await changePassword(values).unwrap();
      message.success('Password updated');
    } catch (err) {
      message.error(errText(err));
    }
  };

  return (
    <div className="ls-page">
      <PageHeader kicker="Settings" title="Your account" subtitle={`Member since ${when(user.createdAt)}. The API key never leaves the server and is never shown here.`} />
      <div className="ls-settings">
        <section className="ls-panel">
          <h3>Profile</h3>
          <Form layout="vertical" requiredMark={false} initialValues={{ name: user.name, email: user.email }} onFinish={saveProfile}>
            <Form.Item label="Name" name="name" rules={[{ required: true, min: 2 }]}><Input size="large" /></Form.Item>
            <Form.Item label="Email" name="email" rules={[{ required: true, type: 'email' }]}><Input size="large" /></Form.Item>
            <Button type="primary" htmlType="submit" loading={isLoading}>Save profile</Button>
          </Form>
          <h3 style={{ marginTop: 28 }}>Password</h3>
          <Form layout="vertical" requiredMark={false} onFinish={savePassword}>
            <Form.Item label="Current password" name="currentPassword" rules={[{ required: true }]}><Input.Password size="large" /></Form.Item>
            <Form.Item label="New password" name="newPassword" rules={[{ required: true, min: 8 }, { pattern: /[A-Za-z]/, message: 'Include a letter' }, { pattern: /\d/, message: 'Include a number' }]}>
              <Input.Password size="large" />
            </Form.Item>
            <Button htmlType="submit" loading={savingPassword}>Update password</Button>
          </Form>
        </section>
        <section className="ls-panel">
          <h3>Model connection</h3>
          <div className={`ls-status-pill${llm?.configured ? ' on' : ''}`}>{llm?.configured ? 'Key present' : 'LLM not configured'}</div>
          <dl className="ls-dl" style={{ marginTop: 18 }}>
            <dt>Model</dt><dd>{llm?.model || '—'}</dd>
            <dt>Host</dt><dd>{llm?.host || '—'}</dd>
            <dt>API key</dt><dd>Stored only in the server environment</dd>
          </dl>
          <p className="ls-quiet">Set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL in the root .env file, then restart the API. Insights keep working from local totals when the key is empty.</p>
        </section>
      </div>
    </div>
  );
}
