import { useSelector } from 'react-redux';
import { Table, Tag } from 'antd';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import PageHeader from '../components/PageHeader';
import PeriodControl, { usePeriod } from '../components/PeriodControl';
import { PageEmpty, PageError, PageSkeleton } from '../components/States';
import { useGetOverviewQuery } from '../store/api';
import { CATEGORY_COLORS, bankColor } from '../theme';
import { ago, compactInr, errText, inr, monthLabel, signedInr, when } from '../utils/format';

function greeting(name) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${(name || 'there').split(' ')[0]}`;
}

export default function Overview() {
  const user = useSelector((state) => state.auth.user);
  const period = usePeriod('month');
  const { data, isLoading, isError, error, refetch } = useGetOverviewQuery({ from: period.from, to: period.to });

  if (isLoading) return <PageSkeleton />;
  if (isError) return <div className="ls-page"><PageError message={errText(error)} onRetry={refetch} /></div>;

  const empty = data.kpis.transactions === 0 && data.kpis.unparsed === 0 && data.accounts.length === 0;
  const maxMerchant = Math.max(...data.merchants.map((item) => item.amount), 1);

  return (
    <div className="ls-page">
      <PageHeader
        kicker="Overview"
        title={greeting(user?.name)}
        subtitle={`${period.label} · ${data.kpis.transactions} classified movements · balances are the latest figures printed in SMS.`}
        extra={<PeriodControl value={period.key} onChange={period.setKey} />}
      />
      {empty ? (
        <PageEmpty
          title="Your ledger is ready"
          text="Import the sample file or your own SMS backup. Parsing runs on the server with bank rules, then this overview fills in."
        />
      ) : (
        <>
          <section className="ls-kpi">
            <article className="ls-stat tone-out"><span className="ls-stat-label">Spend</span><strong className="ls-stat-value">{inr(data.kpis.spend)}</strong><span className="ls-stat-hint">{data.kpis.debits} debits</span></article>
            <article className="ls-stat tone-in"><span className="ls-stat-label">Inflow</span><strong className="ls-stat-value">{inr(data.kpis.inflow)}</strong><span className="ls-stat-hint">{data.kpis.credits} credits</span></article>
            <article className={`ls-stat ${data.kpis.net >= 0 ? 'tone-in' : 'tone-out'}`}><span className="ls-stat-label">Net</span><strong className="ls-stat-value">{inr(data.kpis.net)}</strong><span className="ls-stat-hint">Inflow minus classified spend</span></article>
            <article className="ls-stat"><span className="ls-stat-label">Balances</span><strong className="ls-stat-value">{inr(data.kpis.balance)}</strong><span className="ls-stat-hint">{data.accounts.length} accounts</span></article>
            <article className="ls-stat tone-gold"><span className="ls-stat-label">Needs review</span><strong className="ls-stat-value">{data.kpis.unparsed}</strong><span className="ls-stat-hint"><Link to="/review">Open the queue</Link></span></article>
          </section>
          <section className="ls-grid ls-grid-2">
            <div className="ls-panel">
              <div className="ls-panel-head"><h3>Cashflow</h3><span>Spend and inflow</span></div>
              <div className="ls-chart">
                {data.trend.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.trend.map((row) => ({ ...row, label: monthLabel(row.month) }))}>
                      <defs>
                        <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#8f3d3d" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#8f3d3d" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="inFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0f6e56" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#0f6e56" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(20,32,51,0.06)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: '#5c6b82', fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={compactInr} width={72} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(value) => inr(value)} />
                      <Area type="monotone" name="Spend" dataKey="spend" stroke="#8f3d3d" fill="url(#spendFill)" strokeWidth={2.2} />
                      <Area type="monotone" name="Inflow" dataKey="inflow" stroke="#0f6e56" fill="url(#inFill)" strokeWidth={2.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <div className="ls-empty"><h3>Quiet window</h3><p>No classified movement in {period.label}.</p></div>}
              </div>
            </div>
            <div className="ls-panel">
              <div className="ls-panel-head"><h3>Categories</h3><span>Classified spend</span></div>
              <div className="ls-donut-wrap">
                {data.categories.length ? (
                  <>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={data.categories} dataKey="amount" nameKey="label" innerRadius={72} outerRadius={102} paddingAngle={2} stroke="transparent">
                          {data.categories.map((entry) => <Cell key={entry.slug} fill={CATEGORY_COLORS[entry.slug] || '#98A2B3'} />)}
                        </Pie>
                        <Tooltip formatter={(value) => inr(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="ls-donut-center"><span>Spend</span><strong>{compactInr(data.kpis.spend)}</strong></div>
                  </>
                ) : <div className="ls-empty"><h3>No spend mix</h3><p>Debits in this period will gather here.</p></div>}
              </div>
            </div>
          </section>
          <section className="ls-grid ls-grid-wide">
            <div className="ls-panel">
              <div className="ls-panel-head"><h3>Merchants</h3><span>Largest debits</span></div>
              {data.merchants.length ? data.merchants.map((item) => (
                <div className="ls-merchant" key={item.merchant}>
                  <div className="ls-merchant-top"><span>{item.merchant}</span><span>{inr(item.amount)}</span></div>
                  <div className="ls-track"><i style={{ width: `${Math.max(8, (item.amount / maxMerchant) * 100)}%` }} /></div>
                </div>
              )) : <p className="ls-quiet">Merchant names appear once a debit has a counterparty.</p>}
            </div>
            <div className="ls-panel ls-table">
              <div className="ls-panel-head"><h3>Recent</h3><Link to="/transactions">Full ledger</Link></div>
              <Table
                size="middle"
                rowKey="id"
                pagination={false}
                dataSource={data.recent}
                columns={[
                  { title: 'When', dataIndex: 'txnAt', render: (value) => <div>{when(value)}<div className="ls-quiet">{ago(value)}</div></div> },
                  { title: 'Merchant', dataIndex: 'merchant', render: (value, row) => value || row.bank || '—' },
                  { title: 'Type', dataIndex: 'txnType', render: (value) => <Tag className={`ls-tag ls-tag-${value}`}>{value}</Tag> },
                  { title: 'Amount', dataIndex: 'amount', align: 'right', render: (value, row) => <span className={row.txnType === 'debit' ? 'ls-out' : 'ls-in'}>{signedInr(value, row.txnType)}</span> },
                ]}
              />
            </div>
          </section>
          <section className="ls-bank-row">
            {data.accounts.map((account) => (
              <Link key={account.id} to="/accounts" className="ls-bank" style={{ textDecoration: 'none' }}>
                <div className="ls-bank-top">
                  <span className="ls-mono" style={{ background: bankColor(account.bank) }}>{account.bank.slice(0, 1)}</span>
                  <span className="ls-quiet">··{account.accountLast4}</span>
                </div>
                <div className="ls-quiet" style={{ marginTop: 10 }}>{account.bank}</div>
                <strong>{account.latestBalance == null ? '—' : inr(account.latestBalance)}</strong>
              </Link>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
