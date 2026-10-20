// Talk's header (M8 #09): the agent's sigil with its state, its name, the session's title, a Details button, a View menu and a More menu. Nothing else: the breadcrumb, the
// terminal button and the profile chip are gone from this screen's top bar, and what the header used to hold (Make this a task, the Chat actions) is a line
// of the More menu. On a phone a Sessions button opens the list as a sheet. What each button does is the screen's (`Chat.tsx`); the menu's lines are `talk-header.ts`'s.
// The header stays under the app bar while the thread scrolls (`talk.css`), so that a button is never half behind the bar, and it tells the conversation how tall it is
// (`--talk-header-h`) for what else sticks under it: the find bar, the Details column, the outline.
import { Fragment, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { Icon } from '../../icons.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { PopoverMenu } from '../../shell/PopoverMenu.tsx';
import { Sigil } from '../../shell/Sigil.tsx';
import { crewStateLabel, type CrewMember } from '../crew/crew-state.ts';
import { ChangeButton } from './SessionOrganiser.tsx';
import { headerControls, type ThreadActionId, type ThreadMenuEntry } from './talk-header.ts';
import './talk.css';

export interface TalkHeaderProps {
  profile: string;
  member: CrewMember | undefined;
  /** Under the name: the session's title, and where it was forked from. */
  subtitle: ReactNode;
  compact: boolean;
  /** Whether Details is open, and the id of the panel the button controls (a sheet has none until it is open). */
  detailsOpen: boolean;
  detailsControls: string;
  detailsButton: Ref<HTMLButtonElement>;
  /** How many things in the plan need the owner's eye. */
  waiting: number;
  onDetails(): void;
  onSessions(): void;
  /** The View menu (the transcript's tools and the activity mode); absent in a Fast chat, which has neither. */
  view: ReactNode | undefined;
  /** The More menu; absent until the chat has a session to act on. */
  menu: { entries: ThreadMenuEntry[]; onRun(id: ThreadActionId): void; onOpen(): void } | undefined;
}

/** After this line the menu moves from what an owner does to a chat to everything else it can do. */
const FIRST_GROUP_END: ThreadActionId = 'archive';

export function TalkHeader({ profile, member, subtitle, compact, detailsOpen, detailsControls, detailsButton, waiting, onDetails, onSessions, view, menu }: TalkHeaderProps) {
  const controls = headerControls({ compact, titled: menu !== undefined, viewable: view !== undefined });
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    const host = element?.parentElement;
    if (!element || !host) return;
    const publish = () => host.style.setProperty('--talk-header-h', `${element.getBoundingClientRect().height}px`);
    publish();
    const watch = new ResizeObserver(publish);
    watch.observe(element);
    return () => {
      watch.disconnect();
      host.style.removeProperty('--talk-header-h');
    };
  }, []);
  const opened = useRef(menu?.onOpen);
  opened.current = menu?.onOpen;
  const cut = menu?.entries.findIndex((entry) => entry.id === FIRST_GROUP_END);
  return (
    <div ref={root} className="talk__header">
      <PageHeader
        lead={
          <>
            <Sigil name={profile} size="md" state={member?.state} />
            {member && <span className="sr-only">{crewStateLabel[member.state]}.</span>}
          </>
        }
        title={profile}
        subtitle={subtitle}
        actions={
          <>
            {controls.includes('sessions') && (
              <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Sessions" aria-haspopup="dialog" onClick={onSessions}>
                <Icon name="rows" />
              </button>
            )}
            <button ref={detailsButton} type="button" className="btn btn--secondary btn--sm talk__details-button" aria-expanded={detailsOpen} aria-controls={detailsControls} onClick={onDetails}>
              <Icon name="sliders" small />
              <span className="talk__details-label">Details</span>
              {waiting > 0 && (
                <>
                  <span className="count" aria-hidden="true">
                    {waiting}
                  </span>
                  <span className="sr-only">, {waiting} open</span>
                </>
              )}
            </button>
            {controls.includes('view') && view}
            {menu && (
              <PopoverMenu
                label="More for this chat"
                align="end"
                className="talk__menu"
                onOpenChange={(open) => open && opened.current?.()}
                trigger={(props) => (
                  <button {...props} className="btn btn--ghost btn--icon btn--sm" aria-label="More for this chat">
                    <Icon name="more" />
                  </button>
                )}
              >
                {({ close }) =>
                  menu.entries.map((entry, index) => {
                    const Button = entry.writes ? ChangeButton : 'button';
                    return (
                      <Fragment key={entry.id}>
                        <Button type="button" className="pop__item" data-act={entry.id} disabled={entry.disabled !== undefined} title={entry.disabled ?? entry.sub} onClick={() => (close(true), menu.onRun(entry.id))}>
                          <Icon name={entry.icon} />
                          {entry.label}
                        </Button>
                        {cut !== undefined && cut >= 0 && index === cut && <hr className="talk__rule" />}
                      </Fragment>
                    );
                  })
                }
              </PopoverMenu>
            )}
          </>
        }
      />
    </div>
  );
}
