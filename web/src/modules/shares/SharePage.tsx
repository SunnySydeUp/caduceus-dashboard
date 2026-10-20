// The page a share link opens (M7 #06): a read-only copy of a session, drawn with the same transcript renderer as the chat, for a visitor with no session. It
// asks for the snapshot at `/_caduceus/share/<token>` and nothing else; there is no composer, no message action and no shell. Tool arguments flagged as
// secret are hidden again here, whatever the snapshot holds.
import { useEffect, useMemo, useState } from 'react';
import { sharedRow, type SharedTranscript } from '@caduceus/contracts/share-links';
import { ActivityGroup } from '../chat/ActivityCards.tsx';
import { entriesOf } from '../chat/activity.ts';
import type { HistoryRow } from '../chat/history-window.ts';
import { Rich } from '../chat/Rich.tsx';
import '../chat/chat.css';
import './shares.css';

type Loaded = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; transcript: SharedTranscript };

export function SharePage() {
  const token = location.pathname.slice('/share/'.length);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/_caduceus/share/${encodeURIComponent(token)}`, { signal: controller.signal, credentials: 'omit' }).then(
      async (res) => {
        const body: unknown = res.ok ? await res.json().catch(() => undefined) : undefined;
        if (!controller.signal.aborted) setLoaded(body ? { state: 'ready', transcript: body as SharedTranscript } : { state: 'missing' });
      },
      () => !controller.signal.aborted && setLoaded({ state: 'missing' }),
    );
    return () => controller.abort();
  }, [token]);
  useEffect(() => {
    document.title = loaded.state === 'ready' ? `${loaded.transcript.title} (shared)` : 'Shared session';
  }, [loaded]);

  const entries = useMemo(() => (loaded.state === 'ready' ? entriesOf(loaded.transcript.rows.map((row) => sharedRow(row as unknown as Record<string, unknown>) as unknown as HistoryRow)) : []), [loaded]);

  if (loaded.state === 'loading') return <p className="sh-page" role="status">Loading…</p>;
  if (loaded.state === 'missing') {
    return (
      <main className="sh-page">
        <h1>This link is not available</h1>
        <p>It may have expired or been revoked, or it was never a share link. Ask the person who sent it for a new one.</p>
      </main>
    );
  }
  const { transcript } = loaded;
  return (
    <main className="sh-page">
      <header className="sh-page__head">
        <h1>{transcript.title}</h1>
        <p className="subtle">
          A read-only copy, taken {new Date(transcript.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.{' '}
          {transcript.expiresAt === null ? 'This link does not expire.' : `This link expires ${new Date(transcript.expiresAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}.`}
        </p>
      </header>
      <div className="sh-page__transcript" role="log" aria-label="Shared conversation">
        {entries.map((entry, index) =>
          entry.kind === 'activity' ? (
            <ActivityGroup key={`a${index}`} items={entry.items} mode="worklog" />
          ) : entry.role === 'user' ? (
            <div key={entry.id} className="chat__user">
              <div className="msg-user">
                <Rich text={entry.text} anchor={`m${entry.id}`} />
              </div>
            </div>
          ) : (
            <div key={entry.id} className="msg-agent">
              <Rich text={entry.text} anchor={`m${entry.id}`} />
            </div>
          ),
        )}
      </div>
    </main>
  );
}
