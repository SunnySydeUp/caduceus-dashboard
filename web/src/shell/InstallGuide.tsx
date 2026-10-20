import { Icon } from '../icons.tsx';
import { Sheet } from '../overlays/Sheet.tsx';
import { closeInstallGuide, useInstallGuideOpen } from './install.ts';

/** The "Add to Home Screen" guide for iOS, which has no install button: the way in is the Share sheet. Closing it counts as answering it. */
export function InstallGuide() {
  if (!useInstallGuideOpen()) return null;
  return (
    <Sheet
      title="Add Caduceus to your Home Screen"
      onClose={closeInstallGuide}
      footer={
        <button type="button" className="btn btn--primary" onClick={closeInstallGuide}>
          Got it
        </button>
      }
    >
      <ol className="install-steps">
        <li>
          <span className="install-steps__icon">
            <Icon name="external" />
          </span>
          <span>
            Tap the <strong>Share</strong> button in Safari’s toolbar (the square with an arrow pointing up).
          </span>
        </li>
        <li>
          <span className="install-steps__icon">
            <Icon name="plus" />
          </span>
          <span>
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </span>
        </li>
        <li>
          <span className="install-steps__icon">
            <Icon name="check" />
          </span>
          <span>
            Tap <strong>Add</strong>, then open Caduceus from its icon.
          </span>
        </li>
      </ol>
      <p className="help-text">It opens full screen like an app and starts faster. iOS only lets apps on the Home Screen send notifications, so this is also the first step to getting them later.</p>
    </Sheet>
  );
}
