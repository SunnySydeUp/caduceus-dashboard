import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { resetMemory } from './behaviour-actions.ts';
import type { ResetTarget } from './behaviour-files.ts';
import { FileEditor } from './FileEditor.tsx';
import type { TabProps } from './ProfileDetail.tsx';

const RESETS: { target: ResetTarget; label: string }[] = [
  { target: 'memory', label: 'Reset MEMORY.md…' },
  { target: 'user', label: 'Reset USER.md…' },
  { target: 'all', label: 'Reset both…' },
];

/** MEMORY.md and USER.md, with their sizes against Hermes's limits and the reset. */
export function MemoryFiles({ card }: TabProps) {
  // A reset changes the files under the editors: they read again.
  const [epoch, setEpoch] = useState(0);
  const reset = async (target: ResetTarget) => {
    const outcome = await resetMemory(card.name, target);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      toast('Memory reset', { tone: 'success', detail: 'The text is in History if you want it back.' });
      setEpoch((count) => count + 1);
    }
  };
  return (
    <div className="stack">
      <p className="help-text">
        What this profile’s agent remembers: <Term id="memory-md">MEMORY.md</Term> holds what it has learned and <Term id="user-md">USER.md</Term> what it knows about you. Hermes limits the size of each. Reset deletes the file in Hermes; Caduceus keeps the text as a <Term id="snapshot">snapshot</Term>.
      </p>
      <div className="banner" data-tone="info">
        <Icon name="info" />
        <div className="banner__content">
          <div className="banner__title">More memory settings</div>
          <div className="banner__body">The memory provider and its settings, the context engine, the learning graph, project context and the LLM Wiki are in Memory, for the profile this tab works on.</div>
        </div>
        <div className="banner__actions">
          <AppLink className="btn btn--secondary btn--sm" to={`/agents/memory?profile=${encodeURIComponent(card.name)}`}>
            Open Memory
          </AppLink>
        </div>
      </div>
      <FileEditor key={`memory-${epoch}`} card={card} id="memory" />
      <FileEditor key={`user-${epoch}`} card={card} id="user" />
      <section className="panel panel--pad pf-danger__row" aria-labelledby="fe-reset-title">
        <h3 id="fe-reset-title">Reset memory</h3>
        <p>Deletes the file or files in Hermes. You type this profile’s name to confirm, and the text stays in History.</p>
        <div className="row">
          {RESETS.map(({ target, label }) => (
            <WriteButton key={target} type="button" className="btn btn--danger-quiet" onClick={() => void reset(target)}>
              <Icon name="trash" />
              {label}
            </WriteButton>
          ))}
        </div>
      </section>
    </div>
  );
}
