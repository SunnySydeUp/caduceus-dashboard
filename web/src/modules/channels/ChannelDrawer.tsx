import { useId, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../../icons.tsx';
import { Layer } from '../../overlays/Layer.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { saveBehaviour, saveChannel, testChannel } from './channel-actions.ts';
import { useBehaviourSource } from './channels-data.ts';
import { behaviourSections, changedBehaviour, channelStatus, validateChannelForm, type BehaviourValue, type Channel } from './channels-model.ts';
import { BehaviourForm, ConnectionForm, type ConnectionDraft } from './ChannelForms.tsx';

export type DrawerTab = 'connection' | 'behaviour';

const TABS = [
  { value: 'connection', label: 'Connection' },
  { value: 'behaviour', label: 'Behaviour' },
] as const satisfies readonly { value: DrawerTab; label: string }[];

/** The configure panel of a channel: a full-height sheet with a sticky Save on a phone, a drawer from the end on larger windows. */
export function ChannelDrawer({ channel, profile, tab, onTab, onClose, reload }: { channel: Channel; profile: string; tab: DrawerTab; onTab(tab: DrawerTab): void; onClose(): void; reload(): Promise<void> }) {
  const compact = useSizeClass() === 'compact';
  const tabsLabel = useId();
  const connectionForm = useId();
  const behaviourForm = useId();
  const status = channelStatus(channel);

  const [draft, setDraft] = useState<ConnectionDraft>({ values: {}, clear: new Set(), enabled: channel.enabled });
  /** Problems are shown from the first Save on, and then follow what is typed. */
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string }>();

  const source = useBehaviourSource(profile, tab === 'behaviour');
  const sections = useMemo(() => behaviourSections(source.schema, source.config, channel.id), [source.schema, source.config, channel.id]);
  const fields = useMemo(() => sections.flatMap((section) => section.fields), [sections]);
  const [behaviourDraft, setBehaviourDraft] = useState<Record<string, BehaviourValue>>({});
  const changes = changedBehaviour(fields, behaviourDraft);
  const changedCount = Object.keys(changes).length;

  const clear = [...draft.clear];
  const problems = attempted ? validateChannelForm(channel, draft.values, { clear }) : {};
  const dirty = Object.values(draft.values).some((value) => value.trim() !== '') || clear.length > 0 || draft.enabled !== channel.enabled;

  const save = async () => {
    setAttempted(true);
    if (Object.keys(validateChannelForm(channel, draft.values, { clear })).length > 0) {
      // The fields show their problems on the next render; the first one takes focus once they do.
      requestAnimationFrame(() => document.getElementById(connectionForm)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setBusy(true);
    const outcome = await saveChannel(channel, profile, { values: draft.values, clear, ...(draft.enabled === channel.enabled ? {} : { enabled: draft.enabled }) });
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`${channel.name} saved for ${profile}`, { detail: outcome.body.needsRestart ? 'It applies when the gateway restarts.' : 'Hermes applied it at once.' });
    await reload();
    onClose();
  };

  const test = async () => {
    setTesting(true);
    const outcome = await testChannel(channel, profile);
    setTesting(false);
    if (outcome.kind === 'failed') setTestResult({ ok: false, message: outcome.message });
    else if (outcome.kind === 'done') setTestResult(outcome.body);
  };

  const saveSettings = async () => {
    setBusy(true);
    const outcome = await saveBehaviour(channel, profile, fields, changes);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`${channel.name} settings saved for ${profile}`, { detail: 'They apply when the gateway restarts.' });
    setBehaviourDraft({});
    await source.reload();
  };

  let body: ReactNode;
  let footer: ReactNode;
  if (tab === 'connection') {
    body = (
      <>
        {testResult && (
          <div className="banner" data-tone={testResult.ok ? 'success' : 'warning'} role="status">
            <Icon name={testResult.ok ? 'check' : 'alert'} />
            <span className="banner__content">
              <span className="banner__title">{testResult.ok ? 'Test passed' : 'Test did not pass'}</span>
              <span className="banner__body"> {testResult.message}</span>
            </span>
          </div>
        )}
        <ConnectionForm channel={channel} draft={draft} problems={problems} onChange={(next) => setDraft(next)} formId={connectionForm} onSubmit={() => void save()} />
      </>
    );
    footer = (
      <>
        <button type="button" className="btn btn--secondary" disabled={testing || busy} aria-busy={testing} onClick={() => void test()}>
          <Icon name="play" />
          Test
        </button>
        <WriteButton type="submit" form={connectionForm} className="btn btn--primary" disabled={busy || (!dirty && channel.configured)} aria-busy={busy}>
          <Icon name="lock" />
          Save…
        </WriteButton>
      </>
    );
  } else {
    body = source.failed && sections.length === 0 ? (
      <div className="banner" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">Hermes did not give its config, so these settings cannot be shown.</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void source.reload()}>
          <Icon name="refresh" />
          Retry
        </button>
      </div>
    ) : source.schema === undefined ? (
      <p role="status">Loading the settings…</p>
    ) : sections.length === 0 ? (
      <p className="subtle">Hermes’s config has no behaviour settings for {channel.name}.</p>
    ) : (
      <>
        <p className="help-text">These settings are kept in this profile’s config.yaml, not in its .env. Each control is the type Hermes’s config schema gives its key.</p>
        <BehaviourForm sections={sections} draft={behaviourDraft} onChange={(key, value) => setBehaviourDraft((current) => ({ ...current, [key]: value }))} formId={behaviourForm} onSubmit={() => void saveSettings()} />
      </>
    );
    footer = (
      <WriteButton type="submit" form={behaviourForm} className="btn btn--primary" disabled={busy || changedCount === 0} aria-busy={busy}>
        <Icon name="lock" />
        {changedCount > 0 ? `Save ${changedCount} ${changedCount === 1 ? 'setting' : 'settings'}…` : 'Save settings…'}
      </WriteButton>
    );
  }

  const content = (
    <>
      <div className="ch-drawer__head">
        <StatusBadge state={status.badge} label={status.label} variant="plain" />
        <RadioGroup labelledBy={tabsLabel} value={tab} options={TABS} onChange={onTab} className="seg" />
        <span id={tabsLabel} className="sr-only">
          {channel.name} sections
        </span>
      </div>
      {channel.description && <p className="help-text">{channel.description}</p>}
      {body}
    </>
  );

  if (compact) {
    return (
      <Sheet title={`${channel.name} · ${profile}`} detents={['full']} className="ch-sheet" footer={footer} onClose={onClose}>
        {content}
      </Sheet>
    );
  }
  return (
    <Layer kind="drawer" panelClassName="drawer drawer--end ch-drawer" label={`${channel.name} · ${profile}`} initialFocus="[data-close]" onClose={onClose}>
      <header className="overlay__head">
        <h2>
          {channel.name} <span className="subtle">· {profile}</span>
        </h2>
        <button type="button" className="btn btn--ghost btn--icon" aria-label={`Close ${channel.name}`} onClick={onClose} data-close>
          <Icon name="x" />
        </button>
      </header>
      <div className="overlay__body drawer__body" data-body>
        {content}
      </div>
      <footer className="overlay__foot ch-drawer__foot">{footer}</footer>
    </Layer>
  );
}
