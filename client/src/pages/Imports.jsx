import { useState } from 'react';
import { App, Table, Tag, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { PageError } from '../components/States';
import { useGetHealthQuery, useGetImportsQuery, useUploadImportMutation } from '../store/api';
import { ago, errText, whenTime } from '../utils/format';

const STATUS = { completed: 'credit', failed: 'debit', processing: 'info' };

export default function Imports() {
  const { message } = App.useApp();
  const health = useGetHealthQuery();
  const maxMb = health.data?.uploadMaxMb || 8;
  const [page, setPage] = useState(1);
  const { data, isError, error, refetch, isLoading } = useGetImportsQuery({ page, pageSize: 10 });
  const [upload, { isLoading: uploading }] = useUploadImportMutation();
  const [summary, setSummary] = useState(null);

  const beforeUpload = async (file) => {
    const okType = /\.(xml|csv|json)$/i.test(file.name);
    if (!okType) {
      message.error('Upload a .xml, .csv, or .json SMS export');
      return Upload.LIST_IGNORE;
    }
    if (file.size > maxMb * 1024 * 1024) {
      message.error(`Keep the file under ${maxMb} MB`);
      return Upload.LIST_IGNORE;
    }
    try {
      const result = await upload(file).unwrap();
      setSummary(result);
      message.success('Import finished');
    } catch (err) {
      message.error(errText(err));
    }
    return Upload.LIST_IGNORE;
  };

  return (
    <div className="ls-page">
      <PageHeader
        kicker="Imports"
        title="Bring the messages in"
        subtitle="Android SMS Backup & Restore XML, or a CSV/JSON file with sender, body, and a timestamp. Duplicates are skipped."
      />
      <Upload.Dragger className="ls-drop" multiple={false} showUploadList={false} accept=".xml,.csv,.json" beforeUpload={beforeUpload} disabled={uploading}>
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">{uploading ? 'Reading and classifying…' : 'Drop an SMS export here'}</p>
        <p className="ant-upload-hint">XML, CSV, or JSON · up to {maxMb} MB · 5,000 messages</p>
      </Upload.Dragger>
      <p className="ls-links">
        <a href="/api/fixtures/sample-sms.json">Sample JSON</a>
        <a href="/api/fixtures/sample-sms.csv">Sample CSV</a>
        <a href="/api/fixtures/sample-sms.xml">Sample XML</a>
      </p>
      {summary ? (
        <div className="ls-result">
          <div><span className="ls-quiet">In file</span><strong>{summary.total}</strong></div>
          <div><span className="ls-quiet">Classified</span><strong>{summary.parsed}</strong></div>
          <div><span className="ls-quiet">Needs review</span><strong>{summary.failed}</strong></div>
          <div><span className="ls-quiet">Duplicates</span><strong>{summary.duplicates}</strong></div>
        </div>
      ) : null}
      <div className="ls-panel ls-table" style={{ marginTop: 8 }}>
        <div className="ls-panel-head"><h3>History</h3><span>{data?.total || 0} imports</span></div>
        {isError ? <PageError message={errText(error)} onRetry={refetch} /> : (
          <Table
            rowKey="id"
            loading={isLoading}
            dataSource={data?.items || []}
            pagination={{ current: page, pageSize: 10, total: data?.total || 0, onChange: setPage }}
            locale={{ emptyText: 'Imports you finish will be listed here.' }}
            columns={[
              { title: 'File', dataIndex: 'filename' },
              { title: 'Format', dataIndex: 'format', render: (value) => String(value).toUpperCase() },
              { title: 'When', dataIndex: 'createdAt', render: (value) => <div>{whenTime(value)}<div className="ls-quiet">{ago(value)}</div></div> },
              { title: 'Parsed', dataIndex: 'parsed' },
              { title: 'Review', dataIndex: 'failed' },
              { title: 'Dupes', dataIndex: 'duplicates' },
              { title: 'Status', dataIndex: 'status', render: (value) => <Tag className={`ls-tag ls-tag-${STATUS[value] || 'info'}`}>{value}</Tag> },
            ]}
          />
        )}
      </div>
    </div>
  );
}
