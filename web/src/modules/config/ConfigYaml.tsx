// System › Config › YAML: Hermes's raw config file as an editor. It is checked as it is typed (syntax, then Hermes's schema, each problem
// with its line); the save shows what changes and is Tier 3, like every raw write. A set credential is the mask in the text, and the
// server puts the real one back, so none is ever on this page. On a phone the text is read-only, with a link to carry on elsewhere.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useReadOnly } from '../../policy-state.ts';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { saveRawConfig } from './config-actions.ts';
import { useConfigForm, useRawConfig } from './config-data.ts';
import { changeRows, checkConfigYaml, readCurrentConfig, type YamlProblem } from './config-yaml.ts';
import { ChangeReview, ProblemList } from './ConfigReview.tsx';
import { ConfigTools, ConfigViews } from './ConfigTools.tsx';
import './config.css';

/** Puts the caret at the start of a line of the text and shows it: the way a problem is pointed to. */
function goToLine(area: HTMLTextAreaElement, line: number): void {
  let offset = 0;
  const lines = area.value.split('\n');
  for (let index = 0; index < Math.min(line - 1, lines.length); index++) offset += lines[index]!.length + 1;
  const end = offset + (lines[line - 1]?.length ?? 0);
  area.focus();
  area.setSelectionRange(offset, end);
  // A textarea does not scroll to a selection by itself: its line height says how far down the line is.
  const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 20;
  area.scrollTop = Math.max(0, (line - 3) * lineHeight);
}

