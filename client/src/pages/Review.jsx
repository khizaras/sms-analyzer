import { useEffect, useState } from 'react';
import { App, Button, Input, Pagination, Select } from 'antd';
import PageHeader from '../components/PageHeader';
import { PageEmpty, PageError, PageSkeleton } from '../components/States';
import {
  useAcceptSuggestionMutation,
  useClassifyMessageMutation,
  useGetMetaQuery,
  useGetReviewQuery,
  useSuggestMessageMutation,
  useSuggestMessagesMutation,
} from '../store/api';
import { ago, errText, when } from '../utils/format';

const BANKS = ['HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak', 'Yes Bank', 'PNB', 'IndusInd Bank', 'IDFC FIRST', 'Bank of Baroda'];

function ReviewCard({ item, categories }) {
  const { message } = App.useApp();
  const [form, setForm] = useState({
    txnType: 'debit',
    category: 'other',
    amount: '',
    merchant: '',
    bank: undefined,
    accountLast4: '',
  });
  const [classify, { isLoading }] = useClassifyMessageMutation();
  const [suggest, { isLoading: suggesting }] = useSuggestMessageMutation();
  const [accept, { isLoading: accepting }] = useAcceptSuggestionMutation();
  const [idea, setIdea] = useState(item.suggestion || null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (item.suggestion) setIdea(item.suggestion);
  }, [item.suggestion]);
  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value?.target ? value.target.value : value }));

  const ask = async () => {
    try {
      const result = await suggest(item.id).unwrap();
      setIdea(result.suggestion);
      setNote(result.locked ? 'A saved classification is already on this message. Accept will leave it in place.' : '');
    } catch (err) {
      message.error(errText(err));
    }
  };

  const take = async () => {
    try {
      await accept(item.id).unwrap();
      message.success('Suggestion filed into your ledger');
    } catch (err) {
      message.error(errText(err));
    }
  };

  const save = async () => {
    try {
      await classify({ id: item.id, ...form, amount: form.amount === '' ? null : Number(form.amount) }).unwrap();
      message.success('Filed into the ledger');
    } catch (err) {
      message.error(errText(err));
    }
  };

  return (
    <article className="ls-panel ls-review-card">
      <div className="ls-review-meta"><span>{item.sender}</span><span>{when(item.receivedAt)} · {ago(item.receivedAt)}</span></div>
      <pre className="ls-sms">{item.body}</pre>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Button loading={suggesting} onClick={ask}>Suggest category with LLM</Button>
      </div>
      {note ? <div className="ls-banner" style={{ marginTop: 12 }}>{note}</div> : null}
      {idea ? (
        <div className="ls-analysis" style={{ marginTop: 12 }}>
          <div className="ls-analysis-top">
            <strong>{idea.reason}</strong>
            <span>{idea.confidence == null ? '—' : `${Math.round(idea.confidence * 100)}%`}</span>
          </div>
          <dl className="ls-dl">
            <dt>Type</dt><dd>{idea.txnType}</dd>
            <dt>Category</dt><dd>{idea.category}</dd>
            <dt>Merchant</dt><dd>{idea.merchant || '—'}</dd>
            <dt>Amount</dt><dd>{idea.amount == null ? '—' : idea.amount}</dd>
          </dl>
          <Button type="primary" loading={accepting} onClick={take} disabled={item.manual}>Accept suggestion</Button>
        </div>
      ) : null}
      <div className="ls-inline">
        <Select value={form.txnType} onChange={set('txnType')} options={['debit', 'credit', 'info'].map((value) => ({ value, label: value }))} />
        <Select value={form.category} onChange={set('category')} options={(categories || []).map((item) => ({ value: item.slug, label: item.label }))} />
        <Input placeholder="Amount" value={form.amount} onChange={set('amount')} inputMode="decimal" />
        <Input placeholder="Merchant" value={form.merchant} onChange={set('merchant')} />
        <Select showSearch allowClear placeholder="Bank" value={form.bank} onChange={set('bank')} options={BANKS.map((value) => ({ value, label: value }))} />
        <Input placeholder="Last 4" value={form.accountLast4} onChange={set('accountLast4')} maxLength={6} />
        <Button type="primary" loading={isLoading} onClick={save}>Save classification</Button>
      </div>
    </article>
  );
}

export default function Review() {
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const meta = useGetMetaQuery();
  const { data, isLoading, isError, error, refetch } = useGetReviewQuery({ page, pageSize });
  const [suggestMany, { isLoading: suggesting }] = useSuggestMessagesMutation();
  const categorizePage = async () => {
    try {
      const result = await suggestMany((data?.items || []).map((item) => item.id)).unwrap();
      if (result.notice) message.info(result.notice);
      else message.success(`Suggestions ready for ${result.analyzed} messages`);
    } catch (err) {
      message.error(errText(err));
    }
  };
  if (isLoading) return <PageSkeleton />;
  if (isError) return <div className="ls-page"><PageError message={errText(error)} onRetry={refetch} /></div>;
  return (
    <div className="ls-page">
      <PageHeader
        kicker="Review"
        title="Messages the rules left open"
        subtitle={data.total ? `${data.total} waiting for a category, amount, and direction. Suggestions stay visible until you accept them.` : 'The parser has a place for every message it could read.'}
        extra={<Button disabled={!data.total} loading={suggesting} onClick={categorizePage}>Categorize page with LLM</Button>}
      />
      {data.total === 0 ? (
        <PageEmpty title="Inbox clear" text="Unclassified SMS will land here. You can assign a type, category, amount, and account without leaving the page." action={<span />} />
      ) : (
        <div className="ls-review">
          {data.items.map((item) => <ReviewCard key={item.id} item={item} categories={meta.data?.categories} />)}
          <Pagination
            current={page}
            pageSize={pageSize}
            total={data.total}
            showSizeChanger
            pageSizeOptions={[10, 20, 50, 100]}
            onChange={(nextPage, nextSize) => {
              if (nextSize !== pageSize) {
                setPageSize(nextSize);
                setPage(1);
                return;
              }
              setPage(nextPage);
            }}
          />
        </div>
      )}
    </div>
  );
}
