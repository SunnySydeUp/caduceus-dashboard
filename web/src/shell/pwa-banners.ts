import { useEffect } from 'react';
import { applyUpdate, useUpdateAvailable } from '../pwa.ts';
import { clearBanner, setBanner } from './banners.ts';
import { closeInstallGuide, openInstallGuide, useInstallOffer } from './install.ts';

/**
 * Raises the two notices of the installed app while the shell is mounted: "Update available" while a new build waits (accepting
 * it reloads the page into that build), and, on iOS, the invitation to add the app to the Home Screen once the owner has done
 * something meaningful here, which stays dismissed once it is.
 */
export function usePwaBanners(): void {
  const updateAvailable = useUpdateAvailable();
  const guide = useInstallOffer().guide;

  useEffect(() => {
    if (updateAvailable) {
      setBanner({
        id: 'update',
        priority: 2,
        tone: 'info',
        icon: 'refresh',
        title: 'Update available',
        body: 'A new version of Caduceus is ready. Updating reloads this page.',
        actions: [{ label: 'Update now', onClick: applyUpdate }],
        dismissible: true,
        quiet: true,
      });
    } else {
      clearBanner('update');
    }
    return () => clearBanner('update');
  }, [updateAvailable]);

  useEffect(() => {
    if (guide === 'show') {
      setBanner({
        id: 'install-guide',
        priority: 3,
        tone: 'info',
        icon: 'download',
        title: 'Add Caduceus to your Home Screen',
        body: 'It opens full screen like an app, and iOS only lets apps on the Home Screen send notifications.',
        actions: [{ label: 'Show me how', onClick: openInstallGuide }],
        dismissible: true,
        onDismiss: closeInstallGuide,
      });
    } else {
      clearBanner('install-guide');
    }
    return () => clearBanner('install-guide');
  }, [guide]);
}
