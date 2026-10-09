import { addVehicle, removeVehicle, updateProfile } from '@/app/actions/account';
import { signOut } from '@/app/actions/auth';
import { PageHead } from '@/components/app/PageHead';
import { ActionForm, Submit } from '@/components/ui/ActionForm';
import { ConfirmAction } from '@/components/ui/Dialog';
import { requireUser } from '@/lib/auth';
import { sizeLabel } from '@/lib/catalog';
import { formatPhone } from '@/lib/phone';
import { listVehicles } from '@/lib/queries';

export default async function ProfilePage() {
  const user = await requireUser('/account/profile');
  const vehicles = await listVehicles(user.id);

  return (
    <>
      <PageHead index="PROFILE" title="Your details">
        <form action={signOut}>
          <button type="submit" className="rly-btn rly-btn--secondary rly-btn--sm">
            Sign out
          </button>
        </form>
      </PageHead>

      <div className="detail-grid">
        <ActionForm action={updateProfile} className="panel panel--tight" saved="Saved.">
          <div className="form-grid">
            <label className="rly-field">
              <span className="rly-field__label">Full name</span>
              <input className="rly-input" name="name" defaultValue={user.name} autoComplete="name" required />
            </label>
            <label className="rly-field">
              <span className="rly-field__label">Mobile</span>
              <input className="rly-input" value={formatPhone(user.phone)} disabled readOnly />
            </label>
          </div>
          <label className="rly-field">
            <span className="rly-field__label">Email</span>
            <input className="rly-input" name="email" type="email" defaultValue={user.email} autoComplete="email" placeholder="you@example.com" required />
            <span className="rly-field__hint">For booking details and receipts.</span>
          </label>
          <label className="rly-field">
            <span className="rly-field__label">Usual service address</span>
            <input className="rly-input" name="address" defaultValue={user.address} placeholder="Street, city, ZIP" autoComplete="street-address" />
            <span className="rly-field__hint">We’ll fill this in when you book. You can change it per visit.</span>
          </label>
          <div>
            <Submit className="rly-btn rly-btn--dark" pending="Saving…">
              Save details
            </Submit>
          </div>
        </ActionForm>

        <div className="rly-card stack g-5">
          <h2 className="h3">Vehicles</h2>
          <div className="list">
            {vehicles.length === 0 && <p className="list__empty">No vehicles saved yet.</p>}
            {vehicles.map((v) => (
              <div key={v.id} className="list__item" style={{ padding: '12px 16px' }}>
                <div className="list__main">
                  <span className="list__title">{v.label}</span>
                  <span className="list__sub">{sizeLabel(v.size)}</span>
                </div>
                <ConfirmAction
                  action={removeVehicle}
                  fields={{ vehicleId: v.id }}
                  label="Remove"
                  className="rly-btn rly-btn--ghost rly-btn--sm"
                  title="Remove this vehicle?"
                  text={`${v.label} will no longer be offered when you book. Past bookings keep their record.`}
                  confirmLabel="Remove vehicle"
                />
              </div>
            ))}
          </div>
          <ActionForm action={addVehicle} className="stack g-3" reset>
            <label className="rly-field">
              <span className="rly-field__label">Add a vehicle</span>
              <input className="rly-input" name="label" placeholder="Year, make, model" required />
            </label>
            <div className="wrap-row">
              <span className="rly-select-wrap grow">
                <select className="rly-select" name="size" defaultValue="car" aria-label="Vehicle size">
                  <option value="car">Car</option>
                  <option value="suv">SUV / larger</option>
                </select>
              </span>
              <Submit className="rly-btn rly-btn--secondary" pending="Adding…">
                Add
              </Submit>
            </div>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
