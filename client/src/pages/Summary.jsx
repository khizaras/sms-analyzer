import { App, Button } from 'antd';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import PageHeader from '../components/PageHeader';
import PeriodControl, { usePeriod } from '../components/PeriodControl';
import { PageEmpty, PageError, PageSkeleton } from '../components/States';
import { useGetSummaryQuery, useWriteSummaryMutation } from '../store/api';
import { CATEGORY_COLORS } from '../theme';
import { compactInr, errText, inr, when } from '../utils/format';

function changeLabel(row) {
  if (!row || row.direction === 'flat') return 'Flat versus the previous window';
  const word = row.direction === 'up' ? 'Up' : 'Down';
  return `${word} ${inr(Math.abs(row.delta))} versus the previous window`;
}

export default function Summary() {
  const { message } = App.useApp();
  const period = usePeriod('year');
  const { data, isLoading, isError, error, refetch } = useGetSummaryQuery({ from: period.from, to: period.to });
  const [writeSummary, { isLoading: writing }] = useWriteSummaryMutation();

  const refresh = async () => {
    try {
      const result = await writeSummary({ from: period.from, to: period.to }).unwrap();
      if (result.notice) message.info(result.notice);
      else message.success('Narrative updated');
    } catch (err) {
      message.error(errText(err));
    }
  };

  if (isLoading) return <PageSkeleton />;
  if (isError) return <div className="ls-page"><PageError message={errText(error)} onRetry={refetch} /></div>;

  const empty = data.kpis.debitCount === 0 && data.kpis.creditCount === 0;
  const paragraphs = String(data.narrative || '').split(/\n\n+/).filter(Boolean);

  return (
    <div className="ls-page">
      <PageHeader
        kicker="Summary"
        title="Where the money went"
        subtitle={`${period.label}. Figures are this account’s classified SMS only.`}
        extra={<PeriodControl value={period.key} onChange={period.setKey} />}
      />
      {data.notice ? <div className="ls-banner">{data.noticeTitle ? <strong>{data.noticeTitle}</strong> : null}<span>{data.notice}</span></div> : null}
      {empty ? (
        <PageEmpty title="No movements in this window" text="Import a backup or widen the range. The summary uses only your ledger." />
      ) : (
        <>
          <div className="ls-kpi">
            <article className="ls-stat tone-out"><span className="ls-stat-label">Spend</span><strong className="ls-stat-value">{inr(data.kpis.spend)}</strong><span className="ls-stat-hint">{changeLabel(data.comparison.spend)}</span></article>
            <article className="ls-stat tone-in"><span className="ls-stat-label">Income</span><strong className="ls-stat-value">{inr(data.kpis.income)}</strong><span className="ls-stat-hint">{changeLabel(data.comparison.income)}</span></article>
            <article className="ls-stat"><span className="ls-stat-label">Net</span><strong className="ls-stat-value">{inr(data.kpis.net)}</strong><span className="ls-stat-hint">{data.kpis.debitCount} debits · {data.kpis.creditCount} credits</span></article>
            <article className="ls-stat tone-gold"><span className="ls-stat-label">Savings rate</span><strong className="ls-stat-value">{data.kpis.savingsRate == null ? '—' : `${data.kpis.savingsRate}%`}</strong><span className="ls-stat-hint">Net divided by income</span></article>
            <article className="ls-stat"><span className="ls-stat-label">Average debit</span><strong className="ls-stat-value">{inr(data.kpis.averageDebit)}</strong><span className="ls-stat-hint">{data.kpis.uncategorizedCount ? `${inr(data.kpis.uncategorizedAmount)} still Other` : 'Categories are filled in'}</span></article>
          </div>

          <div className="ls-grid ls-grid-2">
            <section className="ls-panel">
              <div className="ls-panel-head"><h3>Spending</h3><span>{data.spending.topCategory ? `${data.spending.topCategory.label} leads` : 'No spend'}</span></div>
              {data.spending.topCategory ? (
                <p className="ls-lead">{data.spending.topCategory.label} took {inr(data.spending.topCategory.amount)}, {data.spending.topCategory.share}% of classified outflow.{data.spending.topMerchant ? ` ${data.spending.topMerchant.name} is the top merchant at ${inr(data.spending.topMerchant.amount)} (${data.spending.topMerchant.share}%).` : ''}{data.spending.topBank ? ` ${data.spending.topBank.name} moved the most, ${inr(data.spending.topBank.amount)}.` : ''}</p>
              ) : null}
              <div className="ls-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.spending.categories} dataKey="amount" nameKey="label" innerRadius={62} outerRadius={90} paddingAngle={2} stroke="transparent">
                      {data.spending.categories.map((item) => <Cell key={item.slug} fill={CATEGORY_COLORS[item.slug] || '#98A2B3'} />)}
                    </Pie>
                    <Tooltip formatter={(value) => inr(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {data.spending.categories.slice(0, 5).map((item) => (
                <div className="ls-merchant" key={item.slug}>
                  <div className="ls-merchant-top"><span>{item.label}</span><span>{inr(item.amount)} · {item.share}%</span></div>
                  <div className="ls-track"><i style={{ width: `${Math.max(item.share, 2)}%` }} /></div>
                </div>
              ))}
            </section>
            <section className="ls-panel">
              <div className="ls-panel-head"><h3>Income</h3><span>{data.income.topSource ? data.income.topSource.name : 'No credits'}</span></div>
              <p className="ls-lead">Salary {inr(data.income.salary)} · other credits {inr(data.income.other)}.{data.income.largest ? ` Largest single credit ${inr(data.income.largest.amount)} from ${data.income.largest.merchant || data.income.largest.category} on ${when(data.income.largest.at)}.` : ''}</p>
              <div className="ls-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[{ name: 'Income', value: data.kpis.income }, { name: 'Spend', value: data.kpis.spend }]}>
                    <CartesianGrid stroke="rgba(20,32,51,0.06)" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={compactInr} width={64} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value) => inr(value)} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                      <Cell fill="#0f6e56" />
                      <Cell fill="#8f3d3d" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {data.income.sources.map((item) => (
                <div className="ls-merchant" key={item.name}>
                  <div className="ls-merchant-top"><span>{item.name}</span><span>{inr(item.amount)}</span></div>
                  <div className="ls-track"><i style={{ width: `${Math.max(item.share, 2)}%` }} /></div>
                </div>
              ))}
            </section>
          </div>

          <section className="ls-panel" style={{ marginTop: 14 }}>
            <div className="ls-panel-head"><h3>Repeated charges</h3><span>Same merchant, similar amount, two or more times</span></div>
            {data.repeated.length === 0 ? <p className="ls-quiet">Nothing repeats in this window.</p> : (
              <div className="ls-table">
                <table className="ls-plain">
                  <thead><tr><th>Merchant</th><th>Count</th><th>Typical</th><th>Total</th><th>Cadence</th><th>Last</th></tr></thead>
                  <tbody>
                    {data.repeated.map((item) => (
                      <tr key={`${item.merchant}-${item.typicalAmount}`}>
                        <td>{item.merchant}{item.subscription ? <em className="ls-pill">Recurring</em> : null}</td>
                        <td>{item.count}</td>
                        <td>{inr(item.typicalAmount)}</td>
                        <td>{inr(item.total)}</td>
                        <td>{item.cadence}</td>
                        <td>{when(item.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="ls-panel ls-narrative-wrap" style={{ marginTop: 14 }}>
            <div className="ls-panel-head">
              <h3>Consolidated narrative</h3>
              <Button type="primary" loading={writing} onClick={refresh}>{data.llmConfigured ? 'Write with model' : 'Refresh local reading'}</Button>
            </div>
            <div className="ls-narrative">
              {paragraphs.map((paragraph) => <p key={paragraph.slice(0, 24)}>{paragraph}</p>)}
            </div>
            <p className="ls-quiet">{data.narrativeSource === 'llm' ? `Written by ${data.narrativeModel || 'the model'} from totals, not from every SMS.` : 'Local reading of the same totals.'}</p>
          </section>
        </>
      )}
    </div>
  );
}
