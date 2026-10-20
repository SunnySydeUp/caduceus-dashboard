// What the owner can do with words selected in one of Hermes's replies (M1 #09): Reply with selection (quotes it into the message box) and the Refine
// chips (shorter, simpler, more detail…), which send a follow-up about it. With a mouse or a keyboard they are a small toolbar by the selection; on a
// phone, where the system's own selection menu is already there, a bar above the message box opens them as a menu. The rules are `selection-actions.ts`.
//
// Keyboard: select text in a reply (Shift + arrows, or double-click), then press Alt + Enter to move into the toolbar; ← → move along it, Enter chooses,
// Escape closes it and gives the focus back to where it was.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { REFINEMENTS, selectedText, type Refinement } from './selection-actions.ts';

export interface SelectionHandlers {
  /** Reply with selection: the quote goes into the message box. */
  onReply(selection: string): void;
  /** A refine chip: the follow-up is sent. */
  onRefine(chip: Refinement, selection: string): void;
}

interface Selected {
  text: string;
  rect: { top: number; bottom: number; left: number; width: number };
}

/** How long the selection has to hold still before the actions show: a drag, and the handles of a touch selection, change it continuously. */
const SETTLE_MS = 180;
const GAP_PX = 8;

/** The reply the whole selection is inside, if it is in one. */
function replyOf(selection: Selection): Element | undefined {
  if (selection.rangeCount === 0 || selection.isCollapsed) return undefined;
  const range = selection.getRangeAt(0);
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const reply = start?.closest('.msg-agent');
  return reply && reply.contains(range.endContainer) ? reply : undefined;
}

function useSelectedReply(): Selected | undefined {
  const [selected, setSelected] = useState<Selected>();
  useEffect(() => {
    let timer: number | undefined;
    const read = () => {
      const selection = window.getSelection();
      const reply = selection ? replyOf(selection) : undefined;
      const text = reply && selection ? selectedText(selection.toString()) : undefined;
      if (!selection || !reply || text === undefined) {
        setSelected(undefined);
        return;
      }
      const { top, bottom, left, width } = selection.getRangeAt(0).getBoundingClientRect();
      setSelected({ text, rect: { top, bottom, left, width } });
    };
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, SETTLE_MS);
    };
    document.addEventListener('selectionchange', soon);
    // The toolbar follows the selection when the page scrolls.
    window.addEventListener('scroll', soon, { passive: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('selectionchange', soon);
      window.removeEventListener('scroll', soon);
    };
  }, []);
  return selected;
}

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => matchMedia('(pointer: coarse)').matches);
  useEffect(() => {
    const query = matchMedia('(pointer: coarse)');
    const change = () => setCoarse(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return coarse;
}

export function SelectionActions({ composer, onReply, onRefine }: SelectionHandlers & { composer: RefObject<HTMLElement | null> }) {
  const selected = useSelectedReply();
  const coarse = useCoarsePointer();
  const [menu, setMenu] = useState(false);
  // The selection's text is kept while the sheet is open: opening it moves the focus, and the browser may drop the selection.
  const [held, setHeld] = useState<string>();
  const toolbar = useRef<HTMLDivElement>(null);
  const before = useRef<Element | null>(null);

  const reply = (text: string) => {
    window.getSelection()?.removeAllRanges();
    onReply(text);
  };
  const refine = (chip: Refinement, text: string) => {
    window.getSelection()?.removeAllRanges();
    onRefine(chip, text);
  };

  // Alt + Enter moves into the toolbar, Escape out of it.
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Enter' && event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        before.current = document.activeElement;
        if (coarse) setMenu(true);
        else toolbar.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, coarse]);

  const onToolbarKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll('button')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      buttons[(at + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      (before.current as HTMLElement | null)?.focus?.();
    }
  };

  // The toolbar goes above the selection, or below it when there is no room, and stays inside the window.
  const [place, setPlace] = useState<{ top: number; left: number }>();
  useLayoutEffect(() => {
    const bar = toolbar.current;
    if (!selected || !bar || coarse) return;
    const { width, height } = bar.getBoundingClientRect();
    const above = selected.rect.top - height - GAP_PX;
    const top = above >= GAP_PX ? above : selected.rect.bottom + GAP_PX;
    const left = Math.min(Math.max(GAP_PX, selected.rect.left + selected.rect.width / 2 - width / 2), window.innerWidth - width - GAP_PX);
    setPlace({ top, left });
  }, [selected, coarse]);

  if (!selected && !menu) return null;
  const text = held ?? selected?.text;
  if (text === undefined) return null;

  if (coarse) {
    // The composer's top edge is where the bar sits: just above the message box.
    const bottom = composer.current ? window.innerHeight - composer.current.getBoundingClientRect().top + GAP_PX : GAP_PX;
    return (
      <>
        {selected && !menu && (
          <div className="selbar" style={{ insetBlockEnd: `${bottom}px` }}>
            <button
              type="button"
              className="btn btn--secondary"
              aria-haspopup="dialog"
              onClick={() => {
                setHeld(selected.text);
                setMenu(true);
              }}
            >
              <Icon name="chat" />
              Ask about the selection
            </button>
          </div>
        )}
        {menu && (
          <Sheet
            title="The selected text"
            onClose={() => {
              setMenu(false);
              setHeld(undefined);
            }}
          >
            <p className="selbar__quote">{text.length > 160 ? `${text.slice(0, 160)}…` : text}</p>
            <ul className="sl-acts">
              <li>
                <button
                  type="button"
                  className="sl-act"
                  onClick={() => {
                    setMenu(false);
                    setHeld(undefined);
                    reply(text);
                  }}
                >
                  <Icon name="chat" />
                  <span>
                    <span>Reply with selection</span>
                    <small>Quote it in your message</small>
                  </span>
                </button>
              </li>
              {REFINEMENTS.map((chip) => (
                <li key={chip.id}>
                  <button
                    type="button"
                    className="sl-act"
                    onClick={() => {
                      setMenu(false);
                      setHeld(undefined);
                      refine(chip, text);
                    }}
                  >
                    <Icon name="send" />
                    <span>
                      <span>{chip.label}</span>
                      <small>{chip.ask}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Sheet>
        )}
      </>
    );
  }

  return (
    <div
      ref={toolbar}
      className="seltool"
      role="toolbar"
      aria-label="Actions for the selected text"
      aria-keyshortcuts="Alt+Enter"
      style={{ insetBlockStart: `${place?.top ?? -1000}px`, insetInlineStart: `${place?.left ?? 0}px` }}
      // The press must not clear the selection it acts on.
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={onToolbarKey}
    >
      <button type="button" className="chip seltool__reply" onClick={() => reply(text)}>
        <Icon name="chat" />
        Reply
      </button>
      {REFINEMENTS.map((chip) => (
        <button key={chip.id} type="button" className="chip" title={chip.ask} onClick={() => refine(chip, text)}>
          {chip.label}
        </button>
      ))}
    </div>
  );
}
