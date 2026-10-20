// The inline parts of a message (M1 #04): text styling, links, inline maths and media. Split from `Rich.tsx` so that the table
// cells, which hold inline content too, do not import the block renderer that imports them.
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../icons.tsx';
import type { Inline, MediaKind } from './markdown.ts';
import { Lightbox } from './Lightbox.tsx';
import { renderMath } from './renderers.ts';

/** The result of an async render for the inputs given, `undefined` until it settles (and when it fails). */
export function useRendered<T>(render: () => Promise<T>, inputs: readonly unknown[], enabled = true): T | undefined {
  const [result, setResult] = useState<{ inputs: readonly unknown[]; value: T }>();
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    render().then(
      (value) => current && setResult({ inputs, value }),
      () => current && setResult(undefined),
    );
    return () => {
      current = false;
    };
    // `inputs` is the dependency list of the render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...inputs, enabled]);
  return result && result.inputs.every((value, index) => Object.is(value, inputs[index])) ? result.value : undefined;
}

export function MathView({ tex, display, open }: { tex: string; display: boolean; open: boolean }) {
  const html = useRendered(() => renderMath(tex, display), [tex, display], !open);
  if (html === undefined) return display ? <pre className="rich__math-source" tabIndex={0}><code>{tex}</code></pre> : <code className="rich__math-source">{tex}</code>;
  return <span className={display ? 'rich__math rich__math--display' : 'rich__math'} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MediaBlock({ kind, src, alt, inline = false }: { kind: MediaKind; src: string; alt: string; inline?: boolean }) {
  const [zoomed, setZoomed] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  switch (kind) {
    case 'image':
      if (inline) {
        return (
          <span className="rich__inline-media">
            <button type="button" className="rich__image-button" onClick={() => setZoomed(true)} aria-label={alt ? `Open image larger: ${alt}` : 'Open image larger'}>
              <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" className="rich__image rich__image--inline" />
            </button>
            {zoomed && <Lightbox src={src} alt={alt} onClose={() => setZoomed(false)} />}
          </span>
        );
      }
      return (
        <figure className="rich__media">
          <button type="button" className="rich__image-button" onClick={() => setZoomed(true)} aria-label={alt ? `Open image larger: ${alt}` : 'Open image larger'}>
            <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" className="rich__image" />
          </button>
          {alt && <figcaption className="subtle rich__caption">{alt}</figcaption>}
          {zoomed && <Lightbox src={src} alt={alt} onClose={() => setZoomed(false)} />}
        </figure>
      );
    case 'audio':
      return (
        <figure className="rich__media">
          <audio controls preload="none" src={src} className="rich__audio" aria-label={alt || 'Audio'} />
          {alt && <figcaption className="subtle rich__caption">{alt}</figcaption>}
        </figure>
      );
    case 'video':
      return (
        <figure className="rich__media">
          <video controls preload="metadata" playsInline src={src} className="rich__video" aria-label={alt || 'Video'} />
          {alt && <figcaption className="subtle rich__caption">{alt}</figcaption>}
        </figure>
      );
    case 'pdf':
      return (
        <figure className="rich__media rich__pdf">
          <div className="code__head">
            <Icon name="file" small />
            <span className="grow">{alt || 'PDF document'}</span>
            <button type="button" className="btn btn--ghost btn--sm" aria-expanded={showPdf} onClick={() => setShowPdf((shown) => !shown)}>
              {showPdf ? 'Hide preview' : 'Preview'}
            </button>
            <a className="btn btn--ghost btn--sm" href={src} target="_blank" rel="noopener noreferrer">
              Open
            </a>
          </div>
          {showPdf && (
            <object className="rich__frame rich__frame--pdf" data={src} type="application/pdf" aria-label={alt || 'PDF document'}>
              <p className="subtle rich__note">
                This browser cannot show the PDF here. <a href={src} target="_blank" rel="noopener noreferrer">Open it in a new tab</a>.
              </p>
            </object>
          )}
        </figure>
      );
  }
}

function InlineView({ node }: { node: Inline }): ReactNode {
  switch (node.t) {
    case 'text':
      return node.text;
    case 'br':
      return <br />;
    case 'code':
      return <code>{node.text}</code>;
    case 'em':
      return <em>{node.children.map((child, index) => <InlineView key={index} node={child} />)}</em>;
    case 'strong':
      return <strong>{node.children.map((child, index) => <InlineView key={index} node={child} />)}</strong>;
    case 'del':
      return <del>{node.children.map((child, index) => <InlineView key={index} node={child} />)}</del>;
    case 'link': {
      const external = /^[a-z][a-z0-9+.-]*:/i.test(node.href);
      return (
        <a href={node.href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {node.children.map((child, index) => <InlineView key={index} node={child} />)}
        </a>
      );
    }
    case 'image':
      return <MediaBlock kind="image" src={node.src} alt={node.alt} inline />;
    case 'math':
      return <MathView tex={node.tex} display={false} open={false} />;
  }
}

export const Inlines = ({ nodes }: { nodes: readonly Inline[] }) => nodes.map((node, index) => <InlineView key={index} node={node} />);

