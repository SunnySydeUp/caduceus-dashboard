// The composer's popovers (M8 #09 step A): the shared `PopoverMenu`, with what a popover that opens over a page needs. It measures the room above the composer so the panel
// scrolls instead of running under the app bar (`pop-room.ts`), and, like a modal menu, it makes the rest of the page inert while it is open: nothing under the panel can be
// reached or hit by a stray tap, and a press on it still closes the panel (the press is heard on the document). Escape, focus return and Tab-out are `PopoverMenu`'s.
import { useEffect, useRef } from 'react';
import { PopoverMenu, type PopoverMenuProps } from '../../shell/PopoverMenu.tsx';
import { measureRoom } from './pop-room.ts';

/** Marks everything outside the path from `keep` to the page's root as inert; returns how to undo it. */
function isolate(keep: HTMLElement): () => void {
  const marked: HTMLElement[] = [];
  for (let node: HTMLElement = keep; node.parentElement; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert && sibling.tagName !== 'SCRIPT') {
        sibling.inert = true;
        marked.push(sibling);
      }
    }
  }
  return () => marked.forEach((element) => (element.inert = false));
}

export function ComposerPopover({ trigger, onOpenChange, ...rest }: PopoverMenuProps) {
  const button = useRef<HTMLButtonElement | null>(null);
  const release = useRef<() => void>(undefined);
  // A screen that goes while a panel is open must not leave the page inert.
  useEffect(() => () => release.current?.(), []);
  return (
    <PopoverMenu
      {...rest}
      onOpenChange={(open) => {
        release.current?.();
        const anchor = button.current?.closest<HTMLElement>('.pop');
        release.current = open && anchor ? isolate(anchor) : undefined;
        onOpenChange?.(open);
      }}
      trigger={(props, state) =>
        trigger(
          {
            ...props,
            ref: (element) => {
              button.current = element;
              if (typeof props.ref === 'function') props.ref(element);
              else if (props.ref) props.ref.current = element;
            },
            onClick: () => {
              if (button.current) measureRoom(button.current);
              props.onClick();
            },
          },
          state,
        )
      }
    />
  );
}
