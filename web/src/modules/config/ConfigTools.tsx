// The toolbar of System › Config, on the form and on the YAML: export the config as a file, import one (staged: read, checked and shown as
// a diff, written only when applied), put a section or everything back to Hermes's defaults, and run Hermes's config migrate. Every write is
// the same Tier 3 raw save (`saveRawConfig`), except migrate (Tier 1).
import { useId, useRef, useState, type ChangeEvent } from 'react';
import YAML from 'yaml';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useReadOnly } from '../../policy-state.ts';
import { AppLink } from '../../shell/navigation.tsx';
import { toast } from '../../shell/toasts.ts';
import { Term } from '../../shell/Term.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { migrateConfig, saveRawConfig, type MigrateRun } from './config-actions.ts';
import { readRawConfig } from './config-data.ts';
import type { ConfigForm } from './config-model.ts';
import { changeRows, checkConfigYaml, exportFile, readCurrentConfig, resetConfig, type ChangeRow, type CheckedConfigYaml } from './config-yaml.ts';
import { ChangeReview, ProblemList } from './ConfigReview.tsx';

/** A file bigger than this is not a config: it is refused before it is read. */
const IMPORT_MAX_BYTES = 1024 * 1024;

const READ_ONLY_REASON = 'Read-only mode is on, so nothing can be saved.';

/** Switches between the form and the YAML of the same config. */
export function ConfigViews({ current }: { current: 'form' | 'yaml' }) {
  return (
    <nav className="cf-views" aria-label="Config views">
      <ul>
        <li>
          <AppLink to="/system/config" aria-current={current === 'form' ? 'page' : undefined}>
            <Icon name="sliders" small />
            <span>Form</span>
          </AppLink>
        </li>
        <li>
          <AppLink to="/system/config/yaml" aria-current={current === 'yaml' ? 'page' : undefined}>
            <Icon name="code" small />
            <span>YAML</span>
          </AppLink>
        </li>
      </ul>
    </nav>
  );
}

interface StagedImport {
  name: string;
  text: string;
  checked: CheckedConfigYaml;
  rows: ChangeRow[];
}

interface Resetting {
  current: Record<string, unknown>;
}

const restartKeys = (rows: readonly ChangeRow[]) => rows.filter((row) => row.restartRequired).map((row) => row.key);

