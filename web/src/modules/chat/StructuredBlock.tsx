// A ```json or ```yaml block as a tree the owner can collapse. While the block is still arriving, or when it is not a document
// (yet), the code view stands in. The tree is the rows of `structured.ts`; YAML's parser loads when the first YAML block does.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../../icons.tsx';
import { CopyButton } from './CopyButton.tsx';
import { parseStructured, treeRows, type StructuredResult } from './structured.ts';

/** Parses the block once it has closed, and shows the tree when it is a document and `fallback` (the code view) while it is not. */
export function StructuredBlock({ lang, text, open, fallback }: { lang: 'json' | 'yaml'; text: string; open: boolean; fallback: ReactNode }) {
  const [parsed, setParsed] = useState<{ text: string; result: StructuredResult }>();
  useEffect(() => {
    if (open) return;
    let current = true;
    void parseStructured(lang, text).then((result) => current && setParsed({ text, result }));
    return () => {
      current = false;
    };
  }, [lang, text, open]);
  if (open || parsed?.text !== text || !parsed.result.ok) return fallback;
  return <TreeView lang={lang} text={text} value={parsed.result.value} />;
}

/** A parsed document as a tree of rows the owner can collapse. */
export function TreeView({ lang, text, value }: { lang: 'json' | 'yaml'; text: string; value: unknown }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => treeRows(value, collapsed), [value, collapsed]);
  const toggle = (path: string) =>
    setCollapsed((was) => {
      const next = new Set(was);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const expandable = () => treeRows(value, new Set()).flatMap((row) => (row.expandable ? [row.path] : []));
  return (
    <figure className="code rich__tree">
      <figcaption className="code__head">
        <span className="grow">{lang === 'json' ? 'JSON' : 'YAML'}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCollapsed(new Set(expandable()))}>
          Collapse all
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCollapsed(new Set())}>
          Expand all
        </button>
        <CopyButton text={text} />
      </figcaption>
      <div className="rich__tree-body" role="tree" aria-label={lang === 'json' ? 'JSON' : 'YAML'}>
        {rows.map((row) => (
          <div key={row.path} role="treeitem" aria-level={row.depth + 1} aria-expanded={row.expandable ? !row.collapsed : undefined} className="rich__node" style={{ paddingInlineStart: `calc(${row.depth} * var(--cd-space-4))` }}>
            {row.expandable ? (
              <button type="button" className="rich__toggle" onClick={() => toggle(row.path)} aria-label={`${row.collapsed ? 'Expand' : 'Collapse'} ${row.key ?? 'root'}`}>
                <Icon name={row.collapsed ? 'chev-r' : 'chev-d'} small />
              </button>
            ) : (
              <span className="rich__toggle" aria-hidden="true" />
            )}
            {row.key !== undefined && <span className="rich__key">{row.key}: </span>}
            <span className={`rich__value rich__value--${row.kind}`}>{row.preview}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
