// Settings › Security › Shares (M7 #06): the active share links with session, profile, created and expiry, and Revoke, which is a Tier 0 with an undo window.
import { useCallback, useEffect, useState } from 'react';
import type { ShareSummary } from '@caduceus/contracts/share-links';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { fetchTiered } from '../../tiered.ts';
import { runTiered } from '../profiles/profile-actions.ts';
import { expiryWords } from './shares-model.ts';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function SharesSection() {
  const [shares, setShares] = useState<ShareSummary[]>();
  const [failure, setFailure] = useState<string>();

  const load = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch('/_caduceus/api/shares', { signal }).catch(() => undefined);
    const body: unknown = await res?.json().catch(() => undefined);
    if (signal?.aborted) return;
    if (res?.ok && typeof body === 'object' && body !== null && 'shares' in body && Array.isArray(body.shares)) {
      setShares(body.shares as ShareSummary[]);
      setFailure(undefined);
    } else setFailure('Caduceus could not list the share links.');
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const restore = async (share: ShareSummary) => {
    const outcome = await runTiered(fetchTiered({ method: 'POST', path: `/_caduceus/api/shares/${encodeURIComponent(share.id)}/restore` }));
    toast(outcome.kind === 'done' ? 'The link works again' : outcome.kind === 'failed' ? outcome.message : 'Not restored', { tone: outcome.kind === 'done' ? 'success' : 'danger' });
    await load();
  };

  const revoke = async (share: ShareSummary) => {
    const outcome = await runTiered<{ undoMs: number }>(fetchTiered({ method: 'DELETE', path: `/_caduceus/api/shares/${encodeURIComponent(share.id)}` }));
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') toast(`Revoked the link to “${share.title}”`, { detail: 'It stopped working at once. Undo brings it back for a minute.', timeout: Math.min(outcome.body.undoMs, 30_000), undo: () => void restore(share) });
    await load();
  };

  return (
    <section className="settings-section" aria-labelledby="shares-title">
      <h2 id="shares-title">Share links</h2>
      <p className="help-text">
        Each <Term id="share-link">share link</Term> opens a read-only copy of one session, only for devices on your tailnet. Revoke stops a link at once.
      </p>
      {failure && (
        <p className="error-text" role="alert">
          {failure}
        </p>
      )}
      {shares?.length === 0 && <p className="help-text">No active share links. Make one from a chat’s menu or a session’s ⋮ menu.</p>}
      {shares && shares.length > 0 && (
        <ul className="settings-list">
          {shares.map((share) => (
            <li key={share.id} className="settings-row">
              <div className="settings-row-text">
                <strong>{share.title}</strong>
                <span className="help-text">
                  Profile {share.profile} · Created {when(share.createdAt)} · {expiryWords(share.expiresAt)}
                </span>
              </div>
              <WriteButton type="button" className="btn btn--secondary btn--sm" aria-label={`Revoke the link to ${share.title}`} onClick={() => void revoke(share)}>
                Revoke
              </WriteButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
