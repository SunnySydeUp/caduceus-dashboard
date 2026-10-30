import { useMemo, type CSSProperties } from 'react';
import { controlBadge, crewAge, deskNavigation, placementOfPage, type CrewRow } from './nav-order.ts';
import { Icon, type IconName } from '../icons.tsx';
import { Layer } from '../overlays/Layer.tsx';
import { useCrew } from '../modules/crew/use-crew.ts';
import { HELP_OPEN, PALETTE_OPEN } from '../shortcuts.ts';
import { AppLink, useRouteInfo } from './navigation.tsx';
import { NavBadgeCount } from './NavBadgeCount.tsx';
import { Keycaps, useKeyboard } from './keyboard-context.tsx';
import { useHelp } from './help-context.tsx';
import { useProfileScope } from './profile-context.tsx';
import { ScopeButton } from './ProfileSwitcher.tsx';
import { Sigil } from './Sigil.tsx';
import { updateShellPrefs } from './shell-prefs.ts';
import { useRegistry } from './registry-context.tsx';
import { useShellActions } from './ShellActions.tsx';
import { useNow } from './use-now.ts';
import { morph } from '../motion.ts';
import type { DeskPlacement, NavBadge } from '../module-registry.ts';
import type { SizeClass } from '../size-class.ts';

/** Where Control lives. A phone's tab bar calls it More; the sidebar and the rail call it Control. */
const CONTROL_PATH = '/control';

/** How often the times on the crew rows are read again ("5 min" becomes "6 min"). */
const CREW_CLOCK_MS = 30_000;

/** Set while the sidebar folds or opens, so the toggle that replaces the pressed one takes the keyboard focus (the pressed one leaves the page with the old nav). */
let toggleKeepsFocus = false;

/** Folds the large sidebar to the rail, or opens it again, as one morph; the focus moves to the toggle on the other side. */
function foldSidebar(collapsed: boolean) {
  toggleKeepsFocus = document.activeElement instanceof HTMLElement && document.activeElement.matches('.rail__toggle, .sidebar__toggle');
  // Cleared once the fold has settled too, so a toggle that mounts later for another reason (a resize across 1200 px) never takes the focus.
  void morph(() => updateShellPrefs({ sidebarCollapsed: collapsed }), { types: ['desk-collapse'] }).finally(() => {
    toggleKeepsFocus = false;
  });
}

/** The toggle that has just replaced a pressed one takes the focus, in the same commit, so the new picture of the page already shows it focused. */
function takeToggleFocus(element: HTMLButtonElement | null) {
  if (!element || !toggleKeepsFocus) return;
  toggleKeepsFocus = false;
  element.focus({ preventScroll: true });
}

/** The Desk as the shell draws it: Today, Talk and Work, the crew, and Control, from the registry and the live crew state. */
function useDesk() {
  const registry = useRegistry();
  const crew = useCrew();
  return useMemo(() => deskNavigation(registry, crew), [registry, crew]);
}

/** What needs a look in Control (a failed run in Notices), as the one count on the More tab and the Control entry. */
function useControlBadge() {
  const { control } = useDesk();
  return useMemo(() => controlBadge({ control }), [control]);
}

/** The placement the current page sits under: what the tab bar, the rail and the sidebar light. A page that is nowhere (a 404) lights nothing. */
function useCurrentPlacement(): DeskPlacement | undefined {
  const registry = useRegistry();
  return placementOfPage(registry, useRouteInfo());
}

/** Whether this row is the agent the tab is on, while the tab is in Talk. */
function useIsCurrentAgent(): (row: CrewRow) => boolean {
  const placement = useCurrentPlacement();
  const { effective } = useProfileScope();
  return (row) => placement === 'talk' && effective?.name === row.profile;
}

/**
 * The name a part of the shell gives the browser while a Desk transition runs: `shell.css` copies `--vt` into `view-transition-name` only then (a name that is
 * always there would change every other transition on the page). `glides` is false for the list the drawer shows next to the rail: a name used twice cancels
 * the whole transition.
 */
function named(name: string, glides = true): CSSProperties | undefined {
  return glides ? ({ '--vt': name } as CSSProperties) : undefined;
}

/** The one highlight of a list (`tabs`, `side`, `crew`): it sits in the current item, and the browser glides it to the next current item inside the page transition. */
function NavPill({ list, glides = true }: { list: 'tabs' | 'side' | 'crew'; glides?: boolean }) {
  return <span className={`nav-pill nav-pill--${list}`} aria-hidden="true" style={named(`nav-pill-${list}`, glides)} />;
}

