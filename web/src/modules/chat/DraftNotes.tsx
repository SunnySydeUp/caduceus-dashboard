// What the composer says about its draft (M1 #11): that another device wrote it, that the server did not keep it and why, and which attachments it did not keep.
// None of it blocks typing or sending: they are notes above the message box.
import { NEW_CHAT } from '@caduceus/contracts/chat-drafts';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { useDraftIndexLoaded, useOtherDrafts, type WaitingDraft } from './draft-index.ts';
import type { DraftNotice, DraftSync, DraftView } from './draft-sync.ts';

const ELSEWHERE: Record<Extract<DraftNotice, { kind: 'elsewhere' }>['how'], { title: string; body: string }> = {
  replaced: { title: 'Draft updated elsewhere', body: 'Another device had saved a different draft here. What you typed replaced it.' },
  newer: { title: 'Draft updated elsewhere', body: 'Another device saved a different draft while you were typing. What you typed is untouched.' },
  found: { title: 'Draft updated elsewhere', body: 'A draft saved on another device was waiting here. What you typed is untouched.' },
  updated: { title: 'Draft updated elsewhere', body: 'Another device saved a newer draft, so this message box now shows it.' },
};

export function DraftNotes({ view, sync }: { view: DraftView; sync: DraftSync }) {
  const { notice, unkept } = view;
  return (
    <>
      {notice?.kind === 'elsewhere' && (
        <div className="draft-note banner" data-tone="info" role="status" data-draft-note="elsewhere">
          <Icon name="info" />
          <div className="banner__content">
            <p className="banner__title">{ELSEWHERE[notice.how].title}</p>
            <p>{ELSEWHERE[notice.how].body}</p>
            <div className="draft-note__actions">
              {notice.how === 'updated' ? (
                <button type="button" className="btn btn--ghost btn--sm" onClick={sync.dismiss}>
                  Dismiss
                </button>
              ) : (
                <>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => void sync.takeTheirs()}>
                    {notice.how === 'replaced' ? 'Get the other draft back' : 'Use the other draft'}
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={notice.how === 'replaced' ? sync.dismiss : sync.keepMine}>
                    {notice.how === 'replaced' ? 'Dismiss' : 'Keep mine'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {(notice?.kind === 'refused' || notice?.kind === 'readonly') && (
        <div className="draft-note banner" data-tone="warning" role="status" data-draft-note={notice.kind}>
          <Icon name="alert" />
          <p className="banner__content">{notice.message}</p>
          <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Dismiss" onClick={sync.dismiss}>
            <Icon name="x" small />
          </button>
        </div>
      )}
      {unkept.length > 0 && (
        <div className="draft-note banner" data-tone="warning" role="status" data-draft-note="unkept">
          <Icon name="alert" />
          <ul className="banner__content attach-notes__list">
            {unkept.map((entry) => (
              <li key={entry.id}>{entry.reason}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** An empty message box says when a draft is waiting in another chat, so that words typed elsewhere do not look lost (talk audit #8). */
export function WaitingDraftHint({ here, empty }: { here: WaitingDraft; empty: boolean }) {
  useDraftIndexLoaded();
  const waiting = useOtherDrafts(here);
  const first = waiting[0];
  if (!empty || first === undefined) return null;
  const where = first.profile === here.profile ? `another chat with ${first.profile}` : `${first.profile}’s ${first.session === NEW_CHAT ? 'new chat' : 'chat'}`;
  return (
    <p className="draft-hint subtle" role="status" data-draft-note="waiting">
      <Icon name="draft" small />
      <span>
        A draft is waiting in {where}
        {waiting.length > 1 ? ` and ${waiting.length - 1} more` : ''}.{' '}
        <AppLink to={first.session === NEW_CHAT ? `/chat/new?profile=${encodeURIComponent(first.profile)}` : `/chat/${encodeURIComponent(first.session)}?profile=${encodeURIComponent(first.profile)}`}>Open it</AppLink>
      </span>
    </p>
  );
}
