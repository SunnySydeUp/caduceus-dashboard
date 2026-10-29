import { useCanGoBack, useRouter } from '@tanstack/react-router';
import { Icon } from '../icons.tsx';
import type { SizeClass } from '../size-class.ts';
import { backAction } from '../back-target.ts';
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
          Retry {attempt}
        </span>
      )}
      <span className="sr-only">{spoken}</span>
    </span>
  );
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
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const back = compact ? backAction(info, module, canGoBack) : null;
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
  // A page whose crumb trail is only its own name (Today, Work) already says it in its heading: the app bar says it again only once the heading has scrolled away.
  const echoesHeading = !compact && crumbs.length === 1 && !titleShown;

  return (
    <header className={`appbar${titleShown ? ' is-scrolled' : ''}`}>
      {compact && back && (
        <AppLink
          className="btn btn--ghost btn--icon appbar__back"
          to={back.to}
          aria-label="Back"
          onClick={(event) => {
            // Back goes where the user came from; the link's address (one level up) is for a direct load, a middle click and a long press.
            if (!back.history || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            router.history.back();
          }}
        >
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
        ) : calm || echoesHeading ? null : (
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
