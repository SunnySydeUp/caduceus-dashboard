import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Term } from '../../shell/Term.tsx';
import { AddMemorySheet } from './AddMemorySheet.tsx';
import { HindsightAsk } from './HindsightAsk.tsx';
import { HindsightBrowse } from './HindsightBrowse.tsx';
import { useHindsightStatus } from './hindsight-data.ts';
import { toast } from '../../shell/toasts.ts';
import { trustAddress } from './hindsight-actions.ts';
import { bankLabel, startBank } from './hindsight-model.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { useReadOnly } from '../../policy-state.ts';
import './memory.css';

const VIEWS = [
  { value: 'memories', label: 'Memories' },
  { value: 'directives', label: 'Directives' },
  { value: 'models', label: 'Mental models' },
  { value: 'ask', label: 'Ask' },
] as const;
type View = (typeof VIEWS)[number]['value'];

/** The profile's Hindsight memory bank: browse its memories, directives and mental models, ask it, add to it. Not connected is a state of this screen, in words. */
export function HindsightPanel({ profile }: { profile: string }) {
  const view = useHindsightStatus(profile);
  const status = view.value;
  const [chosen, setChosen] = useState<string>();
  const [mode, setMode] = useState<View>('memories');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(0);
  const readOnly = useReadOnly();
  const viewLabel = useId();
  const bankId = useId();
  const bank = chosen ?? (status ? startBank(status) : undefined);

  return (
    <div className="mm-panel">
      <p className="help-text">
        <Term id="hindsight">Hindsight</Term> is a memory service that keeps what <strong>{profile}</strong> learns as facts in a bank, with <Term id="directive">directives</Term> it always follows and <Term id="mental-model">mental models</Term> it keeps up to date. Caduceus asks Hindsight directly, with the key Hermes holds for it, and keeps nothing it says.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Caduceus could not ask Hermes how Hindsight is set up{status ? ': this is the last answer' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!status && !view.failed && <p role="status">Looking for Hindsight…</p>}
      {status?.keyPinnedTo && status.apiUrl && (
        <div className="banner" data-tone="warning" role="status">
          <Icon name="alert" />
          <div className="banner__content stack">
            <span>
              Hermes’s Hindsight address changed. Your key was first used with <span className="mm-code">{status.keyPinnedTo}</span>, and the setting now says <span className="mm-code">{status.apiUrl}</span>, so Caduceus does not send the key there.
            </span>
            <span>
              <WriteButton
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() =>
                  void trustAddress(profile, status.keyPinnedTo!, status.apiUrl!).then(async (outcome) => {
                    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
                    if (outcome.kind !== 'done') return;
                    toast('Your key is now used with the new address', { detail: 'Recorded in the audit log.' });
                    await view.reload();
                  })
                }
              >
                This address changed: use my key with it
              </WriteButton>
            </span>
          </div>
        </div>
      )}
      {status?.state === 'off' && (
        <div className="empty" data-state="off">
          <span className="empty__icon">
            <Icon name="database" />
          </span>
          <p>Hindsight is not this profile’s memory provider.</p>
          <p className="mm-note">To turn it on, open the Provider tab, choose Hindsight, fill in its settings (cloud or your own server, and a key) and save. Then come back here to browse its bank.</p>
          <div className="mm-actions">
            <AppLink className="btn btn--primary" to="/agents/memory">
              Open the Provider tab
            </AppLink>
          </div>
        </div>
      )}
      {status && status.state !== 'off' && status.state !== 'connected' && (
        <div className="mm-box" data-state={status.state}>
          <h3>Hindsight is not connected</h3>
          <div className="banner" data-tone={status.state === 'embedded' ? 'info' : 'warning'} role="status">
            <Icon name={status.state === 'embedded' ? 'info' : 'alert'} />
            <span className="banner__content">{status.message}</span>
          </div>
          {status.apiUrl && (
            <p className="mm-note">
              Hermes is set to {status.mode === 'cloud' ? 'Hindsight Cloud' : 'your own Hindsight server'} at <span className="mm-code">{status.apiUrl}</span>. Change it on the Provider tab.
            </p>
          )}
          {status.banks.length > 0 && (
            <div>
              <p className="mm-note">{status.stale ? 'Banks Hindsight listed the last time it answered:' : 'Banks:'}</p>
              <ul className="mm-banks" aria-label="Known banks">
                {status.banks.map((known) => (
                  <li key={known.id}>
                    {bankLabel(known)} <span className="subtle">{known.facts} {known.facts === 1 ? 'fact' : 'facts'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mm-actions">
            <button type="button" className="btn btn--secondary" onClick={() => void view.reload()}>
              <Icon name="refresh" />
              Try again
            </button>
            <AppLink className="btn btn--secondary" to="/agents/memory">
              Provider settings
            </AppLink>
          </div>
        </div>
      )}
      {status?.state === 'connected' && (
        <>
          <p className="mm-stats" role="status">
            <span>{status.mode === 'cloud' ? 'Hindsight Cloud' : 'Own server'}</span>
            {status.version && <span>version {status.version}</span>}
            <span>{status.banks.length} {status.banks.length === 1 ? 'bank' : 'banks'}</span>
          </p>
          {status.banks.length === 0 && (
            <div className="empty">
              <span className="empty__icon">
                <Icon name="database" />
              </span>
              <p>Hindsight is connected, and has no bank yet. A bank appears when the agent first saves a memory.</p>
            </div>
          )}
          {bank && (
            <>
              <div className="mm-bar">
                <div className="field mm-bank">
                  <label className="field__label" htmlFor={bankId}>
                    Bank
                  </label>
                  <select id={bankId} className="input" value={bank} onChange={(event) => setChosen(event.target.value)}>
                    {!status.banks.some((known) => known.id === bank) && <option value={bank}>{bank} (not created yet)</option>}
                    {status.banks.map((known) => (
                      <option key={known.id} value={known.id}>
                        {bankLabel(known)}
                      </option>
                    ))}
                  </select>
                </div>
                <WriteButton type="button" className="btn btn--primary" disabled={readOnly} onClick={() => setAdding(true)}>
                  <Icon name="plus" small />
                  Add a memory…
                </WriteButton>
              </div>
              <span className="field__label" id={viewLabel}>
                Show
              </span>
              <RadioGroup labelledBy={viewLabel} value={mode} options={VIEWS} onChange={setMode} className="seg mm-views" />
              {mode === 'ask' ? <HindsightAsk key={`${profile}:${bank}`} profile={profile} bank={bank} /> : <HindsightBrowse key={`${profile}:${bank}:${mode}:${added}`} profile={profile} bank={bank} kind={mode} />}
              {adding && <AddMemorySheet profile={profile} bank={bank} onClose={() => setAdding(false)} onAdded={() => setAdded((count) => count + 1)} />}
            </>
          )}
        </>
      )}
    </div>
  );
}
