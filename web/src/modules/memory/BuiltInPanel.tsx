import { useState, type CSSProperties } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { resetMemory } from '../profiles/behaviour-actions.ts';
import { fileRef, memoryMeter, type ResetTarget } from '../profiles/behaviour-files.ts';
import { useFileRead, useMemoryUse } from '../profiles/behaviour-data.ts';
import { useProfiles } from '../profiles/profiles-data.ts';
import './memory.css';

const FILES = [
  { id: 'memory', label: 'MEMORY.md', blurb: 'What the agent has learned and chooses to remember.' },
  { id: 'user', label: 'USER.md', blurb: 'What the agent knows about you.' },
] as const;

const RESETS: { target: ResetTarget; label: string }[] = [
  { target: 'memory', label: 'Reset MEMORY.md…' },
  { target: 'user', label: 'Reset USER.md…' },
  { target: 'all', label: 'Reset both…' },
];

/** One built-in file's size against Hermes's limit, from the file's own text. */
function FileUse({ profile, path, file, limit, bytes }: { profile: string; path: string; file: (typeof FILES)[number]; limit: number | undefined; bytes: number | undefined }) {
  const { result } = useFileRead(fileRef(file.id, profile, path));
  const text = result?.state === 'ready' ? result.text : undefined;
  const meter = text !== undefined && limit !== undefined ? memoryMeter(text, limit) : undefined;
  return (
    <section className="mm-box" aria-label={file.label}>
      <h3>{file.label}</h3>
      <p className="mm-note">{file.blurb}</p>
      {meter ? (
        <div className="mm-meter">
          <div className="progress" data-tone={meter.over ? 'danger' : meter.percent >= 90 ? 'warning' : 'success'} role="img" aria-label={`${meter.used} of ${meter.limit} characters`}>
            <i style={{ '--p': `${meter.percent}%` } as CSSProperties} />
          </div>
          <p className="field__help">
            {meter.used.toLocaleString()} of {meter.limit.toLocaleString()} characters{meter.over ? ': over the limit, so Hermes will not let the agent add more until it is shorter' : ''}.{bytes !== undefined ? ` On disk Hermes holds ${bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`}.` : ''}
          </p>
        </div>
      ) : (
        <p role="status" className="mm-note">
          {result && result.state !== 'ready' ? 'Hermes did not give the file’s text, so its size is not known.' : 'Reading the size…'}
        </p>
      )}
    </section>
  );
}

/** The built-in memory of the profile: how full MEMORY.md and USER.md are, the reset, and the way to the editors. */
export function BuiltInPanel({ profile }: { profile: string }) {
  const profiles = useProfiles();
  const { use, reload } = useMemoryUse(profile);
  const [epoch, setEpoch] = useState(0);
  const card = profiles.cards?.find((candidate) => candidate.name === profile);

  const reset = async (target: ResetTarget) => {
    const outcome = await resetMemory(profile, target);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast('Memory reset', { tone: 'success', detail: 'The text is in History if you want it back.' });
    setEpoch((count) => count + 1);
    await reload();
  };

  return (
    <div className="mm-panel">
      <p className="help-text">
        What <strong>{profile}</strong> remembers without a provider: <Term id="memory-md">MEMORY.md</Term> and <Term id="user-md">USER.md</Term>. Hermes limits the size of each. They are edited in the profile’s Memory tab; Reset deletes the file in Hermes, and Caduceus keeps the text as a <Term id="snapshot">snapshot</Term>.
      </p>
      {profiles.failed && !card && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so the profile’s files could not be found.</span>
        </div>
      )}
      {!card && !profiles.failed && <p role="status">Loading the memory files…</p>}
      {card && (
        <div className="mm-files">
          {FILES.map((file) => (
            <FileUse key={`${file.id}-${epoch}`} profile={profile} path={card.path} file={file} limit={use?.[file.id].limit} bytes={use?.[file.id].bytes} />
          ))}
        </div>
      )}
      <div className="mm-actions">
        <AppLink className="btn btn--secondary" to={`/agents/profiles/${encodeURIComponent(profile)}/memory`}>
          <Icon name="file" />
          Open the editors
        </AppLink>
      </div>
      <section className="mm-box" aria-labelledby="mm-reset-title">
        <h3 id="mm-reset-title">Reset memory</h3>
        <p className="mm-note">Deletes the file or files in Hermes. You type this profile’s name to confirm, and the text stays in History.</p>
        <div className="mm-actions">
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
