import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { reflect, recall } from './hindsight-actions.ts';
import { BUDGETS, KIND_WORDS, questionProblem, type Budget, type MemoryKind, type RecallHit, type Reflection } from './hindsight-model.ts';
import './memory.css';

type Mode = 'recall' | 'reflect';
const MODES = [
  { value: 'recall', label: 'Recall' },
  { value: 'reflect', label: 'Reflect' },
] as const;
const MODE_WORDS: Record<Mode, string> = {
  recall: 'Recall lists the memories that match a question, best first.',
  reflect: 'Reflect asks Hindsight to write an answer from the bank, using its memories, directives and mental models. It can take half a minute.',
};

/** Asks a bank: recall (the matching memories) and reflect (an answer written from them). Both are reads; nothing is kept of the question or the answer. */
export function HindsightAsk({ profile, bank }: { profile: string; bank: string }) {
  const [mode, setMode] = useState<Mode>('recall');
  const [query, setQuery] = useState('');
  const [budget, setBudget] = useState<Budget>('mid');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [hits, setHits] = useState<RecallHit[]>();
  const [reflection, setReflection] = useState<Reflection>();
  const modeLabel = useId();
  const queryId = useId();
  const budgetId = useId();

  const ask = async () => {
    const invalid = questionProblem(query);
    if (invalid) return setProblem(invalid);
    setProblem(undefined);
    setBusy(true);
    setHits(undefined);
    setReflection(undefined);
    const question = { query, budget };
    if (mode === 'recall') {
      const outcome = await recall(bank, profile, question);
      if (outcome.kind === 'done') setHits(outcome.body);
      else if (outcome.kind === 'failed') setProblem(outcome.message);
    } else {
      const outcome = await reflect(bank, profile, question);
      if (outcome.kind === 'done') setReflection(outcome.body);
      else if (outcome.kind === 'failed') setProblem(outcome.message);
    }
    setBusy(false);
  };

  return (
    <div className="mm-panel">
      <span className="field__label" id={modeLabel}>
        Ask by
      </span>
      <RadioGroup labelledBy={modeLabel} value={mode} options={MODES} onChange={setMode} className="seg" />
      <p className="mm-note">{MODE_WORDS[mode]}</p>
      <form
        className="mm-form"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor={queryId}>
            Question
          </label>
          <textarea id={queryId} className="input mm-area" rows={3} placeholder="What does the owner like to drink?" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={budgetId}>
            How hard to look
          </label>
          <select id={budgetId} className="input mm-kind" value={budget} onChange={(event) => setBudget(event.target.value as Budget)}>
            {BUDGETS.map((value) => (
              <option key={value} value={value}>
                {value === 'low' ? 'Quick (low)' : value === 'mid' ? 'Balanced (mid)' : 'Thorough (high)'}
              </option>
            ))}
          </select>
        </div>
        <div className="mm-actions">
          <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            <Icon name="search" small />
            {mode === 'recall' ? 'Recall' : 'Reflect'}
          </button>
        </div>
      </form>
      {problem && (
        <div className="banner" data-tone="warning" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{problem}</span>
        </div>
      )}
      {busy && <p role="status">{mode === 'recall' ? 'Recalling…' : 'Hindsight is thinking…'}</p>}
      {hits && hits.length === 0 && <p className="mm-note" role="status">Hindsight recalls nothing for that question.</p>}
      {hits && hits.length > 0 && (
        <ul className="mm-group-list" aria-label="Recalled memories">
          {hits.map((hit, index) => (
            <li key={hit.id || index} className="mm-hit">
              <span className="mm-row__label">{hit.text}</span>
              <span className="mm-row__links">{[KIND_WORDS[hit.kind as MemoryKind] ?? hit.kind, hit.score === undefined ? '' : `match ${Math.round(hit.score * 100)}%`].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
      {reflection && (
        <div className="mm-box" aria-label="Hindsight’s answer">
          <h3>Hindsight’s answer</h3>
          <p className="mm-text">{reflection.answer || 'Hindsight gave no answer.'}</p>
          {reflection.memories.length > 0 && (
            <>
              <h4 className="mm-group-title">Based on {reflection.memories.length} {reflection.memories.length === 1 ? 'memory' : 'memories'}</h4>
              <ul className="mm-bullets">
                {reflection.memories.map((memory, index) => (
                  <li key={memory.id || index}>{memory.text}</li>
                ))}
              </ul>
            </>
          )}
          {reflection.directives.length > 0 && <p className="mm-note">Directives applied: {reflection.directives.map((directive) => directive.name).join(', ')}.</p>}
          {reflection.models.length > 0 && <p className="mm-note">{reflection.models.length} mental {reflection.models.length === 1 ? 'model' : 'models'} used.</p>}
        </div>
      )}
    </div>
  );
}
