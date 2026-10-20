// An Excel workbook as the cells of its sheets (M7 #02). A cell is read as the text a person sees and as the text they edit (a formula shows as
// `=B1*2`); an edit changes that one cell and leaves its style, every other cell, the shared strings and every other part as they were. Formulas are not
// calculated here: the workbook is marked to be calculated when Excel (or any other program) opens it, and the stale calculation chain is dropped.
import { Package } from './package.ts';
import { attr, childElements, element, findAll, isElement, removeAttr, setAttr, textNode, textOf, type XmlElement } from './xml.ts';

/** What the page shows and edits in one cell. `locked` is set for a cell the editor cannot change safely (part of a shared or array formula). */
export interface CellView {
  text: string;
  input: string;
  locked?: true;
}

export interface SheetView {
  name: string;
  /** Rows and columns up to the last cell that holds anything. */
  rows: number;
  cols: number;
  cell(row: number, col: number): CellView;
}

export interface SheetDocument {
  kind: 'xlsx';
  sheets(): SheetView[];
  /** Sets one cell from what was typed: `=…` is a formula, a number is a number, `TRUE` and `FALSE` are booleans, empty clears it, anything else is text. */
  setCell(sheet: number, row: number, col: number, input: string): void;
  save(): Uint8Array;
}

/** `A`, `B`, … `Z`, `AA`: the name of a zero-based column. */
export function columnName(index: number): string {
  let name = '';
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  return name;
}

/** The zero-based row and column a reference such as `B7` names. */
function parseRef(ref: string | undefined): { row: number; col: number } | undefined {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ref ?? '');
  if (!match) return undefined;
  const col = [...match[1].toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  return { row: Number(match[2]) - 1, col };
}

/** A number as the file stores it: not text that only looks like one (a zip code, a part number with leading zeros). */
const NUMBER = /^[+-]?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$|^[+-]?\.\d+([eE][+-]?\d+)?$/;

/** The text of a shared-string or inline-string item: its runs, not the phonetic hints. */
function stringItem(item: XmlElement): string {
  return item.children.map((child) => (isElement(child, 't') ? textOf(child) : isElement(child, 'r') ? childElements(child, 't').map(textOf).join('') : '')).join('');
}

function readCell(cell: XmlElement, shared: readonly string[]): CellView {
  const type = attr(cell, 't');
  const formula = childElements(cell, 'f')[0];
  const value = childElements(cell, 'v').map(textOf).join('');
  let text = value;
  if (type === 's') text = shared[Number(value)] ?? '';
  else if (type === 'inlineStr') text = childElements(cell, 'is').map(stringItem).join('');
  else if (type === 'b') text = value === '1' ? 'TRUE' : 'FALSE';
  if (!formula) return { text, input: text };
  const kind = attr(formula, 't');
  return { text, input: `=${textOf(formula)}`, ...(kind === 'shared' || kind === 'array' ? { locked: true as const } : {}) };
}

const holdsSomething = (cell: XmlElement) => childElements(cell).some((child) => ['v', 'f', 'is'].includes(child.name));

/** The part of each sheet, in the order the workbook lists them. */
function sheetParts(pack: Package): { name: string; part: string }[] {
  const workbook = pack.xml('xl/workbook.xml');
  if (!workbook) throw new Error('This workbook has no xl/workbook.xml, so it cannot be opened here.');
  const relationships = pack.xml('xl/_rels/workbook.xml.rels');
  const targets = new Map(findAll(relationships ?? { children: [] }, ['Relationship']).map((relationship) => [attr(relationship, 'Id'), attr(relationship, 'Target')]));
  return findAll(workbook, ['sheet']).flatMap((sheet) => {
    const target = targets.get(attr(sheet, 'r:id'));
    if (!target) return [];
    const part = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    return pack.has(part) ? [{ name: attr(sheet, 'name') ?? part, part }] : [];
  });
}

interface SheetState {
  name: string;
  part: string;
  data: XmlElement;
  /** row → column → cell. */
  cells: Map<number, Map<number, XmlElement>>;
  rows: Map<number, XmlElement>;
}

function loadSheet(pack: Package, { name, part }: { name: string; part: string }): SheetState {
  const document = pack.xml(part)!;
  const data = findAll(document, ['sheetData'])[0];
  if (!data) throw new Error(`The sheet ${name} has no data to show.`);
  const state: SheetState = { name, part, data, cells: new Map(), rows: new Map() };
  let nextRow = 0;
  for (const row of childElements(data, 'row')) {
    const index = (Number(attr(row, 'r')) || nextRow + 1) - 1;
    nextRow = index + 1;
    state.rows.set(index, row);
    const columns = new Map<number, XmlElement>();
    let nextCol = 0;
    for (const cell of childElements(row, 'c')) {
      const col = parseRef(attr(cell, 'r'))?.col ?? nextCol;
      nextCol = col + 1;
      columns.set(col, cell);
    }
    state.cells.set(index, columns);
  }
  return state;
}

