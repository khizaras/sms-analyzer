import { Button } from 'antd';
import { Link } from 'react-router-dom';
import Logo from './Logo';

export function Splash({ label = 'Opening your ledger…' }) {
  return (
    <div className="ls-splash">
      <div className="ls-splash-card">
        <Logo light />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function FullScreenError({ title, text, onRetry }) {
  return (
    <div className="ls-splash" style={{ background: 'var(--paper)', color: 'inherit' }}>
      <div className="ls-error">
        <div className="ls-mark-ring">!</div>
        <h3>{title}</h3>
        <p>{text}</p>
        {onRetry ? <Button type="primary" onClick={onRetry}>Try again</Button> : null}
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="ls-page" aria-busy="true">
      <div className="ls-kpi">
        {Array.from({ length: 5 }).map((_, index) => <div key={index} className="ls-stat" style={{ height: 108, background: '#f6f1e6' }} />)}
      </div>
      <div className="ls-grid ls-grid-2">
        <div className="ls-panel" style={{ height: 320 }} />
        <div className="ls-panel" style={{ height: 320 }} />
      </div>
    </div>
  );
}

export function PageError({ message, onRetry }) {
  return (
    <div className="ls-panel ls-error">
      <div className="ls-mark-ring">!</div>
      <h3>This view did not load</h3>
      <p>{message}</p>
      {onRetry ? <Button type="primary" onClick={onRetry}>Retry</Button> : null}
    </div>
  );
}

export function PageEmpty({ title, text, action }) {
  return (
    <div className="ls-panel ls-empty">
      <div className="ls-mark-ring">₹</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action || <Link to="/imports"><Button type="primary">Import SMS</Button></Link>}
    </div>
  );
}
