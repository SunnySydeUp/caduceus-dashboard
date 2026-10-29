import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { helpSections, parseInline, resolveHelpTarget, termBlockIndex, type HelpBlock, type HelpTarget, type HelpView } from '../help.ts';
import { Icon } from '../icons.tsx';
import { Layer } from '../overlays/Layer.tsx';
import { Sheet } from '../overlays/Sheet.tsx';
import { HelpContext } from './help-context.tsx';
import { useRegistry } from './registry-context.tsx';
import { Term } from './Term.tsx';
import { useSizeClass } from './use-size-class.ts';

/** Help text with its marked glossary terms made into `Term`s. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((segment, index) =>
        'term' in segment ? (
          <Term key={index} id={segment.term}>
            {segment.text}
          </Term>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

function Block({ block }: { block: HelpBlock }) {
  if ('h' in block) return <h4>{block.h}</h4>;
  if ('p' in block) {
    return (
      <p>
        <Inline text={block.p} />
      </p>
    );
  }
  const Tag = 'ul' in block ? 'ul' : 'ol';
  return (
    <Tag>
      {('ul' in block ? block.ul : block.ol).map((item, index) => (
        <li key={index}>
          <Inline text={item} />
        </li>
      ))}
    </Tag>
  );
}

/** A row that opens another page or term: its title and one line about it. */
function TopicLink({ title, sub, onOpen }: { title: string; sub: string; onOpen(): void }) {
  return (
    <button type="button" className="help-link" onClick={onOpen}>
      <span className="help-link__text">
        <span className="help-link__title">{title}</span>
        <span className="help-link__sub">{sub}</span>
      </span>
      <Icon name="chev-r" small />
    </button>
  );
}

