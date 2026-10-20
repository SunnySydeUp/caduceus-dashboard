// A message as rich content (M1 #04): the Markdown tree (`markdown.ts`) as elements. Every element is built from the tree, so text is
// text (React escapes it), a link or media URL has already passed `safeUrl`, and nothing the reply wrote reaches the page as markup.
// The only strings set as markup are the output of the highlighter and of KaTeX, from escaped text; a diagram is an `<img>`, and an
// HTML preview a sandboxed frame. Highlighting, maths and diagrams are loaded when the first message needs them (`renderers.ts`).
import { memo, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../../icons.tsx';
import { CopyButton } from './CopyButton.tsx';
import { HTML_SANDBOX, htmlPreviewDocument } from './embeds.ts';
import { classifyFence, parseMarkdown, type Block } from './markdown.ts';
import { DataTable } from './DataTable.tsx';
import { Lightbox } from './Lightbox.tsx';
import { Inlines, MathView, MediaBlock, useRendered } from './RichInline.tsx';
import { highlightCode, renderMermaid } from './renderers.ts';
import { StructuredBlock } from './StructuredBlock.tsx';

function PlainCode({ text, html }: { text: string; html?: string }) {
  return (
    <pre tabIndex={0}>
      {html === undefined ? <code>{text}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}
    </pre>
  );
}

export function CodeBlock({ lang, text, open }: { lang: string; text: string; open: boolean }) {
  // Highlighting waits for the block to close: a block still arriving is shown as it is, then coloured once.
  const html = useRendered(() => highlightCode(lang, text), [lang, text], !open && lang !== '');
  return (
    <figure className="code rich__code">
      <figcaption className="code__head">
        <span className="grow">{lang || 'text'}</span>
        <CopyButton text={text} />
      </figcaption>
      <PlainCode text={text} html={html} />
    </figure>
  );
}

function MermaidBlock({ source, open }: { source: string; open: boolean }) {
  const [zoomed, setZoomed] = useState(false);
  const drawn = useRendered(() => renderMermaid(source), [source], !open);
  if (drawn?.ok !== true) {
    return (
      <div className="rich__diagram">
        <CodeBlock lang="mermaid" text={source} open={open} />
        {drawn?.ok === false && <p className="subtle rich__note">This diagram could not be drawn, so its source is shown.</p>}
      </div>
    );
  }
  return (
    <figure className="rich__diagram">
      <button type="button" className="rich__image-button" onClick={() => setZoomed(true)} aria-label="Open the diagram larger">
        <img src={drawn.src} alt="Diagram" width={drawn.width} height={drawn.height} className="rich__diagram-image" />
      </button>
      {zoomed && <Lightbox src={drawn.src} alt="Diagram" onClose={() => setZoomed(false)} />}
    </figure>
  );
}

function HtmlPreview({ html, open }: { html: string; open: boolean }) {
  const [source, setSource] = useState(false);
  if (open || source) {
    return (
      <div className="rich__html">
        <CodeBlock lang="html" text={html} open={open} />
        {!open && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setSource(false)}>
            Show preview
          </button>
        )}
      </div>
    );
  }
  return (
    <figure className="rich__html">
      <figcaption className="code__head">
        <span className="grow">HTML preview</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSource(true)}>
          <Icon name="code" small />
          Source
        </button>
      </figcaption>
      <iframe className="rich__frame" title="HTML preview" sandbox={HTML_SANDBOX} srcDoc={htmlPreviewDocument(html)} loading="lazy" referrerPolicy="no-referrer" />
    </figure>
  );
}

function BlockView({ block, anchor }: { block: Block; anchor: string; source?: string }): ReactNode {
  switch (block.t) {
    case 'paragraph':
      return (
        <p>
          <Inlines nodes={block.children} />
        </p>
      );
    case 'heading': {
      const Tag = `h${Math.min(6, block.level + 1)}` as 'h2';
      return (
        <Tag id={`${anchor}-${block.id}`} className="rich__heading">
          <Inlines nodes={block.children} />
        </Tag>
      );
    }
    case 'code':
      switch (classifyFence(block.lang)) {
        case 'mermaid':
          return <MermaidBlock source={block.text} open={block.open} />;
        case 'json':
        case 'yaml':
          return <StructuredBlock lang={classifyFence(block.lang) as 'json' | 'yaml'} text={block.text} open={block.open} fallback={<CodeBlock lang={block.lang} text={block.text} open={block.open} />} />;
        case 'html':
          return <HtmlPreview html={block.text} open={block.open} />;
        default:
          return <CodeBlock lang={block.lang} text={block.text} open={block.open} />;
      }
    case 'math':
      return <MathView tex={block.tex} display open={block.open} />;
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag start={block.ordered && block.start !== 1 ? block.start : undefined}>
          {block.items.map((item, index) => (
            <li key={index} className={item.checked === undefined ? undefined : 'rich__task'}>
              {item.checked !== undefined && (
                <span className="rich__check" role="img" aria-label={item.checked ? 'Done' : 'Not done'} data-checked={item.checked ? '' : undefined}>
                  {item.checked && <Icon name="check" small />}
                </span>
              )}
              <div className="rich__item">
                {item.blocks.map((child, childIndex) => (
                  <BlockView key={childIndex} block={child} anchor={anchor} />
                ))}
              </div>
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote>
          {block.children.map((child, index) => (
            <BlockView key={index} block={child} anchor={anchor} />
          ))}
        </blockquote>
      );
    case 'table':
      return <DataTable table={block} />;
    case 'rule':
      return <hr />;
    case 'media':
      return <MediaBlock kind={block.kind} src={block.src} alt={block.alt} />;
  }
}

/** A top-level block is drawn again only when its own text changed: while a reply streams, the blocks before the last stay as they are. */
const Memoised = memo(BlockView, (before, after) => before.source === after.source && before.anchor === after.anchor && openOf(before.block) === openOf(after.block));

const openOf = (block: Block) => ('open' in block ? block.open : false);

/**
 * Message text as rich content. `streaming`: the reply is still arriving, so what is unfinished is shown as it stands.
 * `anchor` prefixes the ids of the headings (the message's key), so that the outline can scroll to one.
 */
export function Rich({ text, streaming = false, anchor }: { text: string; streaming?: boolean; anchor: string }) {
  const parsed = useMemo(() => parseMarkdown(text, { streaming }), [text, streaming]);
  return (
    <div className="rich">
      {parsed.blocks.map((block, index) => (
        <Memoised key={index} block={block} anchor={anchor} source={parsed.sources[index] ?? ''} />
      ))}
    </div>
  );
}
