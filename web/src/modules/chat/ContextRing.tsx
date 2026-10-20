// The context sheet (M1 #08, opened from the Context row of This chat since M8 #09): how full the context window is, with the session's cost and cache hit rate, the
// split of the window by category and the Compress action. Everything is Hermes's (`session.usage`, `session.context_breakdown`,
// `session.compress`); the ring only draws what the chat engine holds.
import { useEffect, useState } from 'react';
import type { SessionCompressResult, SessionContextBreakdownResult } from '@caduceus/contracts/hermes/gateway';
import { Sheet } from '../../overlays/Sheet.tsx';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { Term } from '../../shell/Term.tsx';
import type { Chat, ChatState } from './chat-session.ts';
import { contextRing } from './composer-model.ts';
import { usageRows } from './ContextPanel.tsx';
import { refusedChange } from './ComposerEditors.tsx';

const number = new Intl.NumberFormat('en');

function Breakdown({ chat, state }: { chat: Chat; state: ChatState }) {
  const [breakdown, setBreakdown] = useState<SessionContextBreakdownResult>();
  const [failed, setFailed] = useState(false);
  // Read again when the conversation or its usage changes (a turn ended, Compress ran).
  const used = state.usage?.context_used;
  useEffect(() => {
    let current = true;
    chat.contextBreakdown().then(
      (result) => current && (setBreakdown(result), setFailed(false)),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [chat, used, state.storedId]);
  if (failed && !breakdown) return <p className="subtle">Hermes could not split the context window just now.</p>;
  if (!breakdown) return <p className="subtle" role="status">Asking Hermes how the window is used…</p>;
  const total = breakdown.categories.reduce((sum, category) => sum + category.tokens, 0);
  if (total === 0) return <p className="subtle">Hermes has not built this chat’s agent yet, so there is nothing to split.</p>;
  return (
    <section aria-labelledby="ctxring-breakdown">
      <h3 id="ctxring-breakdown" className="ctx__heading">
        What fills the window
      </h3>
      <ul className="ctxring__bars">
        {breakdown.categories.map((category) => (
          <li key={category.id} className="ctxring__bar">
            <span className="ctxring__bar-label">{category.label}</span>
            <progress className="ctxring__meter" max={total} value={category.tokens} aria-label={`${category.label}: ${number.format(category.tokens)} tokens`} />
            <span className="mono ctxring__bar-value">{number.format(category.tokens)}</span>
          </li>
        ))}
      </ul>
      {breakdown.context_estimated && <p className="subtle">These sizes are estimates until the provider reports its own.</p>}
    </section>
  );
}

/** What the context window holds, with Compress: the sheet the Context row of This chat opens. */
export function ContextSheet({ chat, state, onClose }: { chat: Chat | undefined; state: ChatState; onClose(): void }) {
  const ring = contextRing(state.usage);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SessionCompressResult>();
  const compress = async () => {
    if (!chat) return;
    const confirmed = await confirmTier({
      tier: 'T1',
      moduleId: 'chat',
      action: 'chat.compress',
      label: 'Compress this conversation?',
      text: 'Hermes replaces the older messages with a summary to free room in the context window. The messages it takes out are not kept in this chat, so this cannot be undone.',
      confirmLabel: 'Compress',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const done = await chat.compress();
      setResult(done);
      toast(done.summary?.headline ?? 'Compressed', { tone: done.summary?.noop ? 'info' : 'success', ...(done.summary?.token_line ? { detail: done.summary.token_line } : {}) });
    } catch (error) {
      refusedChange('Hermes did not compress the conversation')(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Context" detents={['half', 'full']} initialFocus="[data-close]" onClose={onClose}>
      <div className="ctxring">
        <p className="ctxring__lead">
          <span className="ring ctxring__big" style={{ ['--v' as string]: ring.percent ?? 0 }} data-tone={ring.tone} aria-hidden="true" />
          <span>{ring.label}</span>
        </p>
        <p className="subtle">
          The <Term id="context-ring">context ring</Term> shows how much of the model’s context window this conversation fills. Past 70% it warns; compressing frees room by summarising older messages.
        </p>
        {state.usage && usageRows(state.usage).length > 0 && (
          <dl className="act__facts ctx__usage">
            {usageRows(state.usage).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {chat && state.storedId !== undefined ? <Breakdown chat={chat} state={state} /> : <p className="subtle">Nothing has been sent yet, so the window is empty.</p>}
        <div className="ctxring__actions">
          <WriteButton type="button" className="btn btn--secondary" disabled={!chat || state.storedId === undefined || state.running || busy} aria-busy={busy} onClick={() => void compress()}>
            Compress
          </WriteButton>
          {state.running && <span className="subtle">Hermes cannot compress while it is writing a reply.</span>}
        </div>
        {result?.summary && (
          <p role="status" className="ctxring__result">
            <strong>{result.summary.headline}</strong>
            {result.summary.token_line ? ` ${result.summary.token_line}` : ''}
          </p>
        )}
      </div>
    </Sheet>
  );
}
