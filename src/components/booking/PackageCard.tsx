import { usd, type Service } from '@/lib/catalog';
import { BookLink } from './BookLink';

/** Package card from the design system. Featured cards go dark with the apex cut. */
export function PackageCard({ pkg, mode, note }: { pkg: Service; mode: 'detail' | 'member'; note?: string }) {
  const member = mode === 'member';
  return (
    <div className={'rly-pkg' + (pkg.featured ? ' rly-pkg--featured' : '')}>
      <div className="rly-pkg__head">
        <h3 className="rly-pkg__name">{pkg.name}</h3>
        {pkg.badge && <span className="rly-badge rly-badge--accent">{pkg.badge}</span>}
      </div>
      <div>
        <div className="rly-pkg__price">
          <span className="rly-pkg__amount">{usd(pkg.price)}</span>
          {member && <span className="rly-pkg__per">/mo</span>}
        </div>
        <p className="rly-pkg__note">{note ?? pkg.note}</p>
      </div>
      <ul className="rly-pkg__list rly-pkg__list--grow">
        {pkg.features.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <BookLink mode={mode} serviceId={pkg.id} className={'rly-btn rly-btn--block ' + (pkg.featured ? 'rly-btn--primary' : 'rly-btn--secondary')}>
        {member ? 'Join' : 'Book'} {pkg.name}
      </BookLink>
    </div>
  );
}
