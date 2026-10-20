// The transcript's tools and the activity mode (M1 #15, M8 #09): one View button in Talk's header that opens a menu with find in this chat, expand all and collapse all,
// copy the transcript, which roles to show and how much of the agent's work to show. The find bar stays at the top of the thread while the transcript scrolls, with
// the match count and next / previous. The state is `use-transcript-tools.ts`'s; which rows a chat has is `transcript-view.ts`'s.
import { useId, useState, type KeyboardEvent, type RefObject } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { PopoverMenu } from '../../shell/PopoverMenu.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { ACTIVITY_MODES, type ActivityMode } from './activity.ts';
import { MenuList } from './SessionOrganiser.tsx';
import { ROLES, rolesAnnouncement, type CopyFormat, type Role } from './transcript-tools.ts';
import { viewRows } from './transcript-view.ts';
import type { TranscriptTools as Tools } from './use-transcript-tools.ts';

type ViewTools = Pick<Tools<never>, 'roles' | 'setRole' | 'find' | 'expandAll'>;

const MODE_LABEL: Record<ActivityMode, string> = { worklog: 'Worklog', stream: 'Stream', final: 'Final only' };

export interface TranscriptViewProps {
  tools: ViewTools;
  mode: ActivityMode;
  onMode(mode: ActivityMode): void;
  assistantName: string;
  hasMessages: boolean;
  copying: boolean;
  onCopy(format: CopyFormat): void;
  /** The find bar's field, so that Find in the menu can put the cursor in it. */
  findInput: RefObject<HTMLInputElement | null>;
}

export function TranscriptView({ tools, mode, onMode, assistantName, hasMessages, copying, onCopy, findInput }: TranscriptViewProps) {
  const { roles, setRole, find, expandAll } = tools;
  const [copyMenu, setCopyMenu] = useState(false);
  const modeLabel = useId();
  const label: Record<Role, string> = { user: 'You', assistant: assistantName, tool: 'Tools', reasoning: 'Reasoning' };
  const withTools = viewRows({ hasMessages }).includes('find');

  return (
    <>
      <PopoverMenu
        label="View"
        align="end"
        className="talk__menu talk__view"
        trigger={(props) => (
          <button {...props} className="btn btn--ghost btn--icon btn--sm" aria-label="View: find, filters and agent activity">
            <Icon name="eye" />
          </button>
        )}
      >
        {({ close }) => (
          <>
            {withTools && (
              <>
                <button
                  type="button"
                  className="pop__item"
                  data-act="find"
                  onClick={() => {
                    close(true);
                    if (find.open) return find.hide();
                    find.show();
                    requestAnimationFrame(() => findInput.current?.focus());
                  }}
                >
                  <Icon name="search" />
                  {find.open ? 'Close find' : 'Find in this chat'}
                </button>
                <button type="button" className="pop__item" data-act="expand" title="Open every tool, reasoning and subagent card" onClick={() => (close(true), expandAll(true))}>
                  <Icon name="chev-d" />
                  Expand all cards
                </button>
                <button type="button" className="pop__item" data-act="collapse" title="Close every tool, reasoning and subagent card" onClick={() => (close(true), expandAll(false))}>
                  <Icon name="chev-u" />
                  Collapse all cards
                </button>
                <button type="button" className="pop__item" data-act="copy" aria-haspopup="dialog" aria-busy={copying} disabled={copying} onClick={() => (close(true), setCopyMenu(true))}>
                  <Icon name="copy" />
                  Copy chat…
                </button>
                <hr className="talk__rule" />
                <p className="pop__title">Show in the transcript</p>
                {ROLES.map((role) => (
                  <button key={role} type="button" role="switch" aria-checked={roles[role]} className="pop__item" data-act={`role-${role}`} onClick={() => setRole(role, !roles[role])}>
                    <span>{label[role]}</span>
                    <Icon name="check" small className="pop__tick" />
                  </button>
                ))}
                <hr className="talk__rule" />
              </>
            )}
            <p id={modeLabel} className="pop__title">
              Agent activity
            </p>
            <RadioGroup labelledBy={modeLabel} className="seg" value={mode} options={ACTIVITY_MODES.map((value) => ({ value, label: MODE_LABEL[value] }))} onChange={onMode} />
          </>
        )}
      </PopoverMenu>
      <p className="sr-only" role="status">
        {rolesAnnouncement(roles, assistantName)}
      </p>
      {copyMenu && (
        <Sheet title="Copy this chat" onClose={() => setCopyMenu(false)}>
          <MenuList
            entries={[
              { id: 'copy-markdown', icon: 'copy', label: 'As Markdown', sub: 'Each message as it was written, under who said it', writes: false, run: () => (setCopyMenu(false), onCopy('markdown')) },
              { id: 'copy-plain', icon: 'copy', label: 'As plain text', sub: 'The words only, with no marks', writes: false, run: () => (setCopyMenu(false), onCopy('plain')) },
            ]}
          />
          <p className="subtle">What the roles switched off in the View menu hide is left out. The whole chat is read from Hermes first.</p>
        </Sheet>
      )}
    </>
  );
}

/** Find in this chat: the bar that stays under the app bar while the transcript scrolls. Opened from the View menu, by a search hit's words, or by a link. */
export function FindBar({ find, input }: { find: ViewTools['find']; input: RefObject<HTMLInputElement | null> }) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      find.step(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      find.hide();
    }
  };
  const summary = find.query.trim() === '' ? '' : find.count === 0 ? (find.loading ? 'Reading the whole chat…' : 'No matches') : `${find.position ?? 0} of ${find.count}${find.loading ? '+' : ''}`;
  if (!find.open) return null;
  return (
    <div className="chat__find" role="search" aria-label="Find in this chat">
      <Icon name="search" />
      <input
        ref={input}
        type="search"
        className="input chat__find-input"
        aria-label="Find in this chat"
        placeholder="Find in this chat…"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        value={find.query}
        onChange={(event) => find.setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="chat__find-count" role="status" aria-live="polite">
        {summary}
      </span>
      <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Previous match" disabled={find.count === 0} onClick={() => find.step(-1)}>
        <Icon name="chev-u" />
      </button>
      <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Next match" disabled={find.count === 0} onClick={() => find.step(1)}>
        <Icon name="chev-d" />
      </button>
      <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Close find" onClick={find.hide}>
        <Icon name="x" />
      </button>
    </div>
  );
}
