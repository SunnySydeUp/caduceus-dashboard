import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from '../icons.tsx';
import type { ProfileSummary } from '../profile-scope.ts';
import { placePopover } from '../popover-placement.ts';
import { Layer } from '../overlays/Layer.tsx';
import { Sheet } from '../overlays/Sheet.tsx';
import { useConnection } from './connection.ts';
import { heartbeatWords } from './heartbeat.ts';
import { Sigil } from './Sigil.tsx';
import { useProfileScope } from './profile-context.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { Term } from './Term.tsx';
import { useSizeClass } from './use-size-class.ts';
import './scope-switcher.css';

/** Where the switcher opens from on a window of 600 px or more: under the head of the side card, or beside the rail's scope button. A phone's sheet needs no anchor. */
interface SwitcherAnchor {
  element: HTMLElement;
  side: 'below' | 'beside';
}

const SWITCHER_TITLE = 'Switch agent';

/** Arrow keys move between the rows of the radio group (and wrap round); Home and End go to the first and the last. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 }[event.key];
  if (next === undefined || rows.length === 0) return;
  event.preventDefault();
  rows[(next + rows.length) % rows.length]?.focus();
}

function ProfileRow({ profile, checked, isDefault, onChoose }: { profile: ProfileSummary; checked: boolean; isDefault: boolean; onChoose(): void }) {
  return (
    <button type="button" className="plist__row" role="radio" aria-checked={checked} onClick={onChoose}>
      <Sigil name={profile.name} size="sm" />
      <span className="plist__main">
        <span className="plist__name">
          {profile.name}
          {isDefault && <span className="tag">Hermes default</span>}
        </span>
        {profile.model && <span className="plist__sub mono truncate">{profile.model}</span>}
      </span>
      {profile.gatewayRunning === null ? <span /> : <StatusBadge state={profile.gatewayRunning ? 'online' : 'offline'} label={profile.gatewayRunning ? 'Gateway on' : 'Gateway off'} variant="plain" />}
      <span className="plist__check">{checked && <Icon name="check" />}</span>
    </button>
  );
}

/** The agent switcher's content (information architecture §6): choosing scopes this tab only; Hermes's default is never touched. */
function SwitcherBody() {
  const { hermes, unavailable, scope, mode, choose } = useProfileScope();
  const crossProfile = mode === 'cross';
  return (
    <>
      <p className="plist__note">
        {crossProfile ? 'This view can show every agent. Pick one to narrow it, or keep all.' : 'Screens in this tab use the selected agent.'} Switching affects <strong>this tab only</strong>: other tabs and devices keep their own.{' '}
        <Term id="profile-scope">What is agent scope?</Term>
      </p>
      {!hermes && (
        <p className="plist__note" role="status">
          {unavailable ? 'Hermes is not answering, so its agents cannot be listed yet.' : 'Loading agents…'}
        </p>
      )}
      {hermes && (
        <>
          <div className="plist" role="radiogroup" aria-label="Agent scope" onKeyDown={moveFocus}>
            {crossProfile && (
              <button type="button" className="plist__row" role="radio" aria-checked={scope === 'all'} onClick={() => void choose('all')}>
                <Sigil name="all" size="sm" />
                <span className="plist__main">
                  <span className="plist__name">All agents</span>
                  <span className="plist__sub">Notices, Board, Schedules, history and Insights</span>
                </span>
                <span />
                <span className="plist__check">{scope === 'all' && <Icon name="check" />}</span>
              </button>
            )}
            {hermes.profiles.map((profile) => (
              <ProfileRow key={profile.name} profile={profile} checked={scope === profile.name} isDefault={profile.name === hermes.hermesDefault} onChoose={() => void choose(profile.name)} />
            ))}
          </div>
          <div className="plist__default">
            <div>
              <strong>Hermes default:</strong> <span className="mono">{hermes.hermesDefault}</span>
              <p className="subtle">Used by new command-line sessions and anything with no agent chosen. Choosing an agent here never changes it; Control › Profiles does.</p>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/**
 * The switcher as a popover (600 px and wider): a modal layer, so the page behind is inert, focus stays inside and returns to the head, Escape and a press outside
 * close it; but with no tint, and its panel set by hand: below the head, or beside the rail's button, always inside the window. The panel's size changes as the list
 * arrives, so it is placed again when it does.
 */
function AnchoredSwitcher({ anchor, onClose, children }: { anchor: SwitcherAnchor; onClose(): void; children: ReactNode }) {
  const titleId = useId();
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = body.current?.closest<HTMLElement>('[data-panel]');
    if (!panel) return;
    const place = () => {
      const at = placePopover({
        anchor: anchor.element.getBoundingClientRect(),
        size: { width: panel.offsetWidth, height: panel.offsetHeight },
        viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
        rtl: getComputedStyle(anchor.element).direction === 'rtl',
        beside: anchor.side === 'beside',
      });
      panel.style.insetInlineStart = `${at.inlineStart}px`;
      panel.style.insetBlockStart = `${at.blockStart}px`;
    };
    place();
    const watch = new ResizeObserver(place);
    watch.observe(panel);
    window.addEventListener('resize', place);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchor]);
  return (
    <Layer kind="dialog" className="layer--anchored" panelClassName="swpop" labelledBy={titleId} initialFocus='[aria-checked="true"]' onClose={onClose}>
      <h2 id={titleId} className="swpop__title">
        {SWITCHER_TITLE}
      </h2>
      <div ref={body} className="swpop__body">
        {children}
      </div>
    </Layer>
  );
}

/** The agent switcher: a popover anchored to where it was opened from on a window of 600 px or more, a bottom sheet on a phone. */
function ProfileSwitcher({ onClose, anchor }: { onClose(): void; anchor?: SwitcherAnchor }) {
  const compact = useSizeClass() === 'compact';
  if (compact || !anchor) {
    return (
      <Sheet title={SWITCHER_TITLE} detents={['auto', 'full']} initialFocus='[aria-checked="true"]' onClose={onClose}>
        <SwitcherBody />
      </Sheet>
    );
  }
  return (
    <AnchoredSwitcher anchor={anchor} onClose={onClose}>
      <SwitcherBody />
    </AnchoredSwitcher>
  );
}

/** What the chip says on a screen locked to All agents (Today): there is nothing to switch, and the sheet says why. */
function AllProfilesNote({ onClose }: { onClose(): void }) {
  return (
    <Sheet title="This screen shows every agent" detents={['auto']} onClose={onClose}>
      <p className="plist__note">
        Everything here comes from all your agents together, so nothing is hidden. The agent you pick on other screens does not filter it. To work with one agent, open Talk or Work and pick it from the agent chip at the top.{' '}
        <Term id="profile-scope">What is agent scope?</Term>
      </p>
    </Sheet>
  );
}

/** What the scope says on this screen: its name and sigil, whether the screen is cross-agent, and whether it is locked to All agents (Today), where there is nothing to switch. */
function useScopeLook() {
  const { scope, lastScope, mode } = useProfileScope();
  if (mode === 'all') return { label: 'All agents', sigil: 'all', cross: false, locked: true };
  const named = scope ?? lastScope;
  return { label: named === 'all' ? 'All agents' : (named ?? 'Agent'), sigil: named ?? '?', cross: mode === 'cross', locked: false };
}

/** The phone's app bar chip: the scope of this tab, opening the switcher. On a screen locked to All agents it opens a note that says so: there is nothing to switch. */
export function ProfileChip() {
  const { label, sigil, cross, locked } = useScopeLook();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="chip chip--profile appbar__profile"
        data-cross={cross ? '' : undefined}
        aria-haspopup="dialog"
        aria-label={locked ? 'Agent scope: All agents. This screen always shows every agent' : `Agent scope: ${label}. Switch agent`}
        onClick={() => setOpen(true)}
      >
        <Sigil name={sigil} size="xs" />
        <span className="truncate">{label}</span>
        <Icon name={locked ? 'info' : 'chev-d'} small />
      </button>
      {open && (locked ? <AllProfilesNote onClose={() => setOpen(false)} /> : <ProfileSwitcher onClose={() => setOpen(false)} />)}
    </>
  );
}

/**
 * The scope at the head of the side card (the sidebar's head, the rail's first item after the fold toggle): the scope's sigil, wrapped in the heartbeat ring that carries
 * the connection (steady success ring connected, steady warning ring reconnecting, dashed neutral ring offline; `shell.css`), and its name. The button opens the switcher:
 * a popover under the head (or beside the rail's button) on a window of 600 px or more; this button is the only element it adds to the card, so the card's own layout is
 * unchanged. Its name says the connection in words, so the ring is never the only way to know. On Talk the scope is the open agent; on a screen locked to All agents (Today)
 * it is plain text with no button, because there is nothing to choose.
 */
export function ScopeButton({ placement }: { placement: 'head' | 'rail' }) {
  const { label, sigil, cross, locked } = useScopeLook();
  const status = useConnection();
  const [anchor, setAnchor] = useState<SwitcherAnchor>();
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // The switcher gives focus back to the layer under it (the drawer, at 600 to 1199 px) when it closes; the head takes it from there.
  useEffect(() => {
    if (anchor !== undefined) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      button.current?.focus();
    }
  }, [anchor]);
  const words = heartbeatWords(status);
  const body = (
    <>
      <span className="scope__mark" data-link={status.state}>
        <Sigil name={sigil} size="sm" />
      </span>
      <span className="scope__name">{label}</span>
    </>
  );
  if (locked) {
    return (
      <div className={`scope scope--${placement}`}>
        {body}
        <span className="sr-only">. {words}.</span>
      </div>
    );
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`scope scope--${placement} scope--button`}
        data-cross={cross ? '' : undefined}
        aria-haspopup="dialog"
        aria-expanded={anchor !== undefined}
        aria-label={`Agent scope: ${label}. ${words}.`}
        onClick={(event) => {
          const button = event.currentTarget;
          // Safari does not focus a button when it is pressed; the layer gives focus back to what had it, so the button takes it first.
          button.focus();
          setAnchor(placement === 'rail' ? { element: button, side: 'beside' } : { element: button.closest<HTMLElement>('.sidebar__head') ?? button, side: 'below' });
        }}
      >
        {body}
        {placement === 'head' && <Icon name="chev-d" small />}
      </button>
      {anchor && <ProfileSwitcher anchor={anchor} onClose={() => setAnchor(undefined)} />}
    </>
  );
}
