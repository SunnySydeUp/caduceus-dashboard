import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { saveContextEngine } from './memory-actions.ts';
import { useContextEngine } from './memory-data.ts';
import './memory.css';

/** The profile's context engine: the engines Hermes offers (its own compressor and any a plugin provides), one chosen and saved through Hermes. */
export function EnginePanel({ profile }: { profile: string }) {
  const view = useContextEngine(profile);
  const name = useId();
  const [picked, setPicked] = useState<string>();
  const [busy, setBusy] = useState(false);
  const choice = view.value;
  const selected = picked ?? choice?.current;
  const changed = choice !== undefined && selected !== undefined && selected !== choice.current;

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    const outcome = await saveContextEngine(selected, profile);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    await view.reload();
    setPicked(undefined);
    toast(`${profile} uses the ${selected} context engine`, { detail: 'New sessions use it.' });
  };

  return (
    <div className="mm-panel">
      <p className="help-text">
        The <Term id="context-engine">context engine</Term> decides how a long chat is compacted when its context fills up. Hermes’s own compressor is the default; a plugin can provide others. Plugins are installed on this computer, so the same engines are on offer for every profile.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so the context engine could not be read{choice ? ': this is what it said a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!choice && !view.failed && <Loading label="Loading the context engine…" lines={3} onRetry={() => void view.reload()} />}
      {choice && (
        <fieldset className="mm-group">
          <legend className="sr-only">Context engine of {profile}</legend>
          <ul className="mm-choices">
            {choice.options.map((option) => (
              <li key={option.name}>
                <label className="mm-choice">
                  <input type="radio" name={name} value={option.name} checked={selected === option.name} onChange={() => setPicked(option.name)} />
                  <span className="mm-choice__dot" aria-hidden="true" />
                  <span className="mm-choice__main">
                    <span className="mm-choice__name">
                      {option.name}
                      {option.name === choice.current && <span className="tag" data-tone="accent"> In use</span>}
                      {!option.installed && <span className="tag" data-tone="warning"> Not installed</span>}
                    </span>
                    <span className="mm-note">{option.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {choice && (
        <div className="mm-actions">
          <WriteButton type="button" className="btn btn--primary" disabled={!changed || busy} aria-busy={busy} onClick={() => void save()}>
            <Icon name="check" />
            Save context engine…
          </WriteButton>
          {changed && (
            <button type="button" className="btn btn--ghost" onClick={() => setPicked(undefined)}>
              Discard
            </button>
          )}
        </div>
      )}
    </div>
  );
}
