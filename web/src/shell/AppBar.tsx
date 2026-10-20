import { Icon } from '../icons.tsx';
import type { SizeClass } from '../size-class.ts';
import { CONTROL_GROUPS } from '../module-registry.ts';
import { deskNavigation } from './nav-order.ts';
import type { ConnectionState } from '../gateway-connection.ts';
import { useConnection } from './connection.ts';
import { useHeadingScrolledAway } from './heading-visibility.ts';
import { AppLink, useRouteInfo } from './navigation.tsx';
import { ProfileChip } from './ProfileSwitcher.tsx';
import { Keycaps, useKeyboard } from './keyboard-context.tsx';
import { useHelp } from './help-context.tsx';
import { useRegistry } from './registry-context.tsx';
import { useShellActions } from './ShellActions.tsx';
import { PALETTE_OPEN } from '../shortcuts.ts';
import type { RouteInfo } from './navigation.tsx';
import type { AppModule } from '../app-registry.ts';

const CONNECTION: Record<ConnectionState, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  connected: { label: 'Connected', tone: 'success' },
  reconnecting: { label: 'Reconnecting', tone: 'warning' },
  offline: { label: 'Offline', tone: 'neutral' },
};

/** The realtime dot: connected, reconnecting with the attempt count, or offline, with the plain reason a screen reader and a hover can read. */
function ConnectionDot() {
  const { state, attempt, reason } = useConnection();
  const { label, tone } = CONNECTION[state];
  const counted = state === 'reconnecting' && attempt > 0;
  const spoken = `Connection: ${label}${counted ? `, attempt ${attempt}` : ''}${reason ? `. ${reason}` : ''}`;
  return (
    <span className="appbar__conn" role="status" title={reason}>
      <span className={`dot${state === 'offline' ? ' dot--dashed' : ''}${state === 'reconnecting' ? ' pulse' : ''}`} data-tone={tone} aria-hidden="true" />
      {counted && (
        <span className="appbar__conn-count" aria-hidden="true">
          {attempt}
        </span>
      )}
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

/** Where "back" leads on a phone: the route's parent, else one level up inside the module, else Control (for a module in Control) or nowhere. */
function backTarget(info: RouteInfo, module: AppModule | undefined): string | null {
  if (info.parent) return info.parent;
  if (info.title === 'Control') return null;
  if (!module) return '/';
  if (info.pathname === module.path) return module.desk === 'control' ? '/control' : null;
  const up = info.pathname.slice(0, info.pathname.lastIndexOf('/'));
  return up.startsWith(module.path) ? up : module.path;
}

export function AppBar({ size }: { size: SizeClass }) {
  const registry = useRegistry();
  const info = useRouteInfo();
  const { openPalette } = useShellActions();
  const { openHelp } = useHelp();
  const paletteKey = useKeyboard().keymap.bindingOf(PALETTE_OPEN);
  const compact = size === 'compact';
  // On a phone the app bar shows the title once the page's own heading has scrolled away.
  const titleShown = useHeadingScrolledAway();

  const shellModuleId = registry.shellModuleOf(info.moduleId, info.pathname);
  const module = shellModuleId ? registry.module(shellModuleId) : undefined;
  const title = info.title ?? module?.title ?? 'Page not found';
  const back = compact ? backTarget(info, module) : null;
  // The crumb before the module: its Control group, or the destination (Today, Talk, Work) it sits in.
  const group = module?.group ? CONTROL_GROUPS.find((g) => g.id === module.group)?.title : deskNavigation(registry, []).destinations.find((d) => d.id === module?.desk)?.title;

  // Talk is a conversation with its own header (agent, title, Details): its top bar keeps only what is not about where you are: search, help and the connection.
  const calm = module?.desk === 'talk';
  const crumbs: { label: string; to?: string }[] = [];
  if (!compact) {
    if (group && group !== module?.title) crumbs.push({ label: group });
    if (module && title !== module.title) crumbs.push({ label: module.title, to: shellModuleId === info.moduleId ? (info.parent ?? module.path) : module.path });
    crumbs.push({ label: title });
  }

  return (
    <header className={`appbar${titleShown ? ' is-scrolled' : ''}`}>
      {compact && back && (
        <AppLink className="btn btn--ghost btn--icon appbar__back" to={back} aria-label="Back">
          <Icon name="chev-l" />
        </AppLink>
      )}
      {compact && !back && (
        <span className="wordmark__glyph wordmark__glyph--sm" aria-hidden="true">
          C
        </span>
      )}
      <div className="appbar__title">
        {compact ? (
          <span className="appbar__title-text truncate" aria-hidden={!titleShown}>
            {title}
          </span>
        ) : calm ? null : (
          <nav aria-label="Breadcrumb">
            <ol className="crumbs">
              {crumbs.map((crumb, index) => (
                <li key={crumb.label}>
                  {crumb.to ? <AppLink to={crumb.to}>{crumb.label}</AppLink> : <span aria-current={index === crumbs.length - 1 ? 'page' : undefined}>{crumb.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}
      </div>
      {/* A screen puts its own button here (a portal): the chat's Todo and Run on a phone. */}
      <span id="appbar-slot" className="appbar__slot" />
      {!calm && <ProfileChip />}
      <ConnectionDot />
      {size === 'large' ? (
        <button type="button" className="appbar__search" aria-haspopup="dialog" onClick={openPalette}>
          <Icon name="search" />
          <span>Search or jump to…</span>
          {paletteKey && <Keycaps binding={paletteKey} />}
        </button>
      ) : (
        <button type="button" className="btn btn--ghost btn--icon" aria-label="Search and commands" aria-haspopup="dialog" onClick={openPalette}>
          <Icon name="search" />
        </button>
      )}
      <button type="button" className="btn btn--ghost btn--icon" aria-label="Help for this screen" aria-haspopup="dialog" onClick={() => openHelp({ screen: info.pathname })}>
        <Icon name="question" />
      </button>
    </header>
  );
}
