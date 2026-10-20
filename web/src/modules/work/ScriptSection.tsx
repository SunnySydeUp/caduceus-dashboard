// A Script job's script on its detail page (M3 #12): read-only on a phone, an editor on larger screens. Saving is the guarded route, a T3 that asks for the
// owner's passkey and the script's name. The code is read from Hermes each time; Caduceus keeps nothing of it.
import { useEffect, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { loadScriptText, useBuilderData } from './builder-data.ts';
import { CodeBox } from './ScriptFields.tsx';
import { saveJob } from './schedules-actions.ts';
import type { Job } from './schedules-model.ts';

type Loaded = { phase: 'loading' } | { phase: 'failed' } | { phase: 'missing' } | { phase: 'ready'; text: string };

export function ScriptSection({ job }: { job: Job }) {
  const compact = useSizeClass() === 'compact';
  const { homes } = useBuilderData();
  const file = (typeof job.config.script === 'string' ? job.config.script : '').split('/').pop() ?? '';
  const home = typeof job.config.hermes_home === 'string' && job.config.hermes_home !== '' ? job.config.hermes_home : homes[job.profile];
  const [loaded, setLoaded] = useState<Loaded>({ phase: 'loading' });
  const [draft, setDraft] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!home || file === '') return;
    let current = true;
    setLoaded({ phase: 'loading' });
    loadScriptText(home, file).then(
      (text) => current && (setLoaded(text === undefined ? { phase: 'missing' } : { phase: 'ready', text }), setDraft(undefined)),
      () => current && setLoaded({ phase: 'failed' }),
    );
    return () => void (current = false);
  }, [home, file, version]);
  if (file === '') return null;

  const text = loaded.phase === 'ready' ? loaded.text : '';
  const shown = draft ?? text;
  const save = async () => {
    setSaving(true);
    try {
      const outcome = await saveJob(
        { scriptSaves: [{ name: file, request: { method: 'PUT', path: '/_caduceus/api/work/scripts', body: { profile: job.profile, name: file, content: shown } } }] },
        { name: job.name, profile: job.profile, change: 'edit', script: file },
      );
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind === 'done') {
        toast(`Saved ${file}`, { tone: 'success' });
        setVersion((n) => n + 1);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="jd__def" aria-labelledby="jd-script">
      <h2 id="jd-script">Script</h2>
      <p className="subtle mono">{file}</p>
      {loaded.phase === 'loading' && <p role="status">Reading the script…</p>}
      {loaded.phase === 'failed' && <p role="alert" className="error-text">Hermes did not give the script.</p>}
      {loaded.phase === 'missing' && <p className="subtle">Hermes has no file called {file} in this profile’s scripts folder, so the job fails each time it runs. Write it here.</p>}
      {(loaded.phase === 'ready' || loaded.phase === 'missing') && (
        <>
          <CodeBox id="jd-script-code" label={compact ? `${file}, read only` : `Code of ${file}`} value={shown} readOnly={compact} onChange={setDraft} />
          {compact ? (
            <p className="subtle">Open this page on a larger screen to edit the script.</p>
          ) : (
            <div className="td-actions">
              <WriteButton type="button" className="btn btn--primary" disabled={saving || draft === undefined || draft === text} aria-busy={saving || undefined} onClick={() => void save()}>
                <Icon name="check" />
                Save script
              </WriteButton>
              {draft !== undefined && draft !== text && (
                <button type="button" className="btn btn--ghost" onClick={() => setDraft(undefined)}>
                  Discard changes
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
