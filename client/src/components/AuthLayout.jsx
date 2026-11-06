import { Alert } from 'antd';
import Logo from './Logo';

const PREVIEW = [
  ['Swiggy', '−₹842.50', 'out'],
  ['Salary · Acme', '+₹85,000.00', 'in'],
  ['BESCOM', '−₹1,450.00', 'out'],
  ['HDFC · 4412', '₹68,495.75', ''],
];

export default function AuthLayout({ title, subtitle, error, children, footer }) {
  return (
    <div className="ls-auth">
      <section className="ls-auth-brand">
        <Logo light />
        <div className="ls-auth-kicker">Personal ledger</div>
        <h1>Every bank SMS, turned into a clear ledger.</h1>
        <p className="ls-auth-lead">
          Import an Android backup, CSV, or JSON export. LedgerSMS classifies spends, salaries, balances, and the messages that still need a human eye.
        </p>
        <ul className="ls-trust">
          <li><i />Messages stay in your MySQL database.</li>
          <li><i />Rules read the SMS first. A model is optional.</li>
          <li><i />Every figure traces back to a message.</li>
        </ul>
        <div className="ls-preview">
          <header><span>October sample</span><span>INR</span></header>
          {PREVIEW.map(([name, amount, tone]) => (
            <div className="ls-preview-row" key={name}>
              <b>{name}</b>
              <em className={tone === 'out' ? 'ls-out' : tone === 'in' ? 'ls-in' : ''}>{amount}</em>
            </div>
          ))}
        </div>
      </section>
      <section className="ls-auth-panel">
        <div className="ls-mobile-brand"><Logo /></div>
        <h2>{title}</h2>
        <p className="ls-sub">{subtitle}</p>
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16, maxWidth: 440 }} /> : null}
        {children}
        <div className="ls-switch">{footer}</div>
      </section>
    </div>
  );
}