/** Drops the calculation chain: it lists the cells that hold formulas, and after an edit it can name a cell that no longer holds one. */
function removeCalculationChain(pack: Package): void {
  if (!pack.has('xl/calcChain.xml')) return;
  pack.remove('xl/calcChain.xml');
  const drop = (part: string, name: string, match: RegExp) => {
    const document = pack.xml(part);
    const root = document?.children.find((child): child is XmlElement => isElement(child));
    if (!root) return;
    root.children = root.children.filter((child) => !(isElement(child, name) && match.test(child.attrs)));
    pack.edited(part);
  };
  drop('[Content_Types].xml', 'Override', /PartName="\/xl\/calcChain\.xml"/);
  drop('xl/_rels/workbook.xml.rels', 'Relationship', /\/calcChain"/);
}

/** Marks the workbook to be calculated when it is opened. */
function calculateOnOpen(pack: Package): void {
  const workbook = pack.xml('xl/workbook.xml')!;
  const root = workbook.children.find((child): child is XmlElement => isElement(child))!;
  const existing = childElements(root, 'calcPr')[0];
  if (existing) setAttr(existing, 'fullCalcOnLoad', '1');
  else {
    // `calcPr` follows the defined names (or the sheets, when there are none) in the workbook's schema order.
    const after = root.children.map((child, index) => (isElement(child) && ['sheets', 'functionGroups', 'externalReferences', 'definedNames'].includes(child.name) ? index : -1)).reduce((a, b) => Math.max(a, b), -1);
    root.children.splice(after + 1, 0, element('calcPr', ' fullCalcOnLoad="1"'));
  }
  pack.edited('xl/workbook.xml');
}

export function openSheets(bytes: Uint8Array): SheetDocument {
  const pack = new Package(bytes);
  const strings = pack.xml('xl/sharedStrings.xml');
  const shared = strings ? findAll(strings, ['si'], true).map(stringItem) : [];
  const sheets = sheetParts(pack).map((sheet) => loadSheet(pack, sheet));
  let changed = false;

  const extent = (sheet: SheetState) => {
    let rows = 0;
    let cols = 0;
    for (const [row, columns] of sheet.cells) {
      for (const [col, cell] of columns) {
        if (!holdsSomething(cell)) continue;
        rows = Math.max(rows, row + 1);
        cols = Math.max(cols, col + 1);
      }
    }
    return { rows, cols };
  };

  const cellAt = (sheet: SheetState, row: number, col: number, create: boolean): XmlElement | undefined => {
    const known = sheet.cells.get(row)?.get(col);
    if (known || !create) return known;
    let rowElement = sheet.rows.get(row);
    if (!rowElement) {
      rowElement = element('row', ` r="${row + 1}"`);
      rowElement.selfClosing = false;
      const after = [...sheet.rows.keys()].filter((index) => index < row).reduce((a, b) => Math.max(a, b), -1);
      const at = after < 0 ? 0 : sheet.data.children.indexOf(sheet.rows.get(after)!) + 1;
      sheet.data.children.splice(at, 0, rowElement);
      sheet.data.selfClosing = false;
      sheet.rows.set(row, rowElement);
      sheet.cells.set(row, new Map());
    }
    const columns = sheet.cells.get(row)!;
    const cell = element('c', ` r="${columnName(col)}${row + 1}"`);
    const before = [...columns.keys()].filter((index) => index < col).reduce((a, b) => Math.max(a, b), -1);
    rowElement.children.splice(before < 0 ? 0 : rowElement.children.indexOf(columns.get(before)!) + 1, 0, cell);
    rowElement.selfClosing = false;
    columns.set(col, cell);
    return cell;
  };

  return {
    kind: 'xlsx',
    sheets: () =>
      sheets.map((sheet) => {
        const { rows, cols } = extent(sheet);
        return { name: sheet.name, rows, cols, cell: (row, col) => { const cell = cellAt(sheet, row, col, false); return cell ? readCell(cell, shared) : { text: '', input: '' }; } };
      }),
    setCell(index, row, col, input) {
      const sheet = sheets[index];
      const cell = cellAt(sheet, row, col, true)!;
      if (readCell(cell, shared).input === input) return;
      cell.children = cell.children.filter((child) => !(isElement(child) && ['f', 'v', 'is'].includes(child.name)));
      removeAttr(cell, 't');
      const trimmed = input.trim();
      if (input.startsWith('=') && input.length > 1) cell.children.push(element('f', '', [textNode(input.slice(1))]));
      else if (trimmed === 'TRUE' || trimmed === 'FALSE') {
        setAttr(cell, 't', 'b');
        cell.children.push(element('v', '', [textNode(trimmed === 'TRUE' ? '1' : '0')]));
      } else if (NUMBER.test(trimmed)) cell.children.push(element('v', '', [textNode(trimmed)]));
      else if (input !== '') {
        setAttr(cell, 't', 'inlineStr');
        cell.children.push(element('is', '', [element('t', ' xml:space="preserve"', [textNode(input)])]));
      }
      cell.selfClosing = cell.children.length === 0;
      pack.edited(sheet.part);
      changed = true;
    },
    save() {
      if (changed) {
        for (const sheet of sheets) {
          const dimension = findAll(pack.xml(sheet.part)!, ['dimension'])[0];
          const { rows, cols } = extent(sheet);
          if (dimension && rows > 0) setAttr(dimension, 'ref', `A1:${columnName(cols - 1)}${rows}`);
        }
        calculateOnOpen(pack);
        removeCalculationChain(pack);
      }
      return pack.save();
    },
  };
}
