// The shell's own "Sign out": the palette and Control offer it, so it is not buried in Settings › Security. It asks to confirm first (a shared phone is
// where it matters, and a tap on a list row should not end the session), then ends this device's session and opens the sign-in page.
import { postJson } from '../passkeys.ts';
import { confirmTier } from './tier-confirmation.ts';
import { toast } from './toasts.ts';

export async function signOut(): Promise<void> {
  const confirmed = await confirmTier({
    tier: 'T1',
    moduleId: 'shell',
    action: 'session.sign-out',
    label: 'Sign out of Caduceus?',
    text: 'You will have to sign in again on this device. Your other devices stay signed in.',
    confirmLabel: 'Sign out',
  });
  if (!confirmed) return;
  const response = await postJson('/_caduceus/api/auth/sign-out').catch(() => undefined);
  if (response?.ok) location.assign('/sign-in');
  else toast('Could not sign out. Check the connection and try again.', { tone: 'danger' });
}
