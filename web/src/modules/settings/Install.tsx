import { Icon } from '../../icons.tsx';
import { openInstallGuide, promptInstall, useInstallOffer } from '../../shell/install.ts';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';

/** Settings › Install: install Caduceus on this device as an app (an Install button where the browser has one, the Add to Home Screen guide on iOS). */
export function Install() {
  const { settings } = useInstallOffer();
  return (
    <div className="page-stack">
      <PageHeader
        title="Install app"
        subtitle={
          <>
            Run Caduceus like an <Term id="installed-app">installed app</Term>, from your Home Screen or dock.
          </>
        }
      />
      <section className="settings-section" aria-labelledby="install-title" data-setting-field="install/install" tabIndex={-1}>
        <h2 id="install-title">This device</h2>
        {settings === 'install' && (
          <>
            <p>This browser can install Caduceus. It then opens in its own window, and starts faster.</p>
            <div className="settings-actions">
              <button type="button" className="btn btn--primary" onClick={() => void promptInstall()}>
                <Icon name="download" />
                Install Caduceus
              </button>
            </div>
          </>
        )}
        {settings === 'guide' && (
          <>
            <p>On iPhone and iPad you add Caduceus from the Share menu. It then opens full screen, and iOS lets it send notifications.</p>
            <div className="settings-actions">
              <button type="button" className="btn btn--primary" onClick={openInstallGuide}>
                <Icon name="download" />
                Show me how
              </button>
            </div>
          </>
        )}
        {settings === 'installed' && <p role="status">Caduceus is installed on this device: you are using the installed app.</p>}
        {settings === 'unavailable' && (
          <p role="status">
            This browser has not offered to install Caduceus. Chrome and Edge show an Install button here once the page has loaded over HTTPS (or from localhost). Safari on a Mac installs from File › Add to Dock. Some browsers, such as Firefox on a desktop, cannot install web apps.
          </p>
        )}
      </section>
    </div>
  );
}
