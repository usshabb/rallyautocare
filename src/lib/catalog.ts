// Single source of truth for services, plans, add-ons and pricing.
// Marketing pages, the booking panel and server-side pricing all read from here.
// All money is in cents.

export type Size = 'car' | 'suv';
export type BookingKind = 'detail' | 'initial' | 'visit';

export const SIZE_SURCHARGE = 20_00;

export type Service = {
  id: string;
  name: string;
  price: number;
  minutes: number;
  duration: string;
  note: string;
  badge?: string;
  featured?: boolean;
  features: string[];
};

export const DETAILS: Service[] = [
  {
    id: 'essential',
    name: 'Essential',
    price: 150_00,
    minutes: 120,
    duration: 'about 2 hours',
    note: 'Quick refresh — in and out',
    features: ['Exterior hand wash', 'Wheels & tires', 'Interior vacuum & wipe-down', 'Glass cleaning', 'Tire dressing'],
  },
  {
    id: 'full',
    name: 'Full Detail',
    price: 225_00,
    minutes: 180,
    duration: 'about 3 hours',
    note: 'Everything in Essential, deeper',
    badge: 'Popular',
    featured: true,
    features: ['Deeper interior cleaning', 'Crevice & detailed cleaning', 'Interior protection', 'Exterior protection', 'More attention to detail'],
  },
  {
    id: 'premium',
    name: 'Premium Detail',
    price: 350_00,
    minutes: 270,
    duration: '4–5 hours',
    note: 'Full reset with 6-month sealant',
    features: ['Steam cleaning & stain removal', 'Heavy buildup removal', 'Clay bar decontamination', '6-month sealant', 'Paint gloss enhancement'],
  },
];

export type Plan = Service & { visits: number; regularValue: number };

export const PLANS: Plan[] = [
  {
    id: 'maint',
    name: 'Monthly Maintenance',
    price: 120_00,
    regularValue: 120_00,
    visits: 1,
    minutes: 120,
    duration: 'about 2 hours',
    note: '1 detail per month',
    features: ['Full hand wash, wheels & wells', 'Interior vacuum, dash & door panels', 'Interior glass & tire dressing', 'Detailed finishing touches'],
  },
  {
    id: 'plus',
    name: 'Rally Plus',
    price: 180_00,
    regularValue: 240_00,
    visits: 2,
    minutes: 120,
    duration: 'about 2 hours',
    note: '2 details per month',
    badge: 'Best value',
    featured: true,
    features: ['Everything in Monthly Maintenance', 'Extra attention to wheels & crevices', 'Exterior protection', 'Priority scheduling', 'Member pricing on add-ons'],
  },
];

// New members start with an initial detail that brings the vehicle up to standard.
export const INITIAL_DETAIL = {
  id: 'initial',
  name: 'Initial detail',
  price: 175_00,
  minutes: 180,
  duration: 'about 3 hours',
};

export type Addon = { id: string; name: string; price: number };

export const ADDONS: Addon[] = [
  { id: 'trim', name: 'Trim shine', price: 10_00 },
  { id: 'engine', name: 'Engine bay detail', price: 25_00 },
  { id: 'pet', name: 'Pet hair removal', price: 40_00 },
  { id: 'odor', name: 'Odor treatment', price: 50_00 },
];

export const SPECIALTY: { name: string; items: { k: string; v: string }[] }[] = [
  { name: 'Paint correction', items: [{ k: '1-step', v: '$250+' }, { k: '2-step', v: '$450+' }, { k: 'Multi-step', v: '$700+' }] },
  { name: 'Ceramic coating', items: [{ k: '1-year', v: '$400+' }, { k: '3-year', v: '$650+' }, { k: '5-year', v: '$900+' }] },
  {
    name: 'Paint protection film',
    items: [
      { k: 'Partial front', v: '$1,200+' },
      { k: 'Full front', v: '$1,900+' },
      { k: 'Full front + rockers', v: '$2,500+' },
      { k: 'Full vehicle', v: '$8,500+' },
    ],
  },
  { name: 'Window tint', items: [{ k: 'Front 2 windows', v: '$100+' }, { k: 'Full vehicle', v: '$250+' }, { k: 'Premium ceramic', v: '$350+' }] },
  { name: 'Restoration', items: [{ k: 'Headlight restoration', v: '$100+' }, { k: 'Paint decontamination', v: '$50+' }, { k: 'Ceramic maintenance', v: '$75+' }] },
];

