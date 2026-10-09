import type { Metadata } from 'next';
import { desc } from 'drizzle-orm';
import { setLeadStatus } from '@/app/actions/admin';
import { PageHead } from '@/components/app/PageHead';
import { ActionForm, Submit } from '@/components/ui/ActionForm';
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';
import { leads } from '@/lib/db/schema';
import { formatPhone } from '@/lib/phone';
import { fmtStamp } from '@/lib/time';

export const metadata: Metadata = { title: 'Leads' };

const TONE = { new: 'accent', contacted: 'info', closed: 'neutral' } as const;
const NEXT = { new: ['contacted', 'Mark contacted'], contacted: ['closed', 'Close'], closed: ['new', 'Reopen'] } as const;

export default async function LeadsPage() {
  await requireAdmin();
  const rows = await db.select().from(leads).orderBy(desc(leads.createdAt));

  return (
    <>
      <PageHead index="LEADS" title="Quote requests" />
      <div className="list">
        {rows.length === 0 && <p className="list__empty">No quote requests yet. They come in from the Business &amp; quotes page.</p>}
        {rows.map((l) => (
          <div key={l.id} className="list__item" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="list__main">
              <span className="list__title">
                {l.name}
                {l.business ? ` · ${l.business}` : ''}
              </span>
              <span className="small muted">
                <a href={`tel:${l.phone}`} className="link rly-data">
                  {formatPhone(l.phone)}
                </a>
                {l.email ? (
                  <>
                    {' · '}
                    <a href={`mailto:${l.email}`} className="link">
                      {l.email}
                    </a>
                  </>
                ) : null}
                {' · '}
                {l.interest} · {fmtStamp(l.createdAt)}
              </span>
              {l.message && (
                <p className="small" style={{ marginTop: 6, maxWidth: '70ch', whiteSpace: 'pre-wrap' }}>
                  {l.message}
                </p>
              )}
            </div>
            <div className="wrap-row">
              <span className={`rly-badge rly-badge--${TONE[l.status]}`}>{l.status}</span>
              <ActionForm action={setLeadStatus}>
                <input type="hidden" name="leadId" value={l.id} />
                <input type="hidden" name="status" value={NEXT[l.status][0]} />
                <Submit className="rly-btn rly-btn--secondary rly-btn--sm">{NEXT[l.status][1]}</Submit>
              </ActionForm>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
