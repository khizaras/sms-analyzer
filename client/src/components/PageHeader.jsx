export default function PageHeader({ kicker, title, subtitle, extra }) {
  return (
    <header className="ls-page-head">
      <div>
        <div className="ls-kicker">{kicker}</div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {extra ? <div>{extra}</div> : null}
    </header>
  );
}
