import { Button } from 'antd';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';

export default function NotFound() {
  return (
    <div className="ls-page">
      <PageHeader kicker="404" title="That page is not on the ledger" subtitle="The link may be old. Overview is the surest way back." />
      <Link to="/overview"><Button type="primary">Back to overview</Button></Link>
    </div>
  );
}
