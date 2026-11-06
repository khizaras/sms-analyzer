import { useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import PageHeader from '../components/PageHeader';
import { PageEmpty, PageError, PageSkeleton } from '../components/States';
import { useGetAccountsQuery } from '../store/api';
import { bankColor } from '../theme';
import { ago, compactInr, errText, inr, when } from '../utils/format';

export default function Accounts() {
  const { data, isLoading, isError, error, refetch } = useGetAccountsQuery();
  const [selected, setSelected] = useState(null);
  if (isLoading) return <PageSkeleton />;
  if (isError) return <div className="ls-page"><PageError message={errText(error)} onRetry={refetch} /></div>;
  const accounts = data.accounts || [];
  const current = accounts.find((item) => item.id === selected) || accounts[0];
  if (!accounts.length) {
    return (
      <div className="ls-page">
        <PageHeader kicker="Accounts" title="Banks on the ledger" subtitle="Accounts appear when an SMS names a bank and a masked number." />
        <PageEmpty title="No accounts yet" text="Import a bank SMS that includes an account or card ending. Balances update from the newest message that prints one." />
      </div>
    );
  }
  return (
    <div className="ls-page">
      <PageHeader
        kicker="Accounts"
        title="Banks and balances"
        subtitle={`${accounts.length} accounts · ${inr(data.totalBalance)} across the latest SMS balances.`}
      />
      <div className="ls-bank-row">
        {accounts.map((account) => (
          <button key={account.id} type="button" className={`ls-bank${current?.id === account.id ? ' is-on' : ''}`} onClick={() => setSelected(account.id)}>
            <div className="ls-bank-top">
              <span className="ls-mono" style={{ background: bankColor(account.bank) }}>{account.bank.slice(0, 1)}</span>
              <span className="ls-quiet">{account.txnCount} txns</span>
            </div>
            <div style={{ marginTop: 12 }}>{account.bank}</div>
            <div className="ls-quiet">Ending {account.accountLast4}</div>
            <strong>{account.latestBalance == null ? 'No balance in SMS' : inr(account.latestBalance)}</strong>
            <div className="ls-quiet">{account.balanceAt ? ago(account.balanceAt) : 'Waiting for a balance SMS'}</div>
          </button>
        ))}
      </div>
      <div className="ls-panel" style={{ marginTop: 14 }}>
        <div className="ls-panel-head">
          <h3>{current.bank} · {current.accountLast4}</h3>
          <span>{current.points.length ? `Since ${when(current.points[0].capturedAt)}` : 'No balance timeline yet'}</span>
        </div>
        <div className="ls-chart">
          {current.points.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={current.points.map((point) => ({ ...point, label: when(point.capturedAt) }))}>
                <defs>
                  <linearGradient id="balFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1d4e89" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#1d4e89" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: '#5c6b82', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={compactInr} width={72} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => inr(value)} />
                <Area type="monotone" name="Balance" dataKey="balance" stroke="#1d4e89" fill="url(#balFill)" strokeWidth={2.4} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="ls-empty"><h3>Balance still hidden</h3><p>This account is known from the card or account ending, and a later SMS can print the balance.</p></div>}
        </div>
      </div>
    </div>
  );
}
