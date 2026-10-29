import { useState, type KeyboardEvent } from 'react';
import { Icon } from '../icons.tsx';
import type { ProfileSummary } from '../profile-scope.ts';
import { Sheet } from '../overlays/Sheet.tsx';
import { Sigil } from './Sigil.tsx';
import { useProfileScope } from './profile-context.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { Term } from './Term.tsx';

/** Arrow keys move between the rows of the radio group. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const next = rows.indexOf(document.activeElement as HTMLElement) + (event.key === 'ArrowDown' ? 1 : rows.length - 1);
  rows[next % rows.length]?.focus();
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

/** The profile switcher (information architecture §6): choosing scopes this tab only; Hermes's default is never touched. */
function ProfileSwitcher({ onClose }: { onClose(): void }) {
  const { hermes, unavailable, scope, mode, choose } = useProfileScope();
  const crossProfile = mode === 'cross';
  return (
    <Sheet title="Switch profile" detents={['auto', 'full']} initialFocus='[aria-checked="true"]' onClose={onClose}>
      <p className="plist__note">
        {crossProfile ? 'This view is cross-profile. Pick one profile to filter it, or keep all.' : 'Screens in this tab use the selected profile.'} Switching affects <strong>this tab only</strong> (
        <span className="mono">?profile=</span>); other tabs and devices keep their own. <Term id="profile-scope">What is profile scope?</Term>
      </p>
      {!hermes && (
        <p className="plist__note" role="status">
          {unavailable ? 'Hermes is not answering, so its profiles cannot be listed yet.' : 'Loading profiles…'}
        </p>
      )}
      {hermes && (
        <>
          <div className="plist" role="radiogroup" aria-label="Profile scope" onKeyDown={moveFocus}>
            {crossProfile && (
              <button type="button" className="plist__row" role="radio" aria-checked={scope === 'all'} onClick={() => void choose('all')}>
                <Sigil name="all" size="sm" />
                <span className="plist__main">
                  <span className="plist__name">All profiles</span>
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
              <p className="subtle">Used by new CLI sessions and anything without a profile. Choosing a profile here never changes it; Profiles does.</p>
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}

/** What the chip says on a screen locked to All profiles (Today): there is nothing to switch, and the sheet says why. */
function AllProfilesNote({ onClose }: { onClose(): void }) {
  return (
    <Sheet title="This screen shows every profile" detents={['auto']} onClose={onClose}>
      <p className="plist__note">
        Everything here comes from all your profiles together, so nothing is hidden. The profile you pick on other screens does not filter it. To work on one profile, open Talk or Work and pick it from the profile chip there.{' '}
        <Term id="profile-scope">What is profile scope?</Term>
      </p>
    </Sheet>
  );
}

/** The app bar's profile chip: the scope of this tab, opening the switcher. On a screen locked to All profiles it opens a note that says so: there is nothing to switch. */
export function ProfileChip() {
  const { scope, mode } = useProfileScope();
  if (mode === 'all') return <SwitchChip label="All profiles" sigil="all" note />;
  return <SwitchChip label={scope === 'all' ? 'All profiles' : (scope ?? 'Profile')} sigil={scope ?? '?'} cross={mode === 'cross'} />;
}

/** The chip that opens the switcher (or, on a screen locked to All profiles, the note). Its open state lives here, so a screen with nothing to switch never holds the switcher. */
function SwitchChip({ label, sigil, cross = false, note = false }: { label: string; sigil: string; cross?: boolean; note?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="chip chip--profile appbar__profile"
        data-cross={cross ? '' : undefined}
        aria-haspopup="dialog"
        aria-label={note ? 'Profile scope: All profiles. This screen always shows every profile' : `Profile scope: ${label}. Switch profile`}
        onClick={() => setOpen(true)}
      >
        <Sigil name={sigil} size="xs" />
        <span className="truncate">{label}</span>
        <Icon name={note ? 'info' : 'chev-d'} small />
      </button>
      {open && (note ? <AllProfilesNote onClose={() => setOpen(false)} /> : <ProfileSwitcher onClose={() => setOpen(false)} />)}
    </>
  );
}
