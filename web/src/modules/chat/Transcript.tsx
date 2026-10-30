// The transcript (M1 #04): virtualised and anchored to the end. Only the messages near the screen are in the DOM; the rest are a spacer of
// their estimated or measured height. The page scrolls (the shell is one scrolling document), so positions are measured against the window.
// The maths is `virtual-list.ts`; this is what reads the DOM for it and acts on its answers: follow the reply while the reader is at the
// end, stop when they scroll up, keep their place when older messages arrive above, and jump to latest.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../icons.tsx';
import type { ChatMessage } from './chat-session.ts';
import { ActivityFold } from './ActivityCards.tsx';
import { footerText, type ActivityMode } from './activity.ts';
import { Rich } from './Rich.tsx';
import { FailedTurn, MessageBar } from './MessageActions.tsx';
import { messageEntries, type MessageActionId, type MessageContext } from './message-actions.ts';
import { useLongPress } from './use-long-press.ts';
import { useFindHighlights, type FindView } from './use-find-highlights.ts';
import { MessageAttachments } from './MessageAttachments.tsx';
import { splitAttachments } from './message-attachments.ts';
import { FOLLOW_THRESHOLD, captureAnchor, distanceFromEnd, jumpToLatest, layoutOf, restoreAnchor, scrolled, visibleWindow, type Anchor, type FollowState } from './virtual-list.ts';
import { followsGrowth, timeLabel, useChatBehaviour } from './chat-behaviour.ts';
import { steerNote } from './requests.ts';

export interface TranscriptItem {
  key: string;
  message: ChatMessage;
  /** The reply is still arriving. */
  streaming: boolean;
  /** Where the message stands in its chat, which decides what it offers. */
  context: MessageContext;
}

/** Height assumed for a message that is not on screen and has not been measured. */
/**
 * What covers the top of the page: in Talk the header, which sticks at the shell's top (the phone's app bar, or from 600 px the card's inset and a sticky status banner), so
 * its `top` and its height. The top of a jump clears it (with a little air).
 */
const shellTop = () => {
  const header = document.querySelector<HTMLElement>('.talk__header');
  const covered = header ? parseFloat(getComputedStyle(header).top) + header.getBoundingClientRect().height : (document.querySelector('.appbar')?.getBoundingClientRect().height ?? 0);
  return covered + 8;
};

/** Where the reader is, as the DOM shows it: a message and, inside a tall one, the top-level block of it at the top of the screen (a diagram or image above it loading changes the message's height, not where the block is). */
interface DomAnchor extends Anchor {
  /** Index of the top-level block of the message at the top of the screen, and how far the top of the screen is below its start (`delta` is the same for the message). */
  block?: { index: number; delta: number } | { id: string; delta: number };
}

const ESTIMATE_PX = 140;
const OVERSCAN = 4;
const MAX_CORRECTIONS = 20;

/** A request to scroll to a message (the outline, a message link): `nonce` makes the same target a new request. */
export interface JumpRequest {
  key: string;
  /** The id of a heading inside the message to bring to the top, once the message is on screen. */
  anchor?: string;
  nonce: number;
}

export interface TranscriptProps {
  items: readonly TranscriptItem[];
  /** The composer: its top edge is the bottom edge of what the reader can see. */
  composer: React.RefObject<HTMLElement | null>;
  hasOlder: boolean;
  hasNewer: boolean;
  loadingMore: boolean;
  onLoadOlder(): void;
  onLoadNewer(): void;
  onShowLatest(): void;
  /** The message a link opened the chat at: highlighted, and scrolled to once. */
  focusKey: string | undefined;
  jump: JumpRequest | undefined;
  /** The words a search of the transcript is on, and the match the reader is at: marked on the page. */
  find?: FindView | undefined;
  /** What follows the last message (Hermes is starting…). */
  tail?: React.ReactNode;
  /** How the agent's work shows (the cards between the messages). */
  activityMode: ActivityMode;
  /** A link into a subagent's own chat. */
  openChild?: (sessionId: string) => React.ReactNode;
  /** Runs one of a message's actions (copy, edit, regenerate, fork, undo, link, make a task). Keep it stable: a new one draws every message again. */
  onAct(id: MessageActionId, item: TranscriptItem): void;
}

