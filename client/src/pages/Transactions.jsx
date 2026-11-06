import { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Drawer, Input, Select, Table, Tag, App } from 'antd';
import dayjs from 'dayjs';
import PageHeader from '../components/PageHeader';
import { PageEmpty, PageError } from '../components/States';
import {
  useAnalyzeFilteredMutation,
  useAnalyzeTransactionMutation,
  useAnalyzeTransactionsMutation,
  useGetMetaQuery,
  useGetTransactionsQuery,
  useUpdateCategoryMutation,
} from '../store/api';
import { useSelector } from 'react-redux';
import { ago, errText, signedInr, when } from '../utils/format';

export default function Transactions() {
  const { message } = App.useApp();
  const token = useSelector((state) => state.auth.token);
  const meta = useGetMetaQuery();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [bank, setBank] = useState();
  const [category, setCategory] = useState();
  const [type, setType] = useState();
  const [range, setRange] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState('date');
  const [order, setOrder] = useState('desc');
  const [open, setOpen] = useState(null);
  const [selected, setSelected] = useState([]);
  const [batch, setBatch] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [saveCategory, { isLoading: saving }] = useUpdateCategoryMutation();
  const [analyzeOne, { isLoading: analyzingOne }] = useAnalyzeTransactionMutation();
  const [analyzeMany, { isLoading: analyzingMany }] = useAnalyzeTransactionsMutation();
  const [analyzeFiltered, { isLoading: analyzingFiltered }] = useAnalyzeFilteredMutation();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = useMemo(() => ({
    page, pageSize, sort, order,
    search: debounced || undefined,
    bank, category, type,
    from: range?.[0]?.startOf('day').toISOString(),
    to: range?.[1]?.endOf('day').toISOString(),
  }), [page, pageSize, sort, order, debounced, bank, category, type, range]);

  const { data, isLoading, isError, error, refetch } = useGetTransactionsQuery(params);
  const categories = meta.data?.categories || [];

  const exportCsv = async () => {
    setExporting(true);
    try {
      const query = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value != null && key !== 'page' && key !== 'pageSize') query.set(key, value);
      });
      const response = await fetch(`/api/transactions/export?${query.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ledgersms-transactions.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      message.error(errText(err));
    } finally {
      setExporting(false);
    }
  };

  const filterBody = {
    search: debounced || undefined,
    bank, category, type,
    from: range?.[0]?.startOf('day').toISOString(),
    to: range?.[1]?.endOf('day').toISOString(),
  };

  const runOne = async () => {
    try {
      const updated = await analyzeOne(open.id).unwrap();
      setOpen(updated);
      if (updated.notice) message.info(updated.notice);
      else message.success('Analysis saved on this transaction');
    } catch (err) {
      message.error(errText(err));
    }
  };

  const runSelected = async () => {
    const ids = selected.slice(0, 25);
    if (selected.length > 25) message.info('Analyzing the first 25 selected rows');
    try {
      const result = await analyzeMany(ids).unwrap();
      setBatch(result);
      if (result.notice) message.info(result.notice);
    } catch (err) {
      message.error(errText(err));
    }
  };

  const runFiltered = async () => {
    try {
      const result = await analyzeFiltered(filterBody).unwrap();
      setBatch(result);
      if (result.matched > result.analyzed) {
        message.info(`This filter has ${result.matched} movements. The latest ${result.analyzed} were analyzed.`);
      } else if (result.notice) message.info(result.notice);
    } catch (err) {
      message.error(errText(err));
    }
  };

  const reclassify = async (next) => {
    try {
      const updated = await saveCategory({ id: open.id, category: next }).unwrap();
      setOpen(updated);
      message.success('Category updated');
    } catch (err) {
      message.error(errText(err));
    }
  };

  return (
    <div className="ls-page">
      <PageHeader
        kicker="Transactions"
        title="The full ledger"
        subtitle="Filter by bank, category, direction, or the words inside the original SMS."
        extra={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button disabled={!selected.length} loading={analyzingMany} onClick={runSelected}>Analyze selected</Button>
            <Button disabled={!data?.total} loading={analyzingFiltered} onClick={runFiltered}>Analyze filtered</Button>
            <Button type="primary" loading={exporting} onClick={exportCsv}>Export CSV</Button>
          </div>
        )}
      />
      <div className="ls-filters">
        <Input.Search allowClear placeholder="Search merchant, bank, SMS" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} style={{ width: 260 }} />
        <DatePicker.RangePicker value={range} onChange={(value) => { setRange(value); setPage(1); }} />
        <Select allowClear placeholder="Bank" value={bank} onChange={(value) => { setBank(value); setPage(1); }} options={(meta.data?.banks || []).map((item) => ({ value: item, label: item }))} style={{ width: 160 }} />
        <Select allowClear placeholder="Category" value={category} onChange={(value) => { setCategory(value); setPage(1); }} options={categories.map((item) => ({ value: item.slug, label: item.label }))} style={{ width: 160 }} />
        <Select allowClear placeholder="Type" value={type} onChange={(value) => { setType(value); setPage(1); }} options={['debit', 'credit', 'info'].map((item) => ({ value: item, label: item }))} style={{ width: 130 }} />
      </div>
      {isError ? <PageError message={errText(error)} onRetry={refetch} /> : (
        <div className="ls-panel ls-table">
          <Table
            rowKey="id"
            loading={isLoading}
            dataSource={data?.items || []}
            rowSelection={{ selectedRowKeys: selected, onChange: setSelected, preserveSelectedRowKeys: true }}
            locale={{ emptyText: <PageEmpty title="Nothing in this filter" text="Widen the dates or import a backup that contains bank SMS." action={<span />} /> }}
            onRow={(record) => ({ onClick: () => setOpen(record), style: { cursor: 'pointer' } })}
            onChange={(pagination, _filters, sorter) => {
              setPage(pagination.current);
              setPageSize(pagination.pageSize);
              if (!Array.isArray(sorter) && sorter.order) {
                setSort(sorter.columnKey);
                setOrder(sorter.order === 'ascend' ? 'asc' : 'desc');
              }
            }}
            pagination={{ current: page, pageSize, total: data?.total || 0, showSizeChanger: true }}
            columns={[
              { title: 'When', key: 'date', sorter: true, render: (_, row) => <div>{when(row.txnAt)}<div className="ls-quiet">{ago(row.txnAt)}</div></div> },
              { title: 'Merchant', key: 'merchant', sorter: true, dataIndex: 'merchant', render: (value) => value || '—' },
              { title: 'Category', key: 'category', sorter: true, dataIndex: 'categoryLabel' },
              { title: 'Bank', key: 'bank', sorter: true, render: (_, row) => row.bank ? `${row.bank}${row.accountLast4 ? ` · ${row.accountLast4}` : ''}` : '—' },
              { title: 'Type', dataIndex: 'txnType', render: (value) => <Tag className={`ls-tag ls-tag-${value}`}>{value}</Tag> },
              { title: 'Amount', key: 'amount', sorter: true, align: 'right', render: (_, row) => signedInr(row.amount, row.txnType) },
            ]}
          />
        </div>
      )}
      <Drawer title="Transaction" width={480} open={Boolean(open)} onClose={() => setOpen(null)}>
        {open ? (
          <>
            <div className="ls-stat" style={{ marginBottom: 16 }}>
              <span className="ls-stat-label">{open.categoryLabel}</span>
              <strong className="ls-stat-value">{signedInr(open.amount, open.txnType)}</strong>
              <span className="ls-stat-hint">{when(open.txnAt)} · {ago(open.txnAt)}</span>
            </div>
            <dl className="ls-dl">
              <dt>Merchant</dt><dd>{open.merchant || '—'}</dd>
              <dt>Bank</dt><dd>{open.bank || '—'}{open.accountLast4 ? ` · ${open.accountLast4}` : ''}</dd>
              <dt>Balance in SMS</dt><dd>{open.balance == null ? '—' : signedInr(open.balance)}</dd>
              <dt>Sender</dt><dd>{open.sender || '—'}</dd>
              <dt>File</dt><dd>{open.filename || '—'}</dd>
            </dl>
            {open.notice ? <div className="ls-banner">{open.noticeTitle ? <strong>{open.noticeTitle}</strong> : null}<span>{open.notice}</span></div> : null}
            {open.review ? <ReviewCard review={open.review} /> : null}
            <Button block style={{ marginBottom: 16 }} loading={analyzingOne} onClick={runOne}>Analyze with LLM</Button>
            <div className="ls-quiet" style={{ marginBottom: 6 }}>Reclassify</div>
            <Select
              style={{ width: '100%', marginBottom: 16 }}
              value={open.category}
              loading={saving}
              options={categories.map((item) => ({ value: item.slug, label: item.label }))}
              onChange={reclassify}
            />
            <div className="ls-quiet" style={{ marginBottom: 6 }}>Original SMS</div>
            <pre className="ls-sms">{open.body}</pre>
          </>
        ) : null}
      </Drawer>
      <Drawer title="Analysis" width={520} open={Boolean(batch)} onClose={() => setBatch(null)}>
        {batch ? (
          <>
            <p className="ls-quiet">{batch.analyzed} saved · cap {batch.cap}{batch.matched != null ? ` · ${batch.matched} matched the filter` : ''}{batch.skipped ? ` · ${batch.skipped} skipped` : ''}</p>
            {batch.notice ? <div className="ls-banner">{batch.noticeTitle ? <strong>{batch.noticeTitle}</strong> : null}<span>{batch.notice}</span></div> : null}
            <div className="ls-review">
              {(batch.items || []).map((item) => (
                <article key={item.transactionId} className="ls-panel" style={{ padding: 14 }}>
                  <div className="ls-quiet">Transaction {item.transactionId}</div>
                  <ReviewCard review={item.review} />
                </article>
              ))}
            </div>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

function ReviewCard({ review }) {
  if (!review) return null;
  return (
    <div className="ls-analysis">
      <div className="ls-analysis-top">
        <strong>{review.summary}</strong>
        <span>{review.confidence == null ? '—' : `${Math.round(review.confidence * 100)}%`}</span>
      </div>
      <dl className="ls-dl">
        <dt>Suggested category</dt><dd>{review.category || '—'}</dd>
        <dt>Merchant</dt><dd>{review.merchant || '—'}</dd>
        <dt>Repeating</dt><dd>{review.recurring ? 'Looks recurring' : 'No repeat signal'}</dd>
        <dt>Notes</dt><dd>{review.notes || '—'}</dd>
      </dl>
    </div>
  );
}
