// The Office editor's model of a document (M7 #02), free of the DOM and of React. A Word or PowerPoint file is read as its paragraphs of text, an Excel
// file as the cells of its sheets (`sheets.ts`). An edit changes the part of the archive it is about and nothing else: the formatting of the paragraph's
// first run is kept for the new text, every other part of the archive and every untouched paragraph is written back as it was. This is an editor of
// text and values; page layout, pictures and charts are left exactly as they are and are not shown.
import { childElements, clone, element, findAll, isElement, textNode, textOf, type XmlDocument, type XmlElement } from './xml.ts';
import type { OfficeKind } from './kinds.ts';
import { Package } from './package.ts';
import { openSheets, type SheetDocument } from './sheets.ts';

/** A paragraph as the editor shows it. `key` stays the same for as long as the document is open, however paragraphs are added or removed. */
export interface ParagraphView {
  key: number;
  text: string;
  /** Where it is, in words: `Table` for a cell of a table (Word), `Slide 2` (PowerPoint), nothing for the body of a Word document. */
  where: string;
}

/** A Word or PowerPoint document as paragraphs of text. */
export interface TextDocument {
  kind: 'docx' | 'pptx';
  paragraphs(): ParagraphView[];
  /** Replaces a paragraph's text; its first run's formatting is kept. A paragraph given the text it already has is not touched. */
  setText(key: number, text: string): void;
  /** Adds a paragraph with the same paragraph formatting after another, and gives its key. */
  addAfter(key: number, text: string): number;
  /** Removes a paragraph, unless it holds a picture, a section break or is the last one in its cell or text box; says whether it did. */
  remove(key: number): boolean;
  save(): Uint8Array;
}

/** The names a document format gives the parts of a paragraph. */
interface Dialect {
  paragraph: string;
  run: string;
  text: string;
  runProperties: string;
  paragraphProperties: string;
}
const WORD: Dialect = { paragraph: 'w:p', run: 'w:r', text: 'w:t', runProperties: 'w:rPr', paragraphProperties: 'w:pPr' };
const SLIDE: Dialect = { paragraph: 'a:p', run: 'a:r', text: 'a:t', runProperties: 'a:rPr', paragraphProperties: 'a:pPr' };

/** What a Word run holds as text, and what that is as characters. */
const WORD_TEXT_PARTS = ['w:t', 'w:tab', 'w:br', 'w:cr', 'w:noBreakHyphen'];
/** Word elements whose text is not the paragraph's own: its formatting, pictures and text boxes. */
const WORD_NOT_TEXT = ['w:pPr', 'w:rPr', 'w:drawing', 'w:pict', 'w:object', 'mc:AlternateContent'];

/** A page or column break is formatting, not text: only a plain break is a line break. */
const isLineBreak = (node: XmlElement) => node.name === 'w:cr' || (node.name === 'w:br' && !/w:type\s*=\s*"(page|column)"/.test(node.attrs));
const isWordText = (node: XmlElement) => WORD_TEXT_PARTS.includes(node.name) && (node.name !== 'w:br' || isLineBreak(node));

interface Located {
  node: XmlElement;
  parent: XmlElement;
}

/** The runs of a Word paragraph that hold text, in order, each with the element it sits in. */
function wordTextRuns(paragraph: XmlElement): Located[] {
  const found: Located[] = [];
  const visit = (parent: XmlElement) => {
    for (const child of childElements(parent)) {
      if (WORD_NOT_TEXT.includes(child.name)) continue;
      if (child.name === 'w:r') {
        if (childElements(child).some(isWordText)) found.push({ node: child, parent });
      } else visit(child);
    }
  };
  visit(paragraph);
  return found;
}

function wordText(paragraph: XmlElement): string {
  let text = '';
  const visit = (parent: XmlElement) => {
    for (const child of childElements(parent)) {
      if (WORD_NOT_TEXT.includes(child.name)) continue;
      if (child.name === 'w:t') text += textOf(child);
      else if (child.name === 'w:tab') text += '\t';
      else if (child.name === 'w:noBreakHyphen') text += '-';
      else if (child.name === 'w:br' || child.name === 'w:cr') text += isLineBreak(child) ? '\n' : '';
      else visit(child);
    }
  };
  visit(paragraph);
  return text;
}

