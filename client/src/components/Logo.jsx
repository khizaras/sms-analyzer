import { Link } from 'react-router-dom';

export default function Logo({ linked = false, light = false }) {
  const inner = (
    <>
      <span className="ls-logo-mark" aria-hidden="true">L</span>
      <span className="ls-wordmark" style={light ? { color: '#f6f1e6' } : undefined}>Ledger<span>SMS</span></span>
    </>
  );
  if (!linked) return <span className="ls-brand-lock">{inner}</span>;
  return <Link to="/overview" className="ls-side-brand">{inner}</Link>;
}