/**
 * One place in the phone's dock. Only the current one shows its words; the others are an icon, and their words stay for a screen reader (with the count a
 * badge carries, which a label on the link would hide).
 */
function TabLink({ name, to, icon, title, current, badge }: { name: string; to: string; icon: IconName; title: string; current: boolean; badge: NavBadge | undefined }) {
  return (
    <AppLink preload className="tab" to={to} style={named(name)} aria-current={current ? 'page' : undefined}>
      {current && <NavPill list="tabs" />}
      <span className="tab__icon">
        <Icon name={icon} />
        <NavBadgeCount badge={badge} />
      </span>
      <span className={current ? 'tab__label' : 'tab__label sr-only'}>{title}</span>
    </AppLink>
  );
}

/** Compact windows: the floating dock. Today, Talk and Work from the registry, and More, which opens Control. */
export function TabBar() {
  const { destinations } = useDesk();
  const moreBadge = useControlBadge();
  const current = useCurrentPlacement();
  return (
    <nav className="tabbar" aria-label="Main">
      {destinations.map((destination) => (
        <TabLink key={destination.id} name={`tab-${destination.id}`} to={destination.path} icon={destination.icon} title={destination.title} current={current === destination.id} badge={destination.badge} />
      ))}
      <TabLink name="tab-more" to={CONTROL_PATH} icon="more" title="More" current={current === 'control'} badge={moreBadge} />
    </nav>
  );
}

/** The sidebar's one search: a field-looking button that opens the command palette (the same as the shortcut). */
function SearchField() {
  const { openPalette } = useShellActions();
  const paletteKey = useKeyboard().keymap.bindingOf(PALETTE_OPEN);
  return (
    <button type="button" className="searchfield" aria-haspopup="dialog" onClick={openPalette}>
      <Icon name="search" />
      <span>Search or jump to…</span>
      {paletteKey && <Keycaps binding={paletteKey} />}
    </button>
  );
}

/** Help for the screen the owner is on (the route-aware panel). It is in the card's foot, which never scrolls away. */
function HelpButton({ compact, glides }: { compact: boolean; glides: boolean }) {
  const { openHelp } = useHelp();
  const { pathname } = useRouteInfo();
  const helpKey = useKeyboard().keymap.bindingOf(HELP_OPEN);
  return (
    <button type="button" className={`nav-item nav-item--button${compact ? ' rail__item' : ''}`} style={named('nav-help', glides)} aria-haspopup="dialog" title="Help for this screen" onClick={() => openHelp({ screen: pathname })}>
      {compact ? (
        <span className="rail__icon">
          <Icon name="question" />
        </span>
      ) : (
        <Icon name="question" />
      )}
      <span className="nav-label">Help</span>
      {!compact && helpKey && <Keycaps binding={helpKey} />}
    </button>
  );
}

function ControlLink({ compact, glides }: { compact: boolean; glides: boolean }) {
  const current = useCurrentPlacement() === 'control';
  const badge = useControlBadge();
  return (
    <AppLink preload className={`nav-item${compact ? ' rail__item' : ''}`} to={CONTROL_PATH} style={named('nav-control', glides)} aria-current={current ? 'page' : undefined}>
      {compact ? (
        <span className="rail__icon">
          {current && <NavPill list="side" glides={glides} />}
          <Icon name="sliders" />
          <NavBadgeCount badge={badge} />
        </span>
      ) : (
        <>
          {current && <NavPill list="side" glides={glides} />}
          <Icon name="sliders" />
        </>
      )}
      <span className="nav-label">Control</span>
      {!compact && <NavBadgeCount badge={badge} />}
    </AppLink>
  );
}

/**
 * Medium windows (and the collapsed large sidebar): the navigation rail. The fold toggle, the scope (a sigil button), Search, Today, Talk and Work, a sigil for each
 * agent (the only part that scrolls), and the foot that stays: Help and Control.
 */
