import { useState, type KeyboardEvent } from 'react';
import { Icon } from '../icons.tsx';
import type { ProfileSummary } from '../profile-scope.ts';
import { Sheet } from '../overlays/Sheet.tsx';
import { useConnection } from './connection.ts';
import { heartbeatWords } from './heartbeat.ts';
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

/** What the scope says on this screen: its name and sigil, whether the screen is cross-profile, and whether it is locked to All profiles (Today), where there is nothing to switch. */
function useScopeLook() {
  const { scope, mode } = useProfileScope();
  if (mode === 'all') return { label: 'All profiles', sigil: 'all', cross: false, locked: true };
  return { label: scope === 'all' ? 'All profiles' : (scope ?? 'Profile'), sigil: scope ?? '?', cross: mode === 'cross', locked: false };
}

/** The phone's app bar chip: the scope of this tab, opening the switcher. On a screen locked to All profiles it opens a note that says so: there is nothing to switch. */
export function ProfileChip() {
  const { label, sigil, cross, locked } = useScopeLook();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="chip chip--profile appbar__profile"
        data-cross={cross ? '' : undefined}
        aria-haspopup="dialog"
        aria-label={locked ? 'Profile scope: All profiles. This screen always shows every profile' : `Profile scope: ${label}. Switch profile`}
        onClick={() => setOpen(true)}
      >
        <Sigil name={sigil} size="xs" />
        <span className="truncate">{label}</span>
        <Icon name={locked ? 'info' : 'chev-d'} small />
      </button>
      {open && (locked ? <AllProfilesNote onClose={() => setOpen(false)} /> : <ProfileSwitcher onClose={() => setOpen(false)} />)}
    </>
  );
}

/**
 * The scope at the head of the side card (the sidebar's head, the rail's first item after the fold toggle): the scope's sigil, wrapped in the heartbeat ring that carries
 * the connection (steady success ring connected, steady warning ring reconnecting, dashed neutral ring offline; `shell.css`), and its name. The button opens the switcher.
 * Its name says the connection in words, so the ring is never the only way to know. On Talk the scope is the open agent; on a screen locked to All profiles (Today) it is
 * plain text with no button, because there is nothing to choose.
 */
export function ScopeButton({ placement }: { placement: 'head' | 'rail' }) {
  const { label, sigil, cross, locked } = useScopeLook();
  const status = useConnection();
  const [open, setOpen] = useState(false);
  const words = heartbeatWords(status);
  const body = (
    <>
      <span className="scope__mark" data-link={status.state}>
        <Sigil name={sigil} size="sm" />
      </span>
      <span className="scope__name">{label}</span>
    </>
  );
  if (locked) {
    return (
      <div className={`scope scope--${placement}`}>
        {body}
        <span className="sr-only">. {words}.</span>
      </div>
    );
  }
  return (
    <>
      <button type="button" className={`scope scope--${placement} scope--button`} data-cross={cross ? '' : undefined} aria-haspopup="dialog" aria-label={`Profile scope: ${label}. ${words}.`} onClick={() => setOpen(true)}>
        {body}
        {placement === 'head' && <Icon name="chev-d" small />}
      </button>
      {open && <ProfileSwitcher onClose={() => setOpen(false)} />}
    </>
  );
}