/** The list of topics: every page by whoever registered it, then the glossary. */
function Topics({ go, heading }: { go(target: HelpTarget): void; heading: RefObject<HTMLHeadingElement | null> }) {
  const registry = useRegistry();
  const pages = registry.helpPages();
  const owners = [...new Set(pages.map((page) => page.moduleId))];
  return (
    <article className="help-page">
      <h3 ref={heading} tabIndex={-1} data-help-heading>
        Help topics
      </h3>
      <p className="help-lead">The help for the screen you are on opens with the ? key, or the help button in the app bar. Search every page and word from search and commands.</p>
      {owners.map((owner) => (
        <section key={owner} className="help-group" aria-labelledby={`help-owner-${owner}`}>
          <h4 id={`help-owner-${owner}`}>{registry.module(owner)?.title ?? 'Caduceus'}</h4>
          <ul className="help-list">
            {pages
              .filter((page) => page.moduleId === owner)
              .map((page) => (
                <li key={page.id}>
                  <TopicLink title={page.title} sub={page.summary} onOpen={() => go({ page: page.id })} />
                </li>
              ))}
          </ul>
        </section>
      ))}
      <section className="help-group" aria-labelledby="help-glossary">
        <h4 id="help-glossary">Glossary</h4>
        <ul className="help-list">
          {registry.glossary().map((term) => (
            <li key={term.id}>
              <TopicLink title={term.term} sub={term.definition} onOpen={() => go({ term: term.id })} />
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

/** One page: the glossary term that sent you here (if one did), its title and summary, its text, and where to read next. A long page folds into sections. */
function PageView({ view, go, heading }: { view: HelpView; go(target: HelpTarget): void; heading: RefObject<HTMLHeadingElement | null> }) {
  const registry = useRegistry();
  const page = registry.helpPages().find((candidate) => candidate.id === view.page);
  const term = registry.glossary().find((candidate) => candidate.id === view.term);
  if (!page) return null;
  const related = (page.related ?? []).flatMap((id) => registry.helpPages().find((candidate) => candidate.id === id) ?? []);
  // "More" from a term's pop-up lands on the passage that uses the term, marked, not on the definition again.
  const hit = term ? page.body[termBlockIndex(page.body, term.id)] : undefined;
  const shown = (block: HelpBlock, index: number) => (block === hit ? <div key={index} className="help-hit" data-help-hit><Block block={block} /></div> : <Block key={index} block={block} />);
  const { intro, sections } = helpSections(page.body);
  return (
    <article className="help-page">
      {term && (
        <aside className="help-term" aria-label={`Meaning of ${term.term}`}>
          <strong>{term.term}</strong>
          <span>{hit ? 'Where this page uses it is marked below.' : term.definition}</span>
        </aside>
      )}
      <h3 ref={heading} tabIndex={-1} data-help-heading>
        {page.title}
      </h3>
      <p className="help-lead">{page.summary}</p>
      {sections.length === 0 ? page.body.map(shown) : intro.map(shown)}
      {sections.map((section, index) => (
        <details key={section.heading} className="help-section" open={index === 0 || section.blocks.includes(hit as HelpBlock)}>
          <summary>{section.heading}</summary>
          <div className="help-section__body">{section.blocks.map(shown)}</div>
        </details>
      ))}
      {related.length > 0 && (
        <section className="help-group" aria-labelledby="help-related">
          <h4 id="help-related">Related</h4>
          <ul className="help-list">
            {related.map((candidate) => (
              <li key={candidate.id}>
                <TopicLink title={candidate.title} sub={candidate.summary} onOpen={() => go({ page: candidate.id })} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

const TABS = ['help', 'shortcuts'] as const;
type Tab = (typeof TABS)[number];

/**
 * The help panel (M1 #02): a side panel on tablets and desktops and a sheet on phones. The Help tab shows the page for the
 * screen it was opened from (or a glossary term's page, or the list of topics), with links to related pages and a way back;
 * the Shortcuts tab holds the keyboard shortcut list, when the caller has one (the sign-in screen does not). Its glossary
 * pop-ups turn the panel's page rather than opening another panel.
 */
export function HelpPanel({ view, shortcuts: offered, onClose }: { view: HelpView; shortcuts?: ReactNode; onClose(): void }) {
  const registry = useRegistry();
  const compact = useSizeClass() === 'compact';
  const id = useId();
  // A touch screen has no keyboard to use the shortcuts with, so the tab is left out unless the panel was opened on it on purpose (the palette's Keyboard shortcuts).
  const [touch] = useState(() => matchMedia('(pointer: coarse)').matches);
  const shortcuts = offered !== undefined && (!touch || view.tab === 'shortcuts') ? offered : undefined;
  const startOnShortcuts = shortcuts !== undefined && view.tab === 'shortcuts';
  const [tab, setTab] = useState<Tab>(startOnShortcuts ? 'shortcuts' : 'help');
  // The pages shown on the Help tab, newest last, so Back goes where you came from.
  const [trail, setTrail] = useState<HelpView[]>([view.tab === 'help' ? view : { tab: 'help' }]);
  const [turned, setTurned] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = trail[trail.length - 1];

  // After the page turns, focus goes to its heading and the text starts again from the top; a page opened from a glossary term then scrolls to the passage marked for it.
  useEffect(() => {
    const scroller = heading.current?.closest<HTMLElement>('[data-body]');
    if (turned > 0) {
      heading.current?.focus({ preventScroll: true });
      if (scroller) scroller.scrollTop = 0;
    }
    scroller?.querySelector<HTMLElement>('[data-help-hit]')?.scrollIntoView({ block: 'start' });
  }, [turned]);

  const turn = (next: HelpView[]) => {
    setTab('help');
    setTrail(next);
    setTurned((count) => count + 1);
  };
  const go = (target: HelpTarget) => {
    const next = resolveHelpTarget(registry, target);
    if (next.tab === 'shortcuts') setTab('shortcuts');
    else turn([...trail, next]);
  };

  const onTabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const step = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : step === 0 ? undefined : (TABS.indexOf(tab) + step + TABS.length) % TABS.length;
    if (next === undefined) return;
    event.preventDefault();
    setTab(TABS[next]);
    document.getElementById(`${id}-tab-${TABS[next]}`)?.focus();
  };

  const helpTab = (
    <>
      {(trail.length > 1 || current.page) && (
        <div className="help-nav">
          {trail.length > 1 && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => turn(trail.slice(0, -1))}>
              <Icon name="chev-l" small />
              Back
            </button>
          )}
          {current.page && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => turn([...trail, { tab: 'help' }])}>
              All topics
            </button>
          )}
        </div>
      )}
      {current.page ? <PageView view={current} go={go} heading={heading} /> : <Topics go={go} heading={heading} />}
    </>
  );

  const content = (
    <HelpContext value={{ openHelp: go }}>
      <div className="help">
        {shortcuts ? (
          <>
            <div role="tablist" aria-label="Help panel" className="seg help-tabs" onKeyDown={onTabKeys}>
              {TABS.map((name) => (
                <button key={name} type="button" role="tab" id={`${id}-tab-${name}`} aria-selected={tab === name} aria-controls={`${id}-panel-${name}`} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)}>
                  {name === 'help' ? 'Help' : 'Shortcuts'}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`${id}-panel-help`} aria-labelledby={`${id}-tab-help`} hidden={tab !== 'help'}>
              {helpTab}
            </div>
            <div role="tabpanel" id={`${id}-panel-shortcuts`} aria-labelledby={`${id}-tab-shortcuts`} hidden={tab !== 'shortcuts'}>
              {shortcuts}
            </div>
          </>
        ) : (
          helpTab
        )}
      </div>
    </HelpContext>
  );

  // The heading is what a panel opened on a page starts on, so a screen reader reads the page; opened on the shortcuts it is the tab.
  const initialFocus = startOnShortcuts ? '[role="tab"][aria-selected="true"]' : '[data-help-heading]';
  return compact ? (
    <Sheet title="Help" detents={['full']} initialFocus={initialFocus} onClose={onClose}>
      {content}
    </Sheet>
  ) : (
    <Layer kind="drawer" panelClassName="drawer drawer--end help-panel" label="Help" initialFocus={initialFocus} onClose={onClose}>
      <header className="overlay__head">
        <h2>Help</h2>
        <button type="button" className="btn btn--ghost btn--icon" aria-label="Close help" onClick={onClose} data-close>
          <Icon name="x" />
        </button>
      </header>
      <div className="overlay__body help-panel__body" data-body>
        {content}
      </div>
    </Layer>
  );
}
