import { useEffect, useRef, useState } from 'react';
import { Outlet } from '@tanstack/react-router';
import { navModeFor } from '../size-class.ts';
import { AppBar } from './AppBar.tsx';
import { BannerStack } from './BannerStack.tsx';
import { useConnectionBanners } from './connection.ts';
import { useReadOnlyBanner } from '../policy-state.ts';
import { startAppearanceSync } from './appearance-store.ts';
import { requestHeadingFocus } from './focus-heading.ts';
import { InstallGuide } from './InstallGuide.tsx';
import { KeyboardProvider } from './keyboard-context.tsx';
import { Bridge, NavDrawer, Rail, Sidebar, SubNav, TabBar } from './Nav.tsx';
import { useRouteInfo } from './navigation.tsx';
import { ProfileScopeProvider } from './profile-context.tsx';
import { usePressureBanner } from './pressure-banners.ts';
import { usePwaBanners } from './pwa-banners.ts';
import { useRestartBanners } from './restart-banners.ts';
import { useUpdateBanners } from './update-banners.ts';
import { ShellActionsProvider } from './ShellActions.tsx';
import { useRevealSettingField } from './setting-field.ts';
import { useShellPrefs } from './shell-prefs.ts';
import { StepUpDialog } from './StepUpDialog.tsx';
import { TierDialog } from './TierDialog.tsx';
import { ToastRegion } from './ToastRegion.tsx';
import { useSizeClass } from './use-size-class.ts';
import { useKeyboardOpen, useTabBarShrunk } from './use-viewport.ts';

/**
 * The adaptive shell every signed-in page lives in, laid out as the Desk: a floating tab dock (Today, Talk, Work, More) and the app bar under 600 px, a rail from 600 px
 * and a sidebar (Today, Talk, Work, the crew) from 1200 px. From 600 px there is no app bar: the side card holds the scope (with the heartbeat ring), the one search,
 * and Help and Control in its foot, and the page starts at the top of the window beside it. The banner stack and the toast region sit around the page.
 * It knows nothing of any module: navigation, routes and search all come from the module registry's placements.
 */
export function AppShell() {
  const size = useSizeClass();
  const nav = navModeFor(size, useShellPrefs().sidebarCollapsed);
  const { pathname } = useRouteInfo();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const tabBarShrunk = useTabBarShrunk(nav === 'bar', pathname);
  const keyboardOpen = useKeyboardOpen();
  useConnectionBanners();
  useReadOnlyBanner();
  usePwaBanners();
  useRestartBanners();
  usePressureBanner();
  useUpdateBanners();
  useEffect(startAppearanceSync, []);
  useRevealSettingField();

  useEffect(() => {
    document.documentElement.dataset.shellSize = size;
    document.documentElement.dataset.shellNav = nav;
  }, [size, nav]);
  useEffect(() => setDrawerOpen(false), [size]);

  // Focus moves to the new page's heading when the route changes, never on the first load.
  const shownPath = useRef<string>(undefined);
  useEffect(() => {
    if (shownPath.current !== undefined && shownPath.current !== pathname) requestHeadingFocus();
    shownPath.current = pathname;
  }, [pathname]);

  const stateClasses = `${tabBarShrunk ? ' is-tabbar-shrunk' : ''}${keyboardOpen ? ' is-keyboard' : ''}`;
  return (
    <ProfileScopeProvider>
      <KeyboardProvider>
        <ShellActionsProvider>
          <div className={`app${stateClasses}`} id="app" data-size={size} data-nav={nav}>
            <a
              className="skip-link"
              href="#main"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById('main')?.focus();
              }}
            >
              Skip to content
            </a>
            {nav !== 'bar' && <nav className="side" aria-label="Main">{nav === 'sidebar' ? <Sidebar /> : <Rail size={size === 'large' ? 'large' : 'medium'} onOpenDrawer={() => setDrawerOpen(true)} />}</nav>}
            <div className="app__body">
              {nav === 'bar' ? (
                <>
                  <AppBar />
                  <SubNav />
                  <Bridge />
                  <BannerStack />
                </>
              ) : (
                <BannerStack />
              )}
              <main className="main" id="main" tabIndex={-1}>
                {/* From 600 px the Work views are canvas tabs at the top of the page column; on a phone they are the band under the app bar. */}
                {nav !== 'bar' && <SubNav />}
                <Outlet />
              </main>
            </div>
            {nav === 'bar' && <TabBar />}
          </div>
          {drawerOpen && <NavDrawer onClose={() => setDrawerOpen(false)} />}
          <ToastRegion />
          <StepUpDialog />
          <TierDialog />
          <InstallGuide />
        </ShellActionsProvider>
      </KeyboardProvider>
    </ProfileScopeProvider>
  );
}
