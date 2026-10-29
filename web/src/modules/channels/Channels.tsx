import { useId, useMemo, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { PopoverMenu } from '../../shell/PopoverMenu.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { setChannelEnabled, testChannel } from './channel-actions.ts';
import { useChannels } from './channels-data.ts';
import { channelStatus, enableBlocker, filterChannels, groupChannels, type Channel, type ChannelFilter } from './channels-model.ts';
import { ChannelDrawer, type DrawerTab } from './ChannelDrawer.tsx';
import { startOnboarding } from './onboarding-actions.ts';
import { QrOnboardingSheet } from './QrOnboardingSheet.tsx';
import type { OnboardingState, QrPlatform } from './qr-onboarding.ts';
import './channels.css';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'In use' },
  { value: 'inactive', label: 'Not in use' },
] as const satisfies readonly { value: ChannelFilter; label: string }[];

interface TestOutcome {
  ok: boolean;
  message: string;
}

function ChannelCard({ channel, profile, test, busy, onConfigure, onToggle, onTest, onQr }: { channel: Channel; profile: string; test: TestOutcome | undefined; busy: boolean; onConfigure(tab: DrawerTab): void; onToggle(): void; onTest(): void; onQr?(): void }) {
  const status = channelStatus(channel);
  const switchLabel = useId();
  const whyId = useId();
  const why = enableBlocker(channel);
  return (
    <li className="ch-card" data-state={channel.state}>
      <div className="ch-card__top">
        <Sigil name={channel.name} size="md" />
        <div className="ch-card__id">
          <h2 className="ch-card__name">{channel.name}</h2>
          <StatusBadge state={status.badge} label={status.label} variant="plain" />
        </div>
        <div className="ch-card__switch">
          <span id={switchLabel} className="sr-only">
            {channel.name}
          </span>
          <WriteButton type="button" role="switch" className="switch" aria-checked={channel.enabled} aria-labelledby={switchLabel} aria-describedby={why ? whyId : undefined} disabled={busy || why !== undefined} onClick={onToggle} />
        </div>
      </div>
      {why && (
        <p className="ch-card__why" id={whyId}>
          <Icon name="info" small />
          <span>{why}</span>
        </p>
      )}
      <p className="ch-card__desc" title={channel.description}>
        {channel.description}
      </p>
      {channel.error && (
        <p className="ch-card__error" role="note">
          <Icon name="alert" small />
          <span>{channel.error}</span>
        </p>
      )}
      {(channel.homeChannel || channel.ingressUrl) && (
        <ul className="ch-card__meta">
          {channel.homeChannel && (
            <li>
              <Icon name="home" small /> Home channel: {channel.homeChannel}
            </li>
          )}
          {channel.ingressUrl && (
            <li className="mono">
              <Icon name="link" small /> {channel.ingressUrl}
            </li>
          )}
        </ul>
      )}
      {test && (
        <p className="ch-card__test" data-ok={test.ok} role="status">
          <Icon name={test.ok ? 'check' : 'alert'} small />
          <span>
            <strong>{test.ok ? 'Test passed. ' : 'Test did not pass. '}</strong>
            {test.message}
          </span>
        </p>
      )}
      <div className="ch-card__actions">
        <button type="button" className={`btn ${status.setup ? 'btn--primary' : 'btn--secondary'}`} onClick={() => onConfigure('connection')} aria-label={`${status.setup ? 'Set up' : 'Edit'} ${channel.name}`}>
          <Icon name="sliders" />
          {status.setup ? 'Set up' : 'Edit'}
        </button>
        <PopoverMenu
          label={`More for ${channel.name}`}
          align="end"
          trigger={(props) => (
            <button {...props} className="btn btn--ghost btn--icon" aria-label={`More for ${channel.name}`}>
              <Icon name="more" />
            </button>
          )}
        >
          {({ close }) => (
            <>
              <button type="button" className="pop__item" disabled={busy} onClick={() => (close(true), onTest())}>
                <Icon name="play" />
                Test {channel.name}
              </button>
              {onQr && (
                <WriteButton type="button" className="pop__item" disabled={busy} onClick={() => (close(true), onQr())}>
                  <Icon name="camera" />
                  {channel.id === 'telegram' ? 'Create with QR' : 'Pair with QR'}
                </WriteButton>
              )}
              <button type="button" className="pop__item" aria-label={`${channel.name} behaviour settings for ${profile}`} onClick={() => (close(true), onConfigure('behaviour'))}>
                <Icon name="settings" />
                Behaviour settings
              </button>
            </>
          )}
        </PopoverMenu>
      </div>
    </li>
  );
}

