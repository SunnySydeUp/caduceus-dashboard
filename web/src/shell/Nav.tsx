import { useMemo } from 'react';
import { crewAge, deskNavigation, type CrewRow } from './nav-order.ts';
import { Icon } from '../icons.tsx';
import { Layer } from '../overlays/Layer.tsx';
import { useCrew } from '../modules/crew/use-crew.ts';
import { PALETTE_OPEN } from '../shortcuts.ts';
import { AppLink, useRouteInfo } from './navigation.tsx';
import { NavBadgeCount } from './NavBadgeCount.tsx';
import { Keycaps, useKeyboard } from './keyboard-context.tsx';
import { useProfileScope } from './profile-context.tsx';
import { Sigil } from './Sigil.tsx';
import { updateShellPrefs } from './shell-prefs.ts';
import { useRegistry } from './registry-context.tsx';
import { useShellActions } from './ShellActions.tsx';
import { useNow } from './use-now.ts';
import type { DeskPlacement } from '../module-registry.ts';
import type { SizeClass } from '../size-class.ts';

/** Where Control lives. A phone's tab bar calls it More; the sidebar and the rail call it Control. */
const CONTROL_PATH = '/control';

/** How often the times on the crew rows are read again ("5 min" becomes "6 min"). */
const CREW_CLOCK_MS = 30_000;

/** The Desk as the shell draws it: Today, Talk and Work, the crew, and Control, from the registry and the live crew state. */
function useDesk() {
  const registry = useRegistry();
  const crew = useCrew();
  return useMemo(() => deskNavigation(registry, crew), [registry, crew]);
}

/** The placement the current page sits under: what the tab bar, the rail and the sidebar light. */
function useCurrentPlacement(): DeskPlacement {
  const registry = useRegistry();
  const { moduleId, pathname } = useRouteInfo();
  return moduleId === undefined ? 'control' : registry.destinationOf(moduleId, pathname);
}

/** Whether this row is the agent the tab is on, while the tab is in Talk. */
function useIsCurrentAgent(): (row: CrewRow) => boolean {
  const placement = useCurrentPlacement();
  const { effective } = useProfileScope();
  return (row) => placement === 'talk' && effective?.name === row.profile;
}

export function Wordmark() {
  return (
    <AppLink className="wordmark" to="/">
      <span className="wordmark__glyph" aria-hidden="true">
        C
      </span>
      <span className="wordmark__text">Caduceus Dashboard</span>
    </AppLink>
  );
}

/** Compact windows: the bottom tab bar. Today, Talk and Work from the registry, and More, which opens Control. */
export function TabBar() {
  const { destinations } = useDesk();
  const current = useCurrentPlacement();
  return (
    <nav className="tabbar" aria-label="Main">
      {destinations.map((destination) => (
        <AppLink key={destination.id} className="tab" to={destination.path} aria-current={current === destination.id ? 'page' : undefined}>
          <Icon name={destination.icon} />
          <span>{destination.title}</span>
          <NavBadgeCount badge={destination.badge} />
        </AppLink>
      ))}
      <AppLink className="tab" to={CONTROL_PATH} aria-current={current === 'control' ? 'page' : undefined}>
        <Icon name="more" />
        <span>More</span>
      </AppLink>
    </nav>
  );
}

/** The search entry of the sidebar and the rail: it opens the command palette, the same as the app bar's button. */
function SearchButton({ compact }: { compact: boolean }) {
  const { openPalette } = useShellActions();
  const paletteKey = useKeyboard().keymap.bindingOf(PALETTE_OPEN);
  return (
    <button type="button" className={`nav-item nav-item--button${compact ? ' rail__item' : ''}`} aria-haspopup="dialog" onClick={openPalette}>
      {compact ? (
        <span className="rail__icon">
          <Icon name="search" />
        </span>
      ) : (
        <Icon name="search" />
      )}
      <span className="nav-label">Search</span>
      {!compact && paletteKey && <Keycaps binding={paletteKey} />}
    </button>
  );
}

function ControlLink({ compact }: { compact: boolean }) {
  const current = useCurrentPlacement();
  return (
    <AppLink className={`nav-item${compact ? ' rail__item' : ''}`} to={CONTROL_PATH} aria-current={current === 'control' ? 'page' : undefined}>
      {compact ? (
        <span className="rail__icon">
          <Icon name="sliders" />
        </span>
      ) : (
        <Icon name="sliders" />
      )}
      <span className="nav-label">Control</span>
    </AppLink>
  );
}