export const BUSINESS = {
  legalName: 'RALLYAUTOCARE LLC',
  name: 'Rally Auto Care',
  phone: '571-420-1217',
  phoneHref: 'tel:+15714201217',
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || '',
  instagram: '@RallyAutoCare.US',
  instagramHref: 'https://instagram.com/rallyautocare.us',
  city: 'Ashburn, VA',
  area: 'Northern Virginia',
  hours: '10AM – 8PM',
  domain: 'rallyautocare.us',
};

// What clients do before the crew arrives. Shown after booking, on the booking page, and in the texts.
export const PREP_STEPS = [
  'Take out trash and personal items',
  'Remove car seats and seat covers',
  'Leave the car unlocked or the keys handy, and send us any gate code',
];
export const PREP_NOTE = 'Anything we have to clear out or work around adds time, and may add to the price.';

// Ways the crew can record a payment by hand. Card payments through Stripe record themselves.
export const PAYMENT_METHODS = [
  { id: 'zelle', name: 'Zelle' },
  { id: 'apple_pay', name: 'Apple Pay' },
  { id: 'quickbooks', name: 'Card (QuickBooks)' },
  { id: 'cash', name: 'Cash' },
  { id: 'other', name: 'Other' },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['id'];
export const STRIPE_METHOD = 'stripe';

export const usd = (cents: number) => {
  const dollars = cents / 100;
  return '$' + dollars.toLocaleString('en-US', Number.isInteger(dollars) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const findDetail = (id: string) => DETAILS.find((s) => s.id === id);
export const findPlan = (id: string) => PLANS.find((p) => p.id === id);
export const findAddon = (id: string) => ADDONS.find((a) => a.id === id);
export const sizeLabel = (size: Size) => (size === 'suv' ? 'SUV / larger' : 'Car');
export const methodLabel = (id: string | null | undefined) => (id === STRIPE_METHOD ? 'Card (Stripe)' : (PAYMENT_METHODS.find((m) => m.id === id)?.name ?? '—'));

/** What a booking is called and how long it takes, for any kind. */
export function serviceInfo(kind: BookingKind, serviceId: string): { name: string; minutes: number; duration: string } | null {
  if (kind === 'detail') {
    const s = findDetail(serviceId);
    return s ? { name: s.name, minutes: s.minutes, duration: s.duration } : null;
  }
  const plan = findPlan(serviceId);
  if (!plan) return null;
  if (kind === 'initial') {
    return { name: `${INITIAL_DETAIL.name} · ${plan.name}`, minutes: INITIAL_DETAIL.minutes, duration: INITIAL_DETAIL.duration };
  }
  return { name: `${plan.name} visit`, minutes: plan.minutes, duration: plan.duration };
}

export type PriceLine = { k: string; cents: number };

/** Monthly price of a plan for a vehicle size. */
export const planMonthly = (planId: string, size: Size) => {
  const plan = findPlan(planId);
  return plan ? plan.price + (size === 'suv' ? SIZE_SURCHARGE : 0) : 0;
};

/** Itemised estimate for a single visit. Never trust totals sent by the browser — call this on the server. */
export function priceVisit(input: { kind: BookingKind; serviceId: string; size: Size; addonIds: string[] }): { lines: PriceLine[]; total: number } | null {
  const { kind, serviceId, size } = input;
  const lines: PriceLine[] = [];
  if (kind === 'detail') {
    const s = findDetail(serviceId);
    if (!s) return null;
    lines.push({ k: s.name, cents: s.price });
    if (size === 'suv') lines.push({ k: 'SUV / larger vehicle', cents: SIZE_SURCHARGE });
  } else if (kind === 'initial') {
    if (!findPlan(serviceId)) return null;
    lines.push({ k: INITIAL_DETAIL.name, cents: INITIAL_DETAIL.price });
    if (size === 'suv') lines.push({ k: 'SUV / larger vehicle', cents: SIZE_SURCHARGE });
  } else {
    if (!findPlan(serviceId)) return null;
    lines.push({ k: 'Included in membership', cents: 0 });
  }
  const seen = new Set<string>();
  for (const id of input.addonIds) {
    const a = findAddon(id);
    if (!a || seen.has(id)) continue;
    seen.add(id);
    lines.push({ k: a.name, cents: a.price });
  }
  return { lines, total: lines.reduce((t, l) => t + l.cents, 0) };
}