/** The Word elements that make `text`: runs of characters, tabs and line breaks. */
function wordContent(text: string): XmlElement[] {
  return text.split(/(\t|\n)/).flatMap((piece) => {
    if (piece === '\t') return [element('w:tab')];
    if (piece === '\n') return [element('w:br')];
    return piece === '' ? [] : [element('w:t', ' xml:space="preserve"', [textNode(piece)])];
  });
}

function setWordText(paragraph: XmlElement, text: string): void {
  const runs = wordTextRuns(paragraph);
  if (runs.length === 0) {
    paragraph.children.push(element('w:r', '', wordContent(text)));
    paragraph.selfClosing = false;
    return;
  }
  runs.forEach(({ node, parent }, index) => {
    const at = node.children.findIndex((child) => isElement(child) && isWordText(child));
    node.children = node.children.filter((child) => !(isElement(child) && isWordText(child)));
    if (index === 0) node.children.splice(at, 0, ...wordContent(text));
    else if (childElements(node).every((child) => child.name === 'w:rPr')) parent.children.splice(parent.children.indexOf(node), 1);
    node.selfClosing = node.children.length === 0;
  });
}

function setSlideText(paragraph: XmlElement, text: string): void {
  const parts = childElements(paragraph).filter((child) => ['a:r', 'a:br', 'a:fld'].includes(child.name));
  const model = parts.find((part) => part.name !== 'a:br') ?? parts[0];
  const properties = model && childElements(model, 'a:rPr')[0];
  const at = parts.length > 0 ? paragraph.children.indexOf(parts[0]) : paragraph.children.findIndex((child) => isElement(child, 'a:endParaRPr'));
  paragraph.children = paragraph.children.filter((child) => !parts.includes(child as XmlElement));
  const lines = text.split('\n');
  const fresh = lines.flatMap((line, index) => [
    ...(index > 0 ? [element('a:br', '', properties ? [clone(properties)] : [])] : []),
    ...(line === '' ? [] : [element('a:r', '', [...(properties ? [clone(properties)] : []), element('a:t', '', [textNode(line)])])]),
  ]);
  paragraph.children.splice(at < 0 ? paragraph.children.length : at, 0, ...fresh);
  paragraph.selfClosing = paragraph.children.length === 0;
}

function slideText(paragraph: XmlElement): string {
  return childElements(paragraph)
    .map((child) => (child.name === 'a:br' ? '\n' : child.name === 'a:r' || child.name === 'a:fld' ? childElements(child, 'a:t').map(textOf).join('') : ''))
    .join('');
}

/** A paragraph that holds something the editor does not show (a picture, a section break) is not removed. */
const hasMore = (paragraph: XmlElement) => findAll(paragraph, ['w:drawing', 'w:pict', 'w:object', 'w:sectPr', 'a:fld']).length > 0;

interface Entry {
  key: number;
  part: string;
  paragraph: XmlElement;
  parent: XmlElement;
  where: string;
}

/** The slides of a presentation in the order it shows them: the order of its slide list, with the part each is stored in. */
function slideParts(pack: Package): string[] {
  const presentation = pack.xml('ppt/presentation.xml');
  const relationships = pack.xml('ppt/_relationships/presentation.xml.rels') ?? pack.xml('ppt/_rels/presentation.xml.rels');
  const targets = new Map(findAll(relationships ?? { children: [] }, ['Relationship']).map((relationship) => [/\sId="([^"]*)"/.exec(relationship.attrs)?.[1], /\sTarget="([^"]*)"/.exec(relationship.attrs)?.[1]]));
  const listed = presentation ? findAll(presentation, ['p:sldId']).flatMap((slide) => targets.get(/\sr:id="([^"]*)"/.exec(slide.attrs)?.[1]) ?? []) : [];
  const parts = listed.map((target) => (target.startsWith('/') ? target.slice(1) : `ppt/${target}`)).filter((part) => pack.has(part));
  if (parts.length > 0) return parts;
  return pack
    .names()
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
}