export function Rail({ size, onOpenDrawer }: { size: Exclude<SizeClass, 'compact'>; onOpenDrawer(): void }) {
  const { destinations, crew } = useDesk();
  const current = useCurrentPlacement();
  const isCurrentAgent = useIsCurrentAgent();
  const medium = size === 'medium';
  const { openPalette } = useShellActions();
  return (
    <div className="rail">
      {/* Medium windows open the full Desk as a drawer; a collapsed large sidebar expands again, as one morph (`shell.css`, "Folding the sidebar"). */}
      <button
        type="button"
        ref={medium ? undefined : takeToggleFocus}
        className="btn btn--ghost btn--icon rail__toggle"
        aria-label={medium ? 'Open navigation drawer' : 'Expand sidebar'}
        aria-haspopup={medium ? 'dialog' : undefined}
        aria-expanded={medium ? undefined : false}
        onClick={medium ? onOpenDrawer : () => foldSidebar(false)}
      >
        <Icon name={medium ? 'menu' : 'sidebar-expand'} />
      </button>
      <ScopeButton placement="rail" />
      <button type="button" className="nav-item nav-item--button rail__item" aria-haspopup="dialog" onClick={openPalette}>
        <span className="rail__icon">
          <Icon name="search" />
        </span>
        <span className="nav-label">Search</span>
      </button>
      {destinations.map((destination) => (
        <AppLink preload key={destination.id} className="nav-item rail__item" to={destination.path} style={named(`nav-${destination.id}`)} aria-current={current === destination.id ? 'page' : undefined}>
          <span className="rail__icon">
            {current === destination.id && <NavPill list="side" />}
            <Icon name={destination.icon} />
            <NavBadgeCount badge={destination.badge} />
          </span>
          <span className="nav-label">{destination.title}</span>
        </AppLink>
      ))}
      {crew.length > 0 && (
        <ul className="rail__crew crewlist__scroll" aria-label="Crew">
          {crew.map((row, index) => {
            const isCurrent = isCurrentAgent(row);
            return (
              <li key={row.profile} className="crew__slot">
                <AppLink preload className="nav-item rail__item rail__mate" to={row.path} flight style={named(`mate-${index}`)} aria-current={isCurrent ? 'page' : undefined}>
                  {isCurrent && <NavPill list="crew" />}
                  <Sigil name={row.profile} size="sm" state={row.state} />
                  <span className="nav-label">{row.profile}</span>
                  <span className="sr-only">{row.stateLabel}</span>
                </AppLink>
                <NewChatWith row={row} />
              </li>
            );
          })}
        </ul>
      )}
      <div className="nav-foot">
        <HelpButton compact glides />
        <ControlLink compact glides />
      </div>
    </div>
  );
}

/**
 * A new chat with one agent of the crew: a small + on its row that shows when the pointer is over the row or the keyboard is on it. The row itself still opens the
 * agent's latest chat.
 */
function NewChatWith({ row }: { row: CrewRow }) {
  if (row.newChat === undefined) return null;
  return (
    <AppLink className="btn btn--secondary btn--icon btn--sm crew__new" to={row.newChat} aria-label={`New chat with ${row.profile}`} title={`New chat with ${row.profile}`}>
      <Icon name="plus" small />
    </AppLink>
  );
}

/**
 * One agent of the crew in the sidebar: its sigil with the live state, its name, what it is doing and since when. It opens that agent's thread, and its sigil and
 * name fly to that thread's header (`useAppNavigate`).
 */
function CrewMate({ row, now, current, index, glides }: { row: CrewRow; now: number; current: boolean; index: number; glides: boolean }) {
  return (
    <>
      <AppLink preload className="mate" to={row.path} flight style={named(`mate-${index}`, glides)} aria-current={current ? 'page' : undefined}>
        {current && <NavPill list="crew" glides={glides} />}
        <Sigil name={row.profile} size="md" state={row.state} />
        <span className="mate__text">
          <span className="mate__name">{row.profile}</span>
          <span className="sr-only">: {row.stateLabel}. </span>
          <small className="mate__line">{row.line}</small>
        </span>
        <span className="mate__time">{crewAge(row.since, now)}</span>
      </AppLink>
      <NewChatWith row={row} />
    </>
  );
}

/**
 * The Desk's sidebar content under the card's head: the one Search field, Today, Talk and Work, the crew (the only part that scrolls, with a fade where it is cut), then
 * the foot that never scrolls away: Help and Control. The sidebar and the medium drawer both show it; `glides` is false in the drawer, which opens next to the rail and so
 * must not name anything the rail names.
 */