/** Connect › Channels: every messaging platform Hermes supports, with its status, for the profile this tab is scoped to. */
export function Channels() {
  const { effective } = useProfileScope();
  const profile = effective?.name;
  const view = useChannels(profile);
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<ChannelFilter>('all');
  const [open, setOpen] = useState<{ id: string; tab: DrawerTab }>();
  const [busy, setBusy] = useState<string>();
  const [tests, setTests] = useState<Record<string, TestOutcome>>({});
  const [pairing, setPairing] = useState<{ platform: QrPlatform; state: OnboardingState; run: number }>();
  const filterLabel = useId();

  const { channels } = view;
  const shown = useMemo(() => (channels ? filterChannels(channels, { query, show }) : undefined), [channels, query, show]);
  const groups = useMemo(() => groupChannels(shown ?? []), [shown]);
  const opened = channels?.find((channel) => channel.id === open?.id);
  const connected = channels?.filter((channel) => channel.state === 'connected').length ?? 0;
  const inUse = channels?.filter((channel) => channel.enabled && channel.configured).length ?? 0;

  const toggle = async (channel: Channel) => {
    if (!profile) return;
    setBusy(channel.id);
    const outcome = await setChannelEnabled(channel, profile, !channel.enabled);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`${channel.name} ${channel.enabled ? 'disabled' : 'enabled'} for ${profile}`, { detail: outcome.body.needsRestart ? 'It applies when the gateway restarts.' : 'Hermes applied it at once.' });
    await view.reload();
  };

  const pair = async (platform: QrPlatform) => {
    if (!profile) return;
    setBusy(platform);
    const outcome = await startOnboarding(platform, profile);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') setPairing((before) => ({ platform, state: outcome.body, run: (before?.run ?? 0) + 1 }));
  };

  const test = async (channel: Channel) => {
    if (!profile) return;
    setBusy(channel.id);
    const outcome = await testChannel(channel, profile);
    setBusy(undefined);
    if (outcome.kind === 'failed') setTests((current) => ({ ...current, [channel.id]: { ok: false, message: outcome.message } }));
    else if (outcome.kind === 'done') setTests((current) => ({ ...current, [channel.id]: outcome.body }));
  };

  return (
    <div className="ch">
      <PageHeader
        overline="Connect"
        title="Channels"
        subtitle={
          profile ? (
            <span className="ch-head__meta">
              <Sigil name={profile} size="xs" />
              <span>
                Channels of <strong>{profile}</strong>
              </span>
              {channels && (
                <span className="subtle">
                  {connected} connected · {inUse} in use · {channels.length} supported
                </span>
              )}
            </span>
          ) : undefined
        }
      />
      <p className="help-text">
        A <Term id="channel">channel</Term> is a chat <Term id="platform">platform</Term> that Hermes answers you on, such as Telegram or Slack. Each profile has its own. A change here applies when the profile’s <AppLink to="/connect/gateway">gateway</AppLink> restarts.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so its channels could not be listed{channels ? ': this is the list from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!channels && !view.failed && <Loading label="Loading channels…" lines={4} onRetry={() => void view.reload()} />}
      {channels && (
        <div className="ch-tools">
          <div className="input-wrap ch-search">
            <Icon name="search" />
            <input className="input" type="search" placeholder="Search channels" aria-label="Search channels" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <span id={filterLabel} className="sr-only">
            Show
          </span>
          <RadioGroup labelledBy={filterLabel} value={show} options={FILTERS} onChange={setShow} className="seg" />
        </div>
      )}
      {profile &&
        groups.map((group) => (
          <section key={group.id} className="ch-group" aria-labelledby={`ch-group-${group.id}`}>
            {groups.length > 1 && (
              <h2 id={`ch-group-${group.id}`} className="ch-group__title">
                {group.title}
              </h2>
            )}
            <ul className="ch-cards" aria-label={groups.length > 1 ? group.title : 'Channels'}>
              {group.channels.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  profile={profile}
                  test={tests[channel.id]}
                  busy={busy === channel.id}
                  onConfigure={(tab) => setOpen({ id: channel.id, tab })}
                  onToggle={() => void toggle(channel)}
                  onTest={() => void test(channel)}
                  onQr={channel.id === 'telegram' || channel.id === 'whatsapp' ? () => void pair(channel.id as QrPlatform) : undefined}
                />
              ))}
            </ul>
          </section>
        ))}
      {channels && shown && shown.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="plug" />
          </span>
          <p>{channels.length === 0 ? 'Hermes lists no messaging platforms.' : 'No channel matches.'}</p>
          {channels.length > 0 && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setQuery('');
                setShow('all');
              }}
            >
              Show every channel
            </button>
          )}
        </div>
      )}
      {profile && pairing && (
        <QrOnboardingSheet
          key={`${pairing.platform}:${pairing.run}`}
          platform={pairing.platform}
          profile={profile}
          initial={pairing.state}
          onRestart={() => void pair(pairing.platform)}
          onDone={() => {
            setPairing(undefined);
            void view.reload();
          }}
          onClose={() => setPairing(undefined)}
        />
      )}
      {profile && opened && open && (
        <ChannelDrawer key={`${profile}:${opened.id}`} channel={opened} profile={profile} tab={open.tab} onTab={(tab) => setOpen({ id: opened.id, tab })} onClose={() => setOpen(undefined)} reload={view.reload} />
      )}
    </div>
  );
}
