// JSON and YAML as a collapsible tree (M1 #04): pure. `parseStructured` says whether a fenced block is a document yet (a reply
// still streaming is not, and the code view stands in), `treeRows` flattens a value into the rows a screen shows.

export type StructuredResult = { ok: true; value: unknown } | { ok: false };

/** Blocks longer than this stay code: a tree of a megabyte of JSON helps nobody. */
const MAX_TREE_CHARS = 200_000;
/** An alias flood (`&a [*b, *b …]`) is refused rather than expanded. */
const MAX_ALIASES = 50;

const container = (value: unknown): value is object => typeof value === 'object' && value !== null;

/** A document of `lang` (json or yaml). A bare scalar, a text that does not parse, and one too large are "not ready". YAML is loaded when first needed. */
export async function parseStructured(lang: 'json' | 'yaml', text: string): Promise<StructuredResult> {
  if (text.length > MAX_TREE_CHARS) return { ok: false };
  try {
    const value: unknown = lang === 'json' ? JSON.parse(text) : (await import('yaml')).parse(text, { maxAliasCount: MAX_ALIASES, uniqueKeys: true });
    return container(value) ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export type TreeKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'more';

export interface TreeRow {
  /** Unique: `$`, `$.key`, `$.list[2]`. */
  path: string;
  depth: number;
  /** The property name or array index; none for the root. */
  key: string | undefined;
  kind: TreeKind;
  /** What the row shows after the key: the value, or the size of a container. */
  preview: string;
  /** The whole value, for copying. */
  value: unknown;
  expandable: boolean;
  collapsed: boolean;
}

const PREVIEW_CHARS = 120;
/** An array or object shows this many children; the rest is summed up in one row. */
const MAX_CHILDREN = 1000;

function kindOf(value: unknown): Exclude<TreeKind, 'more'> {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

function previewOf(value: unknown, kind: TreeKind): string {
  if (kind === 'array') return `[${(value as unknown[]).length}]`;
  if (kind === 'object') {
    const size = Object.keys(value as object).length;
    return size === 0 ? '{}' : `{${size}}`;
  }
  if (kind === 'string') {
    const text = value as string;
    return JSON.stringify(text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text);
  }
  return String(value);
}

/** The rows of `value` in reading order, skipping what sits under a path in `collapsed`. */
export function treeRows(value: unknown, collapsed: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (node: unknown, path: string, depth: number, key: string | undefined) => {
    const kind = kindOf(node);
    const children = container(node) ? (Array.isArray(node) ? node.map((child, index): [string, unknown] => [String(index), child]) : Object.entries(node)) : [];
    const expandable = children.length > 0;
    const isCollapsed = expandable && collapsed.has(path);
    rows.push({ path, depth, key, kind, preview: previewOf(node, kind), value: node, expandable, collapsed: isCollapsed });
    if (!expandable || isCollapsed) return;
    for (const [name, child] of children.slice(0, MAX_CHILDREN)) visit(child, Array.isArray(node) ? `${path}[${name}]` : `${path}.${name}`, depth + 1, name);
    if (children.length > MAX_CHILDREN) rows.push({ path: `${path}…`, depth: depth + 1, key: undefined, kind: 'more', preview: `… ${children.length - MAX_CHILDREN} more`, value: undefined, expandable: false, collapsed: false });
  };
  visit(value, '$', 0, undefined);
  return rows;
}