function DeskNav({ glides }: { glides: boolean }) {
  const { destinations, crew } = useDesk();
  const current = useCurrentPlacement();
  const isCurrentAgent = useIsCurrentAgent();
  const now = useNow(crew.some((row) => row.since !== undefined), CREW_CLOCK_MS);
  return (
    <>
      <SearchField />
      <div className="nav-list">
        {destinations.map((destination) => (
          <AppLink preload key={destination.id} className="nav-item" to={destination.path} style={named(`nav-${destination.id}`, glides)} aria-current={current === destination.id ? 'page' : undefined}>
            {current === destination.id && <NavPill list="side" glides={glides} />}
            <Icon name={destination.icon} />
            <span className="nav-label">{destination.title}</span>
            <NavBadgeCount badge={destination.badge} />
          </AppLink>
        ))}
      </div>
      {crew.length > 0 && (
        <section className="crewlist" aria-labelledby="crewlist-title">
          <h2 className="nav-heading" id="crewlist-title">
            Crew <span>{crew.length}</span>
          </h2>
          <ul className="crewlist__scroll">
            {crew.map((row, index) => (
              <li key={row.profile} className="crew__slot">
                <CrewMate row={row} now={now} current={isCurrentAgent(row)} index={index} glides={glides} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="nav-foot">
        <HelpButton compact={false} glides={glides} />
        <ControlLink compact={false} glides={glides} />
      </div>
    </>
  );
}

/** Large windows: the persistent Desk sidebar, collapsible to the rail as one morph (`shell.css`, "Folding the sidebar"). Its head is the scope switcher and the fold toggle. */
export function Sidebar() {
  return (
    <div className="sidebar">
      <div className="sidebar__head">
        <ScopeButton placement="head" />
        <button type="button" ref={takeToggleFocus} className="btn btn--ghost btn--icon sidebar__toggle" aria-label="Collapse sidebar" aria-expanded="true" onClick={() => foldSidebar(true)}>
          <Icon name="sidebar-collapse" />
        </button>
      </div>
      <DeskNav glides />
    </div>
  );
}

/** Medium windows: the rail's menu button opens the same Desk as a drawer. */
export function NavDrawer({ onClose }: { onClose(): void }) {
  return (
    <Layer kind="drawer" panelClassName="drawer drawer--start" label="Navigation" initialFocus='[aria-current="page"]' onClose={onClose}>
      <div className="overlay__body drawer__body" data-body>
        <div className="sidebar sidebar--drawer">
          <div className="sidebar__head">
            <ScopeButton placement="head" />
            <button type="button" className="btn btn--ghost btn--icon" aria-label="Close navigation" onClick={onClose} data-close>
              <Icon name="x" />
            </button>
          </div>
          <DeskNav glides={false} />
        </div>
      </div>
    </Layer>
  );
}

/** Work screens: chips for the modules placed in Work, since the Work destination leads to only one of them. */
export function SubNav() {
  const { destinations } = useDesk();
  const { moduleId } = useRouteInfo();
  const work = destinations.find(({ id }) => id === 'work')?.modules ?? [];
  if (work.length < 2 || !work.some((m) => m.id === moduleId)) return null;
  return (
    <div className="subnav">
      <nav className="subnav__inner" aria-label="Work">
        {work.map((module) => (
          <AppLink key={module.id} className="chip" to={module.path} aria-current={moduleId === module.id ? 'page' : undefined}>
            <Icon name={module.icon} />
            {module.title}
          </AppLink>
        ))}
      </nav>
    </div>
  );
}

/**
 * Talk on a phone: a row of the crew's sigils to switch agent without going back to the list. It starts with New chat, a new chat with the agent the tab is on: a
 * phone's Talk header has no room for that button beside the agent's name.
 */
export function Bridge() {
  const { crew } = useDesk();
  const current = useCurrentPlacement();
  const isCurrentAgent = useIsCurrentAgent();
  if (current !== 'talk' || crew.length === 0) return null;
  const agent = crew.find(isCurrentAgent);
  return (
    <nav className="bridge" aria-label="Switch agent">
      <ul className="bridge__list">
        <li>
          {/* With no agent of the crew current, the address keeps the tab's own profile (AppLink). */}
          <AppLink className="bridge__item bridge__new" to={agent?.newChat ?? '/chat/new'} aria-label={agent ? `New chat with ${agent.profile}` : 'New chat'}>
            <span className="bridge__plus">
              <Icon name="plus" />
            </span>
            <span className="bridge__name">New chat</span>
          </AppLink>
        </li>
        {crew.map((row) => (
          <li key={row.profile}>
            <AppLink className="bridge__item" to={row.path} aria-current={isCurrentAgent(row) ? 'page' : undefined}>
              <Sigil name={row.profile} size="sm" state={row.state} />
              <span className="bridge__name">{row.profile}</span>
              <span className="sr-only">{row.stateLabel}</span>
            </AppLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
