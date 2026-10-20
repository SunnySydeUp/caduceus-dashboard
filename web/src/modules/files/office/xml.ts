// The XML of an Office part (M7 #02) as a tree that writes itself back exactly as it was read: element names, the attribute text, the text between
// tags (still escaped), comments, CDATA and the declaration are all kept as they came. The editor changes the nodes it edits and nothing else, so a
// save of a document that was only looked at leaves every part byte for byte what it was.

export interface XmlElement {
  type: 'element';
  /** The name with its prefix: `w:p`. */
  name: string;
  /** Everything between the name and the closing `>` or `/>`, as written (`' w:rsidR="00A1"'`). */
  attrs: string;
  children: XmlNode[];
  selfClosing: boolean;
}
/** Text between tags, still escaped (`Tom &amp; Jerry`). */
export interface XmlText {
  type: 'text';
  value: string;
}
/** What is kept as written: the declaration, a comment, CDATA, a doctype. */
export interface XmlRaw {
  type: 'raw';
  value: string;
}
export type XmlNode = XmlElement | XmlText | XmlRaw;

export interface XmlDocument {
  children: XmlNode[];
}

/** The index of the `>` that ends the tag starting at `from`, skipping any `>` inside a quoted attribute value. */
function tagEnd(xml: string, from: number): number {
  let quote = '';
  for (let index = from; index < xml.length; index++) {
    const char = xml[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return index;
  }
  throw new Error('The XML ends inside a tag.');
}

/** Reads an XML part into a tree. Throws on text that is not well-formed enough to edit safely. */
export function parseXml(xml: string): XmlDocument {
  const root: XmlDocument = { children: [] };
  const open: XmlElement[] = [];
  const add = (node: XmlNode) => (open.length > 0 ? open[open.length - 1].children : root.children).push(node);
  let at = 0;
  while (at < xml.length) {
    if (xml[at] !== '<') {
      const next = xml.indexOf('<', at);
      const end = next < 0 ? xml.length : next;
      add({ type: 'text', value: xml.slice(at, end) });
      at = end;
      continue;
    }
    if (xml.startsWith('<!--', at)) {
      const end = xml.indexOf('-->', at);
      if (end < 0) throw new Error('The XML ends inside a comment.');
      add({ type: 'raw', value: xml.slice(at, end + 3) });
      at = end + 3;
    } else if (xml.startsWith('<![CDATA[', at)) {
      const end = xml.indexOf(']]>', at);
      if (end < 0) throw new Error('The XML ends inside CDATA.');
      add({ type: 'raw', value: xml.slice(at, end + 3) });
      at = end + 3;
    } else if (xml.startsWith('<?', at)) {
      const end = xml.indexOf('?>', at);
      if (end < 0) throw new Error('The XML ends inside a declaration.');
      add({ type: 'raw', value: xml.slice(at, end + 2) });
      at = end + 2;
    } else if (xml.startsWith('<!', at)) {
      const end = tagEnd(xml, at);
      add({ type: 'raw', value: xml.slice(at, end + 1) });
      at = end + 1;
    } else if (xml.startsWith('</', at)) {
      const end = xml.indexOf('>', at);
      if (end < 0) throw new Error('The XML ends inside a closing tag.');
      const name = xml.slice(at + 2, end).trim();
      const element = open.pop();
      if (!element || element.name !== name) throw new Error(`The XML closes <${name}> where <${element?.name ?? 'nothing'}> is open.`);
      at = end + 1;
    } else {
      const end = tagEnd(xml, at);
      const selfClosing = xml[end - 1] === '/';
      const inside = xml.slice(at + 1, selfClosing ? end - 1 : end);
      const split = inside.search(/[\s]/);
      const element: XmlElement = { type: 'element', name: split < 0 ? inside : inside.slice(0, split), attrs: split < 0 ? '' : inside.slice(split), children: [], selfClosing };
      add(element);
      if (!selfClosing) open.push(element);
      at = end + 1;
    }
  }
  if (open.length > 0) throw new Error(`The XML ends with <${open[open.length - 1].name}> still open.`);
  return root;
}

function write(node: XmlNode): string {
  if (node.type !== 'element') return node.value;
  if (node.selfClosing && node.children.length === 0) return `<${node.name}${node.attrs}/>`;
  return `<${node.name}${node.attrs}>${node.children.map(write).join('')}</${node.name}>`;
}

export function serializeXml(document: XmlDocument | XmlElement): string {
  return 'children' in document && !('type' in document) ? document.children.map(write).join('') : write(document as XmlElement);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Escaped text as the characters it stands for. */
export function decodeText(escaped: string): string {
  return escaped.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity] ?? whole;
  });
}

/** Characters as text that is safe between tags and inside a quoted attribute. */
export function encodeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The value of an attribute (`w:val`), decoded; `undefined` when the element has none. */
export function attr(element: XmlElement, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(element.attrs);
  return match ? decodeText(match[1] ?? match[2] ?? '') : undefined;
}

/** Sets an attribute, replacing the one that is there or adding it at the end. */
export function setAttr(element: XmlElement, name: string, value: string): void {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(\\s${escaped}\\s*=\\s*)(?:"[^"]*"|'[^']*')`);
  element.attrs = pattern.test(element.attrs) ? element.attrs.replace(pattern, (_, head: string) => `${head}"${encodeText(value)}"`) : `${element.attrs} ${name}="${encodeText(value)}"`;
}

export function isElement(node: XmlNode, name?: string): node is XmlElement {
  return node.type === 'element' && (name === undefined || node.name === name);
}

/** The children of an element that are elements (with that name, when given). */
export function childElements(element: XmlElement | XmlDocument, name?: string): XmlElement[] {
  return element.children.filter((child): child is XmlElement => isElement(child, name));
}

/** Every element below `from` called one of `names`, in document order. It does not look inside an element it has found when `shallow` is set. */
export function findAll(from: XmlElement | XmlDocument, names: readonly string[], shallow = false): XmlElement[] {
  const found: XmlElement[] = [];
  const visit = (node: XmlElement | XmlDocument) => {
    for (const child of node.children) {
      if (!isElement(child)) continue;
      if (names.includes(child.name)) {
        found.push(child);
        if (shallow) continue;
      }
      visit(child);
    }
  };
  visit(from);
  return found;
}

/** The text of an element's text children, decoded. */
export function textOf(element: XmlElement): string {
  return element.children.map((child) => (child.type === 'text' ? decodeText(child.value) : child.type === 'raw' && child.value.startsWith('<![CDATA[') ? child.value.slice(9, -3) : '')).join('');
}

/** An element with these children, written as `<name attrs>…</name>`. */
export function element(name: string, attrs = '', children: XmlNode[] = []): XmlElement {
  return { type: 'element', name, attrs, children, selfClosing: children.length === 0 };
}

export function textNode(text: string): XmlText {
  return { type: 'text', value: encodeText(text) };
}

/** A deep copy: the nodes of the copy can be changed without touching the original. */
export function clone<T extends XmlNode>(node: T): T {
  return structuredClone(node);
}

/** Removes an attribute; nothing happens when the element has none. */
export function removeAttr(element: XmlElement, name: string): void {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  element.attrs = element.attrs.replace(new RegExp(`\\s${escaped}\\s*=\\s*(?:"[^"]*"|'[^']*')`), '');
}