/** A message is drawn again only when what it shows changed: the engine makes new objects for the turn in progress at every chunk. */
const MessageView = memo(function MessageView({ item, focused, mode, openChild, onAct }: { item: TranscriptItem; focused: boolean; mode: ActivityMode; openChild: TranscriptProps['openChild']; onAct: TranscriptProps['onAct'] }) {
  if (item.message.activity) return <ActivityFold items={item.message.activity} mode={mode} openChild={openChild} />;
  return <BubbleView item={item} focused={focused} onAct={onAct} />;
}, (before, after) => before.focused === after.focused && before.item.key === after.item.key && before.item.streaming === after.item.streaming && before.item.message.text === after.item.message.text && before.item.message.stopped === after.item.message.stopped && before.item.message.failed?.error === after.item.message.failed?.error && before.item.message.note === after.item.message.note && before.item.message.activity === after.item.message.activity && before.item.message.stats === after.item.message.stats && before.item.context.last === after.item.context.last && before.item.context.busy === after.item.context.busy && before.item.context.link === after.item.context.link && before.item.context.task === after.item.context.task && before.item.context.readOnly === after.item.context.readOnly && before.mode === after.mode && before.openChild === after.openChild && before.onAct === after.onAct);

/** One message of the owner's or Hermes's: its words, what it cost, and its actions (toolbar, ⋮ and the menu a press and hold opens). */
function BubbleView({ item, focused, onAct }: { item: TranscriptItem; focused: boolean; onAct: TranscriptProps['onAct'] }) {
  const { message, streaming, key, context } = item;
  const [menu, setMenu] = useState(false);
  const { timestamps } = useChatBehaviour().device;
  const written = timestamps && message.at !== undefined ? <time className="chat__time subtle" dateTime={new Date(message.at * 1000).toISOString()}>{timeLabel(message.at, Date.now() / 1000)}</time> : null;
  const press = useLongPress(() => setMenu(true), !streaming && message.id !== undefined);
  const entries = streaming ? [] : messageEntries(message, context);
  const bar = <MessageBar entries={entries} open={menu} onOpenChange={setMenu} onRun={(id) => onAct(id, item)} />;
  if (message.note === 'continued') {
    return (
      <p className="chat__recovered subtle" role="note">
        <Icon name="refresh" small />
        Hermes picked this turn up again after it was interrupted.
      </p>
    );
  }
  if (message.note === 'steered') {
    return (
      <p className="chat__recovered subtle" role="note">
        <Icon name="steer" small />
        {steerNote(message.text)}
      </p>
    );
  }
  if (message.role === 'user') {
    const { body, attachments } = splitAttachments(message.text);
    return (
      <div className="chat__user" data-focused={focused ? '' : undefined} {...press}>
        {message.scheduled !== undefined && (
          <details className="chat__scheduled subtle">
            <summary>
              <Icon name="clock" small /> Scheduled run
            </summary>
            <p>This chat is a run of a scheduled job. Before the job’s own prompt, Hermes gave the agent these instructions:</p>
            <p className="chat__scheduled-text">{message.scheduled}</p>
          </details>
        )}
        {(body.trim() !== '' || attachments.length > 0) && (
          <div className="msg-user">
            {body.trim() !== '' && <Rich text={body} anchor={key} />}
            <MessageAttachments attachments={attachments} />
          </div>
        )}
        {written}
        {bar}
      </div>
    );
  }
  if (message.failed) {
    return (
      <div className="msg-agent" data-focused={focused ? '' : undefined} {...press}>
        <FailedTurn error={message.failed.error} retry={context.last ? () => onAct('retry', item) : undefined} busy={context.busy} />
        {bar}
      </div>
    );
  }
  return (
    <div className="msg-agent" data-focused={focused ? '' : undefined} {...press}>
      {message.text.trim() !== '' && <Rich text={message.text} streaming={streaming} anchor={key} />}
      {message.stopped && <span className="chip chat__stopped">Stopped</span>}
      {message.stats && <p className="chat__stats subtle">{footerText(message.stats)}</p>}
      {written}
      {bar}
    </div>
  );
}

