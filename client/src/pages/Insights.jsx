import { useState } from 'react';
import { Button, Select, App } from 'antd';
import PageHeader from '../components/PageHeader';
import PeriodControl, { usePeriod } from '../components/PeriodControl';
import { PageError, PageSkeleton } from '../components/States';
import { useCreateSummaryMutation, useExplainTransactionMutation, useGetInsightsQuery, useGetTransactionsQuery } from '../store/api';
import { errText, signedInr, when } from '../utils/format';

export default function Insights() {
  const { message } = App.useApp();
  const period = usePeriod('month');
  const insights = useGetInsightsQuery({ from: period.from, to: period.to });
  const txns = useGetTransactionsQuery({ page: 1, pageSize: 20, sort: 'date', order: 'desc', from: period.from, to: period.to });
  const [createSummary, { isLoading }] = useCreateSummaryMutation();
  const [explain, { isLoading: explaining }] = useExplainTransactionMutation();
  const [narrative, setNarrative] = useState(null);
  const [txnId, setTxnId] = useState();
  const [explained, setExplained] = useState(null);

  if (insights.isLoading) return <PageSkeleton />;
  if (insights.isError) return <div className="ls-page"><PageError message={errText(insights.error)} onRetry={insights.refetch} /></div>;

  const current = narrative || insights.data.latest;
  const configured = insights.data.status?.configured;

  const write = async () => {
    try {
      const result = await createSummary({ from: period.from, to: period.to }).unwrap();
      setNarrative(result);
    } catch (err) {
      message.error(errText(err));
    }
  };

  const explainOne = async () => {
    try {
      const result = await explain({ transactionId: txnId }).unwrap();
      setExplained(result);
    } catch (err) {
      message.error(errText(err));
    }
  };

  return (
    <div className="ls-page">
      <PageHeader
        kicker="Insights"
        title="A reading of the period"
        subtitle="Totals, categories, and merchants are sent to the model when a key is configured. Otherwise the ledger writes the summary itself."
        extra={<PeriodControl value={period.key} onChange={(key) => { period.setKey(key); setNarrative(null); }} />}
      />
      <div className="ls-grid ls-grid-wide">
        <section className="ls-panel">
          {current?.notice ? (
            <div className={`ls-banner${current.source === 'llm' ? ' ok' : ''}`}>
              <strong>{current.noticeTitle || (current.notice === 'LLM not configured' ? 'LLM not configured' : 'Local summary')}</strong>
              <span>{current.notice === 'LLM not configured' ? 'Add LLM_API_KEY on the server to request a model narrative. This reading uses your totals only.' : current.notice}</span>
            </div>
          ) : current?.source === 'llm' ? (
            <div className="ls-banner ok"><strong>{current.model || 'Model'}</strong><span>Narrative from the configured endpoint.</span></div>
          ) : (
            <div className="ls-banner"><strong>{configured ? 'Ready' : 'LLM not configured'}</strong><span>{configured ? `Connected host ${insights.data.status.host || ''}. Write a narrative when you want one.` : 'The button still produces a local reading of this period.'}</span></div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{period.label}</h3>
            <Button type="primary" loading={isLoading} onClick={write}>Write narrative</Button>
          </div>
          {current ? (
            <div className="ls-narrative">
              {current.summary.split(/\n+/).filter(Boolean).map((paragraph) => <p key={paragraph.slice(0, 24)}>{paragraph}</p>)}
            </div>
          ) : <p className="ls-quiet">Write a narrative for {period.label}. It is saved with the period so you can come back to it.</p>}
        </section>
        <section className="ls-panel">
          <h3>Explain one SMS</h3>
          <p className="ls-quiet">Pick a classified transaction. With a model configured, that single message is included. Otherwise you get a local explanation.</p>
          <Select
            style={{ width: '100%', margin: '8px 0 12px' }}
            placeholder="Choose a transaction"
            value={txnId}
            onChange={setTxnId}
            options={(txns.data?.items || []).map((item) => ({
              value: item.id,
              label: `${when(item.txnAt)} · ${item.merchant || item.categoryLabel} · ${signedInr(item.amount, item.txnType)}`,
            }))}
          />
          <Button disabled={!txnId} loading={explaining} onClick={explainOne}>Explain</Button>
          {explained ? (
            <div style={{ marginTop: 16 }}>
              {explained.notice ? <div className="ls-banner"><strong>{explained.noticeTitle || (explained.notice === 'LLM not configured' ? 'LLM not configured' : 'Local explanation')}</strong><span>{explained.notice === 'LLM not configured' ? 'The explanation uses the stored fields only.' : explained.notice}</span></div> : null}
              <p className="ls-narrative" style={{ fontSize: 18 }}>{explained.text}</p>
            </div>
          ) : null}
          <h3 style={{ marginTop: 28 }}>Earlier readings</h3>
          <div className="ls-history">
            {(insights.data.history || []).map((item) => (
              <button key={item.id} type="button" onClick={() => setNarrative(item)}>
                <strong>{item.periodStart} → {item.periodEnd}</strong>
                <div className="ls-quiet">{item.source === 'llm' ? item.model : 'Local reading'}</div>
              </button>
            ))}
            {!insights.data.history?.length ? <p className="ls-quiet">Saved narratives will collect here.</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