function openParagraphs(kind: 'docx' | 'pptx', pack: Package): TextDocument {
  const dialect = kind === 'docx' ? WORD : SLIDE;
  const entries: Entry[] = [];
  let next = 0;
  const collect = (part: string, where: (paragraph: XmlElement, ancestors: XmlElement[]) => string) => {
    const document = pack.xml(part);
    if (!document) throw new Error(`This document has no ${part}, so it cannot be opened here.`);
    const visit = (parent: XmlElement | XmlDocument, ancestors: XmlElement[]) => {
      for (const child of parent.children) {
        if (!isElement(child)) continue;
        if (child.name === dialect.paragraph) entries.push({ key: next++, part, paragraph: child, parent: parent as XmlElement, where: where(child, ancestors) });
        else visit(child, [...ancestors, child]);
      }
    };
    visit(document, []);
  };
  if (kind === 'docx') collect('word/document.xml', (_, ancestors) => (ancestors.some((ancestor) => ancestor.name === 'w:tbl') ? 'Table' : ''));
  else slideParts(pack).forEach((part, index) => collect(part, () => `Slide ${index + 1}`));

  const find = (key: number) => {
    const entry = entries.find((candidate) => candidate.key === key);
    if (!entry) throw new Error('There is no such paragraph.');
    return entry;
  };
  const read = (paragraph: XmlElement) => (kind === 'docx' ? wordText(paragraph) : slideText(paragraph));

  return {
    kind,
    paragraphs: () => entries.map(({ key, paragraph, where }) => ({ key, text: read(paragraph), where })),
    setText(key, text) {
      const entry = find(key);
      if (read(entry.paragraph) === text) return;
      if (kind === 'docx') setWordText(entry.paragraph, text);
      else setSlideText(entry.paragraph, text);
      pack.edited(entry.part);
    },
    addAfter(key, text) {
      const entry = find(key);
      const fresh = element(dialect.paragraph);
      // The paragraph formatting is copied, but not a section break: a second one would split the document.
      const properties = childElements(entry.paragraph, dialect.paragraphProperties)[0];
      if (properties) {
        const copy = clone(properties);
        copy.children = copy.children.filter((child) => !isElement(child, 'w:sectPr'));
        fresh.children.push(copy);
      }
      fresh.selfClosing = false;
      if (kind === 'docx') setWordText(fresh, text);
      else setSlideText(fresh, text);
      entry.parent.children.splice(entry.parent.children.indexOf(entry.paragraph) + 1, 0, fresh);
      const added: Entry = { ...entry, key: next++, paragraph: fresh };
      entries.splice(entries.indexOf(entry) + 1, 0, added);
      pack.edited(entry.part);
      return added.key;
    },
    remove(key) {
      const entry = find(key);
      const siblings = childElements(entry.parent, dialect.paragraph);
      if (siblings.length < 2 || hasMore(entry.paragraph)) return false;
      entry.parent.children.splice(entry.parent.children.indexOf(entry.paragraph), 1);
      entries.splice(entries.indexOf(entry), 1);
      pack.edited(entry.part);
      return true;
    },
    save: () => pack.save(),
  };
}

/** Opens a Word or PowerPoint document's bytes for editing. Throws, with words the owner can read, for a file that is not one. */
export function openText(kind: 'docx' | 'pptx', bytes: Uint8Array): TextDocument {
  return openParagraphs(kind, new Package(bytes));
}

export type OfficeDocument = TextDocument | SheetDocument;

/** Opens an Office document's bytes for editing. Throws, with words the owner can read, for a file that is not a usable one. */
export function openOffice(kind: OfficeKind, bytes: Uint8Array): OfficeDocument {
  return kind === 'xlsx' ? openSheets(bytes) : openText(kind, bytes);
}
