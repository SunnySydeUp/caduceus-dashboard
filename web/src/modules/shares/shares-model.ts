// What the share screens know, free of the DOM and of React (M7 #06): the lifetimes to choose from, the link a created share gives, how an expiry reads.
import { SHARE_EXPIRIES, type ShareCreated, type ShareExpiry } from '@caduceus/contracts/share-links';

export const EXPIRY_CHOICES: readonly { id: ShareExpiry; label: string }[] = [
  { id: '1d', label: '1 day' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'never', label: 'Never expires' },
];

/** Every lifetime the server offers has a label, and the other way round. */
export const EXPIRY_IDS: readonly string[] = SHARE_EXPIRIES;

/** The full link of a share: Caduceus's own address for the owner's other devices when the server knows it, else the address this page was opened at. */
export function shareLink(created: Pick<ShareCreated, 'origin' | 'path'>, pageOrigin: string): string {
  return `${created.origin ?? pageOrigin}${created.path}`;
}

/** "Expires 25 Oct 2026", or "Never expires". */
export function expiryWords(expiresAt: string | null): string {
  return expiresAt === null ? 'Never expires' : `Expires ${new Date(expiresAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}`;
}
