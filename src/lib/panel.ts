import type { PanelCustomer } from '@/components/booking/BookingPanel';
import type { User } from './db/schema';
import { formatPhone } from './phone';
import { listVehicles } from './queries';

/** The saved details the booking panel prefills for a customer. */
export async function panelCustomer(user: User | null): Promise<PanelCustomer | null> {
  if (!user) return null;
  const vehicles = await listVehicles(user.id);
  return { name: user.name, email: user.email, phone: formatPhone(user.phone), address: user.address, vehicles: vehicles.map((v) => ({ id: v.id, label: v.label, size: v.size })) };
}