export function ConfigYaml() {
  const { effective } = useProfileScope();
  const profile = effective?.name ?? 'default';
  const compact = useSizeClass() === 'compact';
  const readOnly = useReadOnly();
  const editorId = useId();
  const area = useRef<HTMLTextAreaElement>(null);

  const { form, failed: formFailed, reload: reloadForm } = useConfigForm(profile);
  const { raw, failed, reload: reloadRaw } = useRawConfig(profile);
  const [text, setText] = useState<string>();
  const [loaded, setLoaded] = useState<string>();
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = text !== undefined && loaded !== undefined && text !== loaded;
  // A newer file from Hermes replaces the text only when nothing is being edited; otherwise it waits behind a notice.
  const changedUnderneath = dirty && raw !== undefined && raw.yaml !== loaded;
  useEffect(() => {
    if (raw === undefined) {
      setText(undefined);
      setLoaded(undefined);
      return;
    }
    if (!dirty) {
      setText(raw.yaml);
      setLoaded(raw.yaml);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `dirty` is read when Hermes answers, not each time it changes
  }, [raw]);

  // It asks only when the path changes: the Save… confirmation is a layer on the history, and closing it is not leaving the page.
  const blocker = useBlocker({ shouldBlockFn: ({ current, next }) => dirty && current.pathname !== next.pathname, enableBeforeUnload: () => dirty, withResolver: true });

  const current = useMemo(() => readCurrentConfig(loaded ?? ''), [loaded]);
  const checked = useMemo(() => (form && text !== undefined ? checkConfigYaml(text, { form, current }) : undefined), [form, text, current]);
  const rows = useMemo(() => (form && checked?.value ? changeRows(form, current, checked.value) : []), [form, checked, current]);
  const problems = checked?.problems ?? [];

  const refresh = async () => {
    await Promise.all([reloadRaw(), reloadForm()]);
  };
  const reasonNotToSave = readOnly ? 'Read-only mode is on, so nothing can be saved.' : problems.length > 0 ? 'Fix the problems first.' : !dirty ? 'Nothing has changed.' : undefined;

  const save = async () => {
    if (text === undefined || saving || reasonNotToSave) return;
    setSaving(true);
    try {
      const outcome = await saveRawConfig(profile, text, { title: `Save the YAML of ${profile}?`, text: `${rows.length} ${rows.length === 1 ? 'setting changes' : 'settings change'}.`, confirmLabel: 'Save YAML' }, rows.filter((row) => row.restartRequired).map((row) => row.key));
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind !== 'done') return;
      setReviewing(false);
      // What Hermes now holds replaces the text, so the editor shows the file as it is (a credential is the mask again).
      setLoaded(undefined);
      toast(`Saved the YAML of ${profile}`, { detail: outcome.body.restart.length > 0 ? 'A gateway restart applies some of it. The notice at the top offers it.' : 'Hermes uses it from now on.' });
      setText(undefined);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const handoff = `${location.origin}/system/config/yaml?${new URLSearchParams({ profile })}`;
  const copyHandoff = async () => {
    try {
      await navigator.clipboard.writeText(handoff);
      toast('Copied the link. Open it on a larger screen to edit the YAML.');
    } catch {
      toast('Could not copy. Select the address of the page instead.', { tone: 'danger' });
    }
  };
  const goTo = (problem: YamlProblem) => {
    if (area.current) goToLine(area.current, problem.line);
  };

  return (
    <div className="cf">
      <PageHeader overline="System" title="Config" subtitle={`YAML · profile ${profile}`} />
      <ConfigViews current="yaml" />
      <ConfigTools profile={profile} form={form} onChanged={refresh} />
      <p className="help-text">
        The <Term id="raw-yaml">raw YAML</Term> of this profile’s config file, as Hermes keeps it. A credential is shown as <code>********</code> and keeps its value when you save. Saving is a Tier 3 action, and Hermes replaces the whole file.
      </p>

      {blocker.status === 'blocked' && (
        <div className="banner cf-leave" data-tone="warning" role="alertdialog" aria-labelledby="cf-yaml-leave">
          <Icon name="alert" />
          <div className="banner__content">
            <strong id="cf-yaml-leave">Leave without saving?</strong>
            <p>The YAML has changes that are not saved.</p>
          </div>
          <div className="row">
            <button type="button" className="btn btn--primary btn--sm" autoFocus onClick={() => blocker.reset()}>
              Stay and keep editing
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => blocker.proceed()}>
              Leave and discard
            </button>
          </div>
        </div>
      )}

      {compact && (
        <div className="banner cf-handoff" data-tone="info" role="note">
          <Icon name="monitor" />
          <div className="banner__content">
            <strong>The YAML is read-only on a phone</strong>
            <p>Editing needs a larger screen. You can still read it, export the config and run the tools above.</p>
            <div className="row">
              <a className="btn btn--secondary btn--sm" href={handoff}>
                Continue on a larger screen
              </a>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copyHandoff()}>
                <Icon name="copy" small />
                Copy link
              </button>
            </div>
          </div>
        </div>
      )}

      {(failed || formFailed) && text === undefined && (
        <div className="banner" data-tone="warning" role="alert">
          <Icon name="alert" />
          <div className="banner__content">
            <strong>Hermes did not answer</strong>
            <p>The config file comes from Hermes, which is not reachable right now.</p>
          </div>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      )}
      {text === undefined && !failed && !formFailed && <p role="status">Reading Hermes’s config file…</p>}

      {changedUnderneath && (
        <div className="banner" data-tone="warning" role="status">
          <Icon name="alert" />
          <div className="banner__content">
            <strong>Hermes’s file has changed since you opened it</strong>
            <p>Saving replaces it with your text. To see the new file, discard your edits.</p>
          </div>
        </div>
      )}

      {text !== undefined && (
        <>
          <div className="field cf-yaml">
            <label className="field__label" htmlFor={editorId}>
              config.yaml
              {raw?.path && <code className="cf-yaml__path"> {raw.path}</code>}
            </label>
            <textarea
              ref={area}
              id={editorId}
              className="input input--mono cf-yaml__editor"
              value={text}
              readOnly={compact}
              aria-readonly={compact}
              aria-invalid={problems.length > 0}
              aria-describedby={`${editorId}-status`}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              wrap="off"
              rows={compact ? 14 : 24}
              onChange={(event) => setText(event.target.value)}
            />
            <p id={`${editorId}-status`} className="cf-yaml__status" role="status">
              {!form ? 'Reading Hermes’s settings to check the text…' : problems.length === 0 ? (dirty ? `No problems. ${rows.length} ${rows.length === 1 ? 'setting' : 'settings'} would change.` : 'No problems.') : `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}. Saving is blocked until they are fixed.`}
            </p>
          </div>

          {problems.length > 0 && <ProblemList problems={problems} onGo={compact ? undefined : goTo} />}

          {!compact && (
            <div className="cf-savebar" role="region" aria-label="YAML actions">
              <p className="cf-savebar__msg">
                {dirty ? <strong>Unsaved changes</strong> : <span className="subtle">No changes</span>}
                {reasonNotToSave && dirty && <span className="subtle"> · {reasonNotToSave}</span>}
              </p>
              <div className="cf-savebar__acts">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={!dirty}
                  onClick={() => {
                    const discarded = text;
                    setText(raw?.yaml);
                    toast('Discarded the YAML edits', { undo: () => setText(discarded) });
                  }}
                >
                  Discard
                </button>
                <WriteButton type="button" className="btn btn--primary btn--sm" disabled={saving || reasonNotToSave !== undefined} title={reasonNotToSave} aria-haspopup="dialog" aria-busy={saving} onClick={() => setReviewing(true)}>
                  <Icon name="lock" small />
                  Review and save…
                </WriteButton>
              </div>
            </div>
          )}
        </>
      )}

      {reviewing && (
        <Sheet
          title="Review changes"
          detents={['half', 'full']}
          onClose={() => setReviewing(false)}
          footer={
            <div className="row">
              <button type="button" className="btn btn--secondary" onClick={() => setReviewing(false)}>
                Keep editing
              </button>
              <WriteButton type="button" className="btn btn--primary" disabled={saving || reasonNotToSave !== undefined} title={reasonNotToSave} onClick={() => void save()}>
                <Icon name="lock" small />
                Save…
              </WriteButton>
            </div>
          }
        >
          <ChangeReview rows={rows} />
        </Sheet>
      )}
    </div>
  );
}
