import { useCanGoBack, useRouter } from '@tanstack/react-router';
import { Icon } from '../icons.tsx';
import { backAction } from '../back-target.ts';
import type { ConnectionState } from '../gateway-connection.ts';
import { useConnection } from './connection.ts';
import { useHeadingScrolledAway } from './heading-visibility.ts';
import { AppLink, useRouteInfo } from './navigation.tsx';
import { ProfileChip } from './ProfileSwitcher.tsx';
import { useHelp } from './help-context.tsx';
import { useRegistry } from './registry-context.tsx';
import { useShellActions } from './ShellActions.tsx';

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

/**
 * The phone's app bar (under 600 px only; from 600 px the page owns its top and the side card holds scope, search, help and the connection): Back or the mark, the page
 * title once the page's own heading has scrolled away, the profile chip, the connection dot, Search and Help. A screen puts its own button in `#appbar-slot`.
 */
export function AppBar() {
  const registry = useRegistry();
  const info = useRouteInfo();
  const { openPalette } = useShellActions();
  const { openHelp } = useHelp();
  const titleShown = useHeadingScrolledAway();

  const shellModuleId = registry.shellModuleOf(info.moduleId, info.pathname);
  const module = shellModuleId ? registry.module(shellModuleId) : undefined;
  const title = info.title ?? module?.title ?? 'Page not found';
  const router = useRouter();
  const back = backAction(info, module, useCanGoBack());

  return (
    <header className={`appbar${titleShown ? ' is-scrolled' : ''}`}>
      {back ? (
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
      ) : (
        <span className="wordmark__glyph wordmark__glyph--sm" aria-hidden="true">
          C
        </span>
      )}
      <div className="appbar__title">
        <span className="appbar__title-text truncate" aria-hidden={!titleShown}>
          {title}
        </span>
      </div>
      {/* A screen puts its own button here (a portal): the terminal mode toggle. */}
      <span id="appbar-slot" className="appbar__slot" />
      <ProfileChip />
      <ConnectionDot />
      <button type="button" className="btn btn--ghost btn--icon" aria-label="Search and commands" aria-haspopup="dialog" onClick={openPalette}>
        <Icon name="search" />
      </button>
      <button type="button" className="btn btn--ghost btn--icon" aria-label="Help for this screen" aria-haspopup="dialog" onClick={() => openHelp({ screen: info.pathname })}>
        <Icon name="question" />
      </button>
    </header>
  );
}