export function ConfigTools({ profile, form, onChanged }: { profile: string; form: ConfigForm | undefined; onChanged(): Promise<void> | void }) {
  const readOnly = useReadOnly();
  const fileId = useId();
  const scopeId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | 'reset' | 'migrate' | 'apply'>();
  const [staged, setStaged] = useState<StagedImport>();
  const [resetting, setResetting] = useState<Resetting>();
  const [scope, setScope] = useState('all');
  const [migrated, setMigrated] = useState<MigrateRun>();

  const needForm = () => {
    if (form) return form;
    toast('The settings are still loading. Try again in a moment.', { tone: 'danger' });
    return undefined;
  };

  const exportConfig = async () => {
    setBusy('export');
    try {
      const raw = await readRawConfig(profile);
      const file = exportFile(profile, raw.yaml, new Date());
      const url = URL.createObjectURL(new Blob([file.text], { type: 'text/yaml' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(url);
      toast(`Exported ${file.name}`, { detail: 'Credentials are not in the file: a set one is written as a mask.' });
    } catch {
      toast('Could not export: Hermes did not answer.', { tone: 'danger' });
    } finally {
      setBusy(undefined);
    }
  };

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const known = needForm();
    if (!file || !known) return;
    if (file.size > IMPORT_MAX_BYTES) {
      toast(`${file.name} is too big to be a config (over 1 MB).`, { tone: 'danger' });
      return;
    }
    setBusy('import');
    try {
      const [text, raw] = await Promise.all([file.text(), readRawConfig(profile)]);
      const current = readCurrentConfig(raw.yaml);
      const checked = checkConfigYaml(text, { form: known, current });
      setStaged({ name: file.name, text, checked, rows: checked.value ? changeRows(known, current, checked.value) : [] });
    } catch {
      toast('Could not read the file or Hermes’s config.', { tone: 'danger' });
    } finally {
      setBusy(undefined);
    }
  };

  const applyImport = async () => {
    if (!staged || busy) return;
    setBusy('apply');
    try {
      const outcome = await saveRawConfig(profile, staged.text, { title: `Apply the import to ${profile}?`, text: `${staged.rows.length} ${staged.rows.length === 1 ? 'setting changes' : 'settings change'} (${staged.name}).`, confirmLabel: 'Apply import' }, restartKeys(staged.rows));
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind !== 'done') return;
      setStaged(undefined);
      toast(`Applied ${staged.name} to ${profile}`, { detail: outcome.body.restart.length > 0 ? 'A gateway restart applies some of it. The notice at the top offers it.' : 'Hermes uses it from now on.' });
      await onChanged();
    } finally {
      setBusy(undefined);
    }
  };

  const openReset = async () => {
    if (!needForm()) return;
    setBusy('reset');
    try {
      setScope('all');
      setResetting({ current: readCurrentConfig((await readRawConfig(profile)).yaml) });
    } catch {
      toast('Could not read Hermes’s config.', { tone: 'danger' });
    } finally {
      setBusy(undefined);
    }
  };

  const reset = form && resetting ? resetConfig(form, resetting.current, scope === 'all' ? 'all' : { section: scope }) : undefined;
  const resetRows = form && resetting && reset ? changeRows(form, resetting.current, reset.value) : [];
  const applyReset = async () => {
    if (!reset || !resetting || busy) return;
    setBusy('apply');
    try {
      const what = scope === 'all' ? 'the whole config' : `the ${form?.sections.find((section) => section.id === scope)?.title ?? scope} settings`;
      const outcome = await saveRawConfig(profile, YAML.stringify(reset.value), { title: `Reset ${what} of ${profile}?`, text: `${reset.keys.length} ${reset.keys.length === 1 ? 'setting goes' : 'settings go'} back to Hermes’s default. Credentials are kept.`, confirmLabel: 'Reset to defaults' }, restartKeys(resetRows));
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind !== 'done') return;
      setResetting(undefined);
      toast(`Reset ${what} of ${profile}`, { detail: 'Hermes uses the defaults from now on.' });
      await onChanged();
    } finally {
      setBusy(undefined);
    }
  };

  const migrate = async () => {
    if (busy) return;
    setBusy('migrate');
    try {
      const outcome = await migrateConfig(profile);
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind !== 'done') return;
      setMigrated(outcome.body);
      await onChanged();
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <div className="cf-toolbar" role="group" aria-label="Config tools">
        <button type="button" className="btn btn--secondary btn--sm" disabled={busy !== undefined} aria-busy={busy === 'export'} onClick={() => void exportConfig()}>
          <Icon name="download" small />
          Export
        </button>
        <input id={fileId} ref={picker} className="sr-only" type="file" accept=".yaml,.yml,text/yaml,text/plain" tabIndex={-1} aria-label="Config file to import" onChange={(event) => void pick(event)} />
        <button type="button" className="btn btn--secondary btn--sm" disabled={busy !== undefined} aria-busy={busy === 'import'} onClick={() => picker.current?.click()}>
          <Icon name="file" small />
          Import…
        </button>
        <button type="button" className="btn btn--secondary btn--sm" disabled={busy !== undefined} aria-haspopup="dialog" aria-busy={busy === 'reset'} onClick={() => void openReset()}>
          <Icon name="refresh" small />
          Reset…
        </button>
        <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy !== undefined || readOnly} title={readOnly ? READ_ONLY_REASON : undefined} aria-busy={busy === 'migrate'} onClick={() => void migrate()}>
          <Icon name="tool" small />
          {busy === 'migrate' ? 'Migrating…' : 'Migrate'}
        </WriteButton>
      </div>

      {staged && (
        <Sheet
          title="Review import"
          detents={['half', 'full']}
          onClose={() => setStaged(undefined)}
          footer={
            <div className="row">
              <button type="button" className="btn btn--secondary" onClick={() => setStaged(undefined)}>
                Cancel
              </button>
              <WriteButton type="button" className="btn btn--primary" disabled={busy !== undefined || readOnly || staged.checked.problems.length > 0 || staged.rows.length === 0} title={readOnly ? READ_ONLY_REASON : undefined} onClick={() => void applyImport()}>
                <Icon name="lock" small />
                Apply import…
              </WriteButton>
            </div>
          }
        >
          <p className="cf-staged">
            <code>{staged.name}</code> has been read and checked: this is a <Term id="staged-import">staged import</Term>. Nothing is written until you apply it.
          </p>
          {staged.checked.problems.length > 0 ? (
            <>
              <p role="alert">
                <strong>The file cannot be applied.</strong> Fix these lines in the file and import it again.
              </p>
              <ProblemList problems={staged.checked.problems} />
            </>
          ) : (
            <>
              <p className="help-text">Applying replaces the whole config of {profile}: a setting that is not in the file goes back to Hermes’s default. A credential written as a mask keeps the one the profile has.</p>
              <ChangeReview rows={staged.rows} />
            </>
          )}
        </Sheet>
      )}

      {resetting && form && (
        <Sheet
          title="Reset to defaults"
          detents={['half', 'full']}
          onClose={() => setResetting(undefined)}
          footer={
            <div className="row">
              <button type="button" className="btn btn--secondary" onClick={() => setResetting(undefined)}>
                Cancel
              </button>
              <WriteButton type="button" className="btn btn--primary" disabled={busy !== undefined || readOnly || resetRows.length === 0} title={readOnly ? READ_ONLY_REASON : undefined} onClick={() => void applyReset()}>
                <Icon name="lock" small />
                Reset…
              </WriteButton>
            </div>
          }
        >
          <div className="field">
            <label className="field__label" htmlFor={scopeId}>
              What to reset
            </label>
            <select id={scopeId} className="input" value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="all">The whole config</option>
              {form.sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.title} section
                </option>
              ))}
            </select>
          </div>
          <p className="help-text">The settings the profile has set go back to Hermes’s default. A credential, such as an API key, is never reset.</p>
          {resetRows.length === 0 ? <p role="status">Nothing in {scope === 'all' ? 'this profile’s config' : 'this section'} differs from the defaults.</p> : <ChangeReview rows={resetRows} />}
        </Sheet>
      )}

      {migrated && (
        <Sheet
          title="Config migrate"
          detents={['half', 'full']}
          onClose={() => setMigrated(undefined)}
          footer={
            <button type="button" className="btn btn--primary" onClick={() => setMigrated(undefined)}>
              Close
            </button>
          }
        >
          <p role="status">
            <Term id="config-migrate">Config migrate</Term>:{' '}
            {migrated.exitCode === 0 ? 'Hermes finished. The settings have been read again.' : migrated.exitCode === null ? 'Hermes finished without saying how it ended.' : `Hermes stopped with exit code ${migrated.exitCode}.`}
          </p>
          <pre className="cf-output" tabIndex={0} aria-label="What Hermes printed">
            {migrated.lines.length > 0 ? migrated.lines.join('\n') : 'Hermes printed nothing.'}
          </pre>
        </Sheet>
      )}
    </>
  );
}
