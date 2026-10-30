// The stack of open overlay layers (sheets, dialogs, drawers). It owns what must be true of the page while any
// layer is open (mobile spec §5, §9):
// - the page behind is `inert` (so focus and assistive technology stay in the top layer), and lower layers too;
// - Escape and the browser's back button close the top layer first, one at a time;
// - every layer owns one history entry, so "back" never leaves the page while a layer is open.
//
// The `Layer` component registers itself here; nothing else touches the stack.

export interface LayerEntry {
  /** Asks the layer's owner to close it (the owner then unmounts the `Layer`). */
  requestClose(): void;
  /** Escape closes the layer unless this is `false` (confirmations that must be answered). */
  escapable: boolean;
  /** What kind of layer this is; while a `sheet` is open the page behind steps back (motion.css). */
  kind: 'sheet' | 'dialog' | 'drawer' | 'palette';
  /** The layer's root element, made inert while another layer is above it. */
  el: HTMLElement | undefined;
  /** The element that holds the layer's content; it takes focus when a layer above it closes. */
  panel: HTMLElement | undefined;
  /** What had focus before the layer opened; it gets focus back when the layer closes. */
  invoker: HTMLElement | null;
  /** Whether this layer's history entry has been pushed (it is, once any earlier layer's pop has settled). */
  pushed: boolean;
}

const stack: LayerEntry[] = [];
/** `history.go` calls that have not produced their `popstate` yet; those events are ours, not the user's. */
let expectedPops = 0;
let popWaiters: (() => void)[] = [];

/** The element that holds the whole app; it is inert while a layer is open. */
const APP_ID = 'app';

function syncPage() {
  const open = stack.length > 0;
  const app = document.getElementById(APP_ID);
  if (app) app.inert = open;
  stack.forEach((layer, index) => {
    if (layer.el) layer.el.inert = index < stack.length - 1;
  });
  document.documentElement.classList.toggle('has-overlay', open);
  setSheetDepth(stack.some((layer) => layer.kind === 'sheet'));
}

/**
 * Steps the page back behind a bottom sheet (motion.css). `clip-path` only interpolates between two shapes, so while the
 * change plays the page carries a square one (`data-sheet-motion`); it is dropped once the transitions have finished,
 * because a clip-path of any kind makes the page a stacking context.
 */
function setSheetDepth(open: boolean) {
  const root = document.documentElement;
  if (open === 'sheetOpen' in root.dataset) return;
  const body = document.querySelector('.app__body');
  // The page scales from the top of what is on screen, so the scroll position (kept while `overflow: hidden`) is its origin.
  if (open) root.style.setProperty('--sheet-scroll-y', `${window.scrollY}px`);
  root.dataset.sheetMotion = '';
  if (body) void getComputedStyle(body).clipPath;
  if (open) root.dataset.sheetOpen = '';
  else delete root.dataset.sheetOpen;
  if (!body) {
    delete root.dataset.sheetMotion;
    return;
  }
  void getComputedStyle(body).clipPath;
  void Promise.allSettled(body.getAnimations().map((animation) => animation.finished)).then(() => {
    if (open === 'sheetOpen' in root.dataset) delete root.dataset.sheetMotion;
  });
}

function flushPops() {
  const waiters = popWaiters;
  popWaiters = [];
  waiters.forEach((resolve) => resolve());
}

/** Resolves once the history entries of closed layers have been popped; await it before changing the URL. */
export function layersSettled(): Promise<void> {
  if (expectedPops === 0) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  popWaiters.push(resolve);
  return promise;
}

/** The history entries to undo: layers that pushed one. */
function goBack(count: number) {
  if (count === 0) return;
  expectedPops += 1;
  history.go(-count);
}

/** After layers closed: focus goes to the layer now on top, or back to what had focus before the first one opened. */
function restoreFocus(closed: LayerEntry[]) {
  const top = stack.at(-1);
  const target = top ? top.panel : closed.at(-1)?.invoker;
  if (target?.isConnected) target.focus({ preventScroll: true });
}

window.addEventListener('popstate', (event: PopStateEvent) => {
  if (expectedPops > 0) {
    expectedPops -= 1;
    if (expectedPops === 0) flushPops();
    return;
  }
  // The user went back (or forward): close the layers whose entries are gone.
  const keep: number = event.state?.cdLayers ?? 0;
  const closed: LayerEntry[] = [];
  while (stack.length > keep) closed.push(stack.pop()!);
  closed.forEach((layer) => layer.requestClose());
  syncPage();
  restoreFocus(closed);
});

/**
 * Small things that sit on a layer or on the page and close on Escape before any layer does: a glossary pop-up open over a
 * sheet closes alone, and the sheet stays. The most recently opened closes first.
 */
const dismissibles: (() => void)[] = [];

/** Registers something that closes on Escape; call the result when it closes some other way. */
export function openDismissible(close: () => void): () => void {
  dismissibles.push(close);
  return () => {
    const index = dismissibles.lastIndexOf(close);
    if (index >= 0) dismissibles.splice(index, 1);
  };
}

// Escape closes the newest pop-up, else the top layer; capture, so nothing underneath sees it.
document.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Escape') return;
    const popup = dismissibles.at(-1);
    const top = stack.at(-1);
    if (!popup && !top?.escapable) return;
    event.preventDefault();
    event.stopPropagation();
    if (popup) popup();
    else top?.requestClose();
  },
  true,
);

/** Opens a layer: it becomes the top of the stack and gets a history entry. Call `closeLayer` when it unmounts. */
export function openLayer(entry: Omit<LayerEntry, 'pushed'>): LayerEntry {
  const layer: LayerEntry = { ...entry, pushed: false };
  stack.push(layer);
  const push = () => {
    const index = stack.indexOf(layer);
    // Closed again before an earlier layer's pop settled.
    if (index < 0) return;
    history.pushState({ ...(history.state as object | null), cdLayers: index + 1 }, '');
    layer.pushed = true;
  };
  // A pending `history.go` from a layer that just closed would swallow a new entry: wait for it.
  if (expectedPops > 0) void layersSettled().then(push);
  else push();
  syncPage();
  return layer;
}

/**
 * A layer's owner unmounted it. Layers already closed by "back" or by `closeAllLayers` are off the stack and have
 * nothing left to do; otherwise this was the user closing it in the page, and its history entry is undone.
 */
export function closeLayer(layer: LayerEntry): void {
  const index = stack.indexOf(layer);
  if (index < 0) return;
  stack.splice(index);
  syncPage();
  restoreFocus([layer]);
  goBack(layer.pushed ? 1 : 0);
}

/** Closes every layer (before a navigation) and resolves once the history is back where it was. */
export function closeAllLayers(): Promise<void> {
  if (stack.length === 0) return layersSettled();
  const pushed = stack.filter((layer) => layer.pushed).length;
  const closed: LayerEntry[] = [];
  while (stack.length > 0) closed.push(stack.pop()!);
  closed.forEach((layer) => layer.requestClose());
  syncPage();
  restoreFocus(closed);
  goBack(pushed);
  return layersSettled();
}

/** Whether any sheet, dialog, drawer or palette is open over the page. */
export function hasOpenLayer(): boolean {
  return stack.length > 0;
}