/** Medium windows (and the collapsed large sidebar): the navigation rail. Today, Talk and Work, a sigil for each agent, Search and Control. */
export function Rail({ size, onOpenDrawer }: { size: Exclude<SizeClass, 'compact'>; onOpenDrawer(): void }) {
  const { destinations, crew } = useDesk();
  const current = useCurrentPlacement();
  const isCurrentAgent = useIsCurrentAgent();
  const medium = size === 'medium';
  return (
    <div className="rail">
      {/* Medium windows open the full Desk as a drawer; a collapsed large sidebar expands again. */}
      <button
        type="button"
        className="btn btn--ghost btn--icon rail__toggle"
        aria-label={medium ? 'Open navigation drawer' : 'Expand sidebar'}
        aria-haspopup={medium ? 'dialog' : undefined}
        aria-expanded={medium ? undefined : false}
        onClick={medium ? onOpenDrawer : () => updateShellPrefs({ sidebarCollapsed: false })}
      >
        <Icon name={medium ? 'menu' : 'sidebar-expand'} />
      </button>
      {destinations.map((destination) => (
        <AppLink key={destination.id} className="nav-item rail__item" to={destination.path} aria-current={current === destination.id ? 'page' : undefined}>
          <span className="rail__icon">
            <Icon name={destination.icon} />
            <NavBadgeCount badge={destination.badge} />
          </span>
          <span className="nav-label">{destination.title}</span>
        </AppLink>
      ))}
      {crew.length > 0 && (
        <ul className="rail__crew" aria-label="Crew">
          {crew.map((row) => (
            <li key={row.profile} className="crew__slot">
              <AppLink className="nav-item rail__item rail__mate" to={row.path} aria-current={isCurrentAgent(row) ? 'page' : undefined}>
                <Sigil name={row.profile} size="sm" state={row.state} />
                <span className="nav-label">{row.profile}</span>
                <span className="sr-only">{row.stateLabel}</span>
              </AppLink>
              <NewChatWith row={row} />
            </li>
          ))}
        </ul>
      )}
      <SearchButton compact />
      <ControlLink compact />
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

/** One agent of the crew in the sidebar: its sigil with the live state, its name, what it is doing and since when. It opens that agent's thread. */
function CrewMate({ row, now, current }: { row: CrewRow; now: number; current: boolean }) {
  return (
    <>
      <AppLink className="mate" to={row.path} aria-current={current ? 'page' : undefined}>
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

/** The Desk's sidebar content: Today, Talk and Work, the crew, then Search and Control. The sidebar and the medium drawer both show it. */
function DeskNav() {
  const { destinations, crew } = useDesk();
  const current = useCurrentPlacement();
  const isCurrentAgent = useIsCurrentAgent();
  const now = useNow(crew.some((row) => row.since !== undefined), CREW_CLOCK_MS);
  return (
    <>
      <div className="nav-list">
        {destinations.map((destination) => (
          <AppLink key={destination.id} className="nav-item" to={destination.path} aria-current={current === destination.id ? 'page' : undefined}>
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
          <ul>
            {crew.map((row) => (
              <li key={row.profile} className="crew__slot">
                <CrewMate row={row} now={now} current={isCurrentAgent(row)} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="nav-foot">
        <SearchButton compact={false} />
        <ControlLink compact={false} />
      </div>
    </>
  );
}

/** Large windows: the persistent Desk sidebar, collapsible to the rail. */
export function Sidebar() {
  return (
    <div className="sidebar">
      <div className="sidebar__head">
        <Wordmark />
        <button type="button" className="btn btn--ghost btn--icon" aria-label="Collapse sidebar" aria-expanded="true" onClick={() => updateShellPrefs({ sidebarCollapsed: true })}>
          <Icon name="sidebar-collapse" />
        </button>
      </div>
      <DeskNav />
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
            <Wordmark />
            <button type="button" className="btn btn--ghost btn--icon" aria-label="Close navigation" onClick={onClose} data-close>
              <Icon name="x" />
            </button>
          </div>
          <DeskNav />
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
