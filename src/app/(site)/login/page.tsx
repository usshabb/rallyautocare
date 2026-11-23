import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth/LoginForm';
import { currentUser, visibleTestCode } from '@/lib/auth';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const user = await currentUser();
  // Signing in sets the session before a new account has a name and email, so a signed-in visitor
  // with those missing stays here to finish; everyone else moves on.
  const unfinished = !!user && !user.isAdmin && (!user.name || !user.email);
  if (user && !unfinished) redirect(user.isAdmin ? '/admin' : '/account');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : undefined;

  return (
    <section className="wrap section" style={{ maxWidth: 520, paddingTop: 72 }}>
      <div className="rly-card rly-card--striped stack g-6" style={{ padding: '40px 32px 32px' }}>
        <div className="stack g-3">
          <span className="rly-index">{unfinished ? 'CREATE ACCOUNT' : 'SIGN IN'}</span>
          <h1 className="rly-display" style={{ fontSize: 32 }}>
            {unfinished ? 'Almost there' : 'Your bookings, in one place'}
          </h1>
          {!unfinished && <p className="small muted">Sign in with your mobile number to manage bookings, your membership and payments. New here? This creates your account.</p>}
        </div>
        <LoginForm next={safeNext} testCode={visibleTestCode()} finish={unfinished && user ? { name: user.name, email: user.email } : undefined} />
      </div>
    </section>
  );
}
