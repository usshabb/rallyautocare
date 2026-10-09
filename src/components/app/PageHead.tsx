export function PageHead({ index, title, children }: { index: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head__title">
        <span className="rly-index">{index}</span>
        <h1 className="h1">{title}</h1>
      </div>
      {children && <div className="wrap-row">{children}</div>}
    </div>
  );
}