export function Transcript({ items, composer, hasOlder, hasNewer, loadingMore, onLoadOlder, onLoadNewer, onShowLatest, focusKey, jump, find, tail, activityMode, openChild, onAct }: TranscriptProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<{ y: number; height: number }>();
  const [away, setAway] = useState(false);
  const follow = useRef<FollowState>({ following: true, lastTop: 0 });
  const behaviour = useChatBehaviour().device;
  const behaviourRef = useRef(behaviour);
  behaviourRef.current = behaviour;
  const opened = useRef(false);
  const anchor = useRef<DomAnchor>(undefined);
  const containerTop = useRef(0);
  const frame = useRef(0);
  /** The id of a heading to bring to the top once its message is on screen. */
  const pendingHeading = useRef<string>(undefined);
  /** Where this component last scrolled the page to: a scroll event that finds the page there is its own echo, not the reader's. */
  const pageY = useRef<number>(undefined);
  /** How many times in a row the page has been moved to keep a place with no scroll of the reader's between: a place that cannot be held (content that keeps changing size) is let go rather than chased for ever. */
  const corrections = useRef(0);

  useFindHighlights(list, find, {
    top: () => Math.max(shellTop(), document.querySelector('.chat__find')?.getBoundingClientRect().bottom ?? 0) + 8,
    bottom: () => composer.current?.getBoundingClientRect().top ?? window.innerHeight,
  });

  const keys = useMemo(() => items.map((item) => item.key), [items]);
  // `version` changes when a measured height does.
  const layout = useMemo(() => layoutOf(keys.map((key) => heights.current.get(key)), ESTIMATE_PX, 0), [keys, version]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The bottom of what the reader can see: the top edge of the composer, in viewport coordinates. */
  const visibleBottom = () => composer.current?.getBoundingClientRect().top ?? window.innerHeight;
  const docEnd = () => (end.current?.getBoundingClientRect().bottom ?? 0) + window.scrollY;
  const relativeTop = () => Math.max(0, window.scrollY - containerTop.current);
  /**
   * The message at the top of the screen, read from the DOM: what is on screen is the truth, while the layout's heights trail it by a
   * frame (a message is measured after it is drawn). The pure `captureAnchor` stands in when no message is drawn at the top.
   */
  const anchorNow = (): DomAnchor | undefined => {
    for (const element of list.current?.children ?? []) {
      const rect = element.getBoundingClientRect();
      const key = (element as HTMLElement).dataset.key;
      // What is drawn may not be what is at the top yet (the window follows the scroll a frame later): an item below the screen is no anchor.
      if (rect.top > window.innerHeight) break;
      if (rect.bottom <= 1 || key === undefined) continue;
      const blocks = [...element.querySelectorAll('.rich > *')];
      const index = rect.top < -1 ? blocks.findIndex((candidate) => candidate.getBoundingClientRect().bottom > 1) : -1;
      return { key, delta: -rect.top, ...(index >= 0 ? { block: { index, delta: -blocks[index]!.getBoundingClientRect().top } } : {}) };
    }
    return captureAnchor({ keys: keysRef.current, layout: layoutRef.current, scrollTop: relativeTop() });
  };
  // Until the page has scrolled, the window is the last screen: the transcript opens at its end.
  const top = view ? Math.max(0, window.scrollY - containerTop.current) : Math.max(0, layout.total - window.innerHeight);
  const slice = visibleWindow({ layout, scrollTop: top, viewport: view?.height ?? window.innerHeight, overscan: OVERSCAN });

  const keysRef = useRef(keys);
  const layoutRef = useRef(layout);
  const hasOlderRef = useRef(hasOlder && !loadingMore);
  const onLoadOlderRef = useRef(onLoadOlder);
  keysRef.current = keys;
  layoutRef.current = layout;
  hasOlderRef.current = hasOlder && !loadingMore;
  onLoadOlderRef.current = onLoadOlder;

  const measure = useCallback(() => {
    frame.current = 0;
    if (!list.current) return;
    containerTop.current = list.current.getBoundingClientRect().top + window.scrollY;
    const bottom = visibleBottom();
    const state = { scrollTop: window.scrollY, viewport: bottom, total: docEnd() };
    follow.current = scrolled(follow.current, state);
    setAway(!follow.current.following && distanceFromEnd(state) > FOLLOW_THRESHOLD);
    setView((was) => (was && Math.abs(was.y - window.scrollY) < 1 && was.height === window.innerHeight ? was : { y: window.scrollY, height: window.innerHeight }));
    // A scroll the page made itself (a jump, keeping a place) leaves the anchor as it was set; the reader's scroll moves it.
    const byReader = pageY.current === undefined || Math.abs(window.scrollY - pageY.current) > 1;
    pageY.current = undefined;
    if (byReader) corrections.current = 0;
    if (byReader && !follow.current.following) anchor.current = anchorNow();
    // Near the top, with more before it, because the reader scrolled there: read the page before.
    if (byReader && !follow.current.following && relativeTop() < window.innerHeight && hasOlderRef.current) onLoadOlderRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const schedule = useCallback(() => {
    if (frame.current === 0) frame.current = requestAnimationFrame(measure);
  }, [measure]);

  useEffect(() => {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame.current);
    };
  }, [schedule]);

  // Heights of what is on screen, as measured.
  const observer = useRef<ResizeObserver>(undefined);
  useEffect(() => {
    let pending = 0;
    observer.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.key;
        const height = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight);
        if (key !== undefined && heights.current.get(key) !== height) {
          heights.current.set(key, height);
          changed = true;
        }
      }
      if (changed && pending === 0) pending = requestAnimationFrame(() => ((pending = 0), setVersion((n) => n + 1)));
    });
    for (const element of list.current?.children ?? []) observer.current.observe(element);
    return () => {
      cancelAnimationFrame(pending);
      observer.current?.disconnect();
    };
  }, []);
  const observe = useCallback((element: HTMLElement | null) => {
    if (!element) return undefined;
    observer.current?.observe(element);
    return () => observer.current?.unobserve(element);
  }, []);

  // The composer's height, for what sits above it: the jump button, the cards of requests, and the queue (all in the conversation column, so it is set there).
  useEffect(() => {
    const element = composer.current;
    if (!element) return;
    const host = element.closest<HTMLElement>('.chat__main') ?? wrap.current;
    const update = () => host?.style.setProperty('--composer-h', `${element.getBoundingClientRect().height}px`);
    update();
    const watch = new ResizeObserver(update);
    watch.observe(element);
    return () => watch.disconnect();
  }, [composer]);

  // After every change of layout: follow the reply, or keep the reader's place.
  useLayoutEffect(() => {
    if (!list.current) return;
    containerTop.current = list.current.getBoundingClientRect().top + window.scrollY;
    // The first layout of a transcript opens it at its end whatever the setting; after that only a reader at the end is followed, and only with auto-follow on.
    const opening = !opened.current;
    opened.current = opened.current || list.current.childElementCount > 0;
    if (opening || followsGrowth({ autoFollow: behaviourRef.current.autoFollow, following: follow.current.following })) {
      const target = docEnd() - visibleBottom();
      if (Math.abs(target - window.scrollY) > 1) {
        window.scrollTo({ top: target, behavior: 'instant' });
        pageY.current = window.scrollY;
      }
      follow.current = { following: true, lastTop: window.scrollY };
    } else if (anchor.current) {
      // Where the anchored message is now, against where it was on screen: move the page by the difference. A message that is not drawn is placed by the layout.
      const item = [...(list.current?.children ?? [])].find((child) => (child as HTMLElement).dataset.key === anchor.current?.key);
      const at = anchor.current.block;
      const block = !at ? undefined : 'id' in at ? document.getElementById(at.id) : item?.querySelectorAll('.rich > *')[at.index];
      const move = block && at
        ? block.getBoundingClientRect().top + at.delta
        : item
          ? item.getBoundingClientRect().top + anchor.current.delta
          : (restoreAnchor(anchor.current, keys, layout) ?? Number.NaN) + containerTop.current - window.scrollY;
      if (Math.abs(move) > 1 && corrections.current++ < MAX_CORRECTIONS) {
        window.scrollBy({ top: move, behavior: 'instant' });
        pageY.current = window.scrollY;
        follow.current = { ...follow.current, lastTop: window.scrollY };
      }
    }
    // A jump to a heading inside a message waits until the message is on screen, then takes the heading to the top.
    if (pendingHeading.current) {
      const heading = document.getElementById(pendingHeading.current);
      if (heading) {
        pendingHeading.current = undefined;
        window.scrollTo({ top: heading.getBoundingClientRect().top + window.scrollY - shellTop(), behavior: 'instant' });
        pageY.current = window.scrollY;
        // The heading stays where it was put while the blocks above it settle (a diagram drawn, a formula typeset).
        const item = heading.closest<HTMLElement>('[data-key]');
        if (item) anchor.current = { key: item.dataset.key!, delta: -item.getBoundingClientRect().top, block: { id: heading.id, delta: -heading.getBoundingClientRect().top } };
      }
    }
    setAway(!follow.current.following && distanceFromEnd({ scrollTop: window.scrollY, viewport: visibleBottom(), total: docEnd() }) > FOLLOW_THRESHOLD);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, keys, slice.start, slice.end, items.at(-1)?.message.text, tail]);

  // A request to scroll to a message (the outline), or the message a link names.
  const handled = useRef<number | string>(undefined);
  useLayoutEffect(() => {
    const target = jump ? jump.key : focusKey;
    const token = jump ? jump.nonce : focusKey;
    if (target === undefined || handled.current === token || !keys.includes(target)) return;
    handled.current = token;
    follow.current = { following: false, lastTop: Number.POSITIVE_INFINITY };
    corrections.current = 0;
    anchor.current = { key: target, delta: -shellTop() };
    pendingHeading.current = jump?.anchor ? `${jump.key}-${jump.anchor}` : undefined;
    setVersion((n) => n + 1);
  }, [jump, focusKey, keys]);

  const toLatest = () => {
    if (hasNewer) onShowLatest();
    follow.current = jumpToLatest({ total: docEnd(), viewport: visibleBottom() });
    anchor.current = undefined;
    setAway(false);
    setVersion((n) => n + 1);
  };

  const rendered = items.slice(slice.start, slice.end);
  return (
    <div ref={wrap} className="chat__transcript-wrap" data-density={behaviour.transcriptDensity}>
      {hasOlder && (
        <button type="button" className="btn btn--secondary btn--sm chat__more" onClick={onLoadOlder} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load earlier messages'}
        </button>
      )}
      <div ref={list} className="chat__transcript" role="log" aria-label="Messages" aria-live="off" style={{ paddingBlockStart: slice.before, paddingBlockEnd: slice.after }}>
        {rendered.map((item) => (
          <div key={item.key} ref={observe} data-key={item.key} className="chat__item">
            <MessageView item={item} focused={item.key === focusKey} mode={activityMode} openChild={openChild} onAct={onAct} />
          </div>
        ))}
      </div>
      {hasNewer && (
        <button type="button" className="btn btn--secondary btn--sm chat__more" onClick={onLoadNewer} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load later messages'}
        </button>
      )}
      {tail}
      <div ref={end} className="chat__end" />
      {(away || hasNewer) && (
        <button type="button" className="btn btn--secondary chat__jump" onClick={toLatest}>
          <Icon name="chev-d" />
          Jump to latest
        </button>
      )}
    </div>
  );
}
