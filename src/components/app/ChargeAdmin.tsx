import Link from 'next/link';
import { editCharge, recordPayment, undoPayment, voidDue } from '@/app/actions/admin';
import { makeInvoiceLink } from '@/app/actions/pay';
import { PAYMENT_METHODS, methodLabel, usd } from '@/lib/catalog';
import type { Charge } from '@/lib/db/schema';
import { fmtStamp } from '@/lib/time';
import { ActionForm, Submit } from '../ui/ActionForm';
import { ChargeBadge } from '../ui/badges';
import { CopyField } from '../ui/CopyField';

/** Charges with the controls the crew needs: record how it was paid, fix the amount, attach a card link, void. */
export function ChargeAdmin({ rows, empty, who, cards = false }: { rows: (Charge & { customerName?: string })[]; empty: string; who?: boolean; /** Stripe is connected */ cards?: boolean }) {
  if (!rows.length) return <div className="list"><p className="list__empty">{empty}</p></div>;
  return (
    <div className="list">
      {rows.map((c) => (
        <div key={c.id} className="list__item" style={{ flexWrap: 'wrap', alignItems: 'flex-start', gap: '12px 16px' }}>
          <div className="list__main">
            <span className="list__title">{c.description}</span>
            <span className="list__sub">
              {who && (
                <>
                  <Link href={`/admin/clients/${c.userId}`} className="link">
                    {c.customerName || 'Client'}
                  </Link>{' '}
                  ·{' '}
                </>
              )}
              {c.status === 'paid' ? `Paid ${fmtStamp(c.paidAt)} · ${methodLabel(c.method)}` : `Billed ${fmtStamp(c.createdAt)}`}
            </span>
          </div>
          <div className="wrap-row" style={{ gap: 10 }}>
            <span className="rly-data strong">
              {usd(c.amountCents)}
              {c.taxCents > 0 ? ` + ${usd(c.taxCents)} tax` : ''}
            </span>
            {c.kind === 'duplicate' ? <span className="rly-badge rly-badge--accent">Refund in Stripe</span> : <ChargeBadge status={c.status} />}
          </div>

          {c.status === 'due' && (
            <div className="stack g-3" style={{ flexBasis: '100%' }}>
              <ActionForm action={recordPayment} className="inline-form">
                <input type="hidden" name="chargeId" value={c.id} />
                <span className="rly-select-wrap" style={{ minWidth: 170 }}>
                  <select className="rly-select rly-select--sm" name="method" defaultValue="zelle" aria-label="Paid by">
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </span>
                <Submit pending="Saving…">Mark paid</Submit>
              </ActionForm>
              {c.payLink ? (
                <CopyField value={c.payLink} label="Pay link" />
              ) : (
                cards && (
                  <ActionForm action={makeInvoiceLink}>
                    <input type="hidden" name="chargeId" value={c.id} />
                    <Submit className="rly-btn rly-btn--secondary rly-btn--sm" pending="Creating…">
                      Create card pay link
                    </Submit>
                  </ActionForm>
                )
              )}
              <details>
                <summary className="link tiny" style={{ display: 'inline', cursor: 'pointer' }}>
                  Edit amount, card link or void
                </summary>
                <div className="stack g-3" style={{ paddingTop: 12 }}>
                  <ActionForm action={editCharge} className="inline-form" saved="Saved.">
                    <input type="hidden" name="chargeId" value={c.id} />
                    <label className="rly-field" style={{ maxWidth: 130 }}>
                      <span className="rly-field__label">Amount</span>
                      <input className="rly-input rly-input--sm rly-data" name="amount" defaultValue={(c.amountCents / 100).toFixed(2)} inputMode="decimal" />
                    </label>
                    <label className="rly-field">
                      <span className="rly-field__label">Pay link</span>
                      <input className="rly-input rly-input--sm" name="payLink" defaultValue={c.payLink} placeholder="https://…" />
                    </label>
                    <Submit className="rly-btn rly-btn--secondary rly-btn--sm">Save</Submit>
                  </ActionForm>
                  <ActionForm action={voidDue}>
                    <input type="hidden" name="chargeId" value={c.id} />
                    <Submit className="rly-btn rly-btn--ghost rly-btn--sm">Void this charge</Submit>
                  </ActionForm>
                </div>
              </details>
            </div>
          )}
          {c.status === 'paid' && c.method !== 'stripe' && (
            <ActionForm action={undoPayment} className="" >
              <input type="hidden" name="chargeId" value={c.id} />
              <Submit className="link tiny">Undo</Submit>
            </ActionForm>
          )}
        </div>
      ))}
    </div>
  );
}
