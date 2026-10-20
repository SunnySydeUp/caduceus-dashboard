import { describe, expect, test } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { officeKindOf } from '../src/modules/files/office/kinds.ts';
import { openText } from '../src/modules/files/office/office.ts';
import { openSheets } from '../src/modules/files/office/sheets.ts';

// The editor's model of an Office document, over real archives built here: what it shows, what an edit changes, and that nothing else changes.
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function archive(parts: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, text]) => [name, strToU8(text)])));
}
const partsOf = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name, data]) => [name, strFromU8(data)]));

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';

const DOCUMENT =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>` +
  '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Quarterly </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>report</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Tom &amp; Jerry</w:t></w:r><w:r><w:tab/><w:t>tabbed</w:t></w:r><w:r><w:br/><w:t>second line</w:t></w:r></w:p>' +
  '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  '<w:p><w:r><w:drawing><wp:inline xmlns:wp="x"/></w:drawing></w:r></w:p>' +
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';

const docx = () => archive({ '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': DOCUMENT, 'word/styles.xml': '<w:styles/>' });

describe('a Word document', () => {
  test('shows its paragraphs in order, table cells included, with tabs and line breaks as the characters they are', () => {
    const opened = openText('docx', docx());

    expect(opened.kind).toBe('docx');
    if (opened.kind !== 'docx') return;
    expect(opened.paragraphs().map((paragraph) => paragraph.text)).toEqual(['Quarterly report', 'Tom & Jerry\ttabbed\nsecond line', 'Cell A', 'Cell B', '']);
    expect(opened.paragraphs().map((paragraph) => paragraph.where)).toEqual(['', '', 'Table', 'Table', '']);
    expect(officeKindOf('Report.DOCX')).toBe('docx');
    expect(officeKindOf('notes.doc')).toBeUndefined();
  });
});

const withDocument = (xml: string) => archive({ '[Content_Types].xml': CONTENT_TYPES, 'word/document.xml': xml, 'word/styles.xml': '<w:styles/>' });
const paragraphText = (bytes: Uint8Array) => {
  const reopened = openText('docx', bytes);
  return reopened.paragraphs().map((paragraph) => paragraph.text);
};

describe('editing a Word document', () => {
  test('a paragraph takes the new text in the formatting of its first run, and every other part and paragraph is written back exactly as it was', () => {
    const opened = openText('docx', docx());
    const [heading, mixed, cellA] = opened.paragraphs();

    opened.setText(heading.key, 'Annual <summary>');
    opened.setText(mixed.key, 'Tom & Jerry\ttabbed\nsecond line');
    opened.setText(cellA.key, 'Cell A changed');
    const saved = partsOf(opened.save());

    expect(paragraphText(opened.save())).toEqual(['Annual <summary>', 'Tom & Jerry\ttabbed\nsecond line', 'Cell A changed', 'Cell B', '']);
    expect(saved['word/document.xml']).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Annual &lt;summary&gt;</w:t></w:r>');
    // The second run of the heading held only text: it is gone, and the italic with it. The untouched paragraph is as it was, bytes and all.
    expect(saved['word/document.xml']).not.toContain('<w:i/>');
    expect(saved['word/document.xml']).toContain('<w:p><w:r><w:t xml:space="preserve">Tom &amp; Jerry</w:t></w:r><w:r><w:tab/><w:t>tabbed</w:t></w:r><w:r><w:br/><w:t>second line</w:t></w:r></w:p>');
    expect(saved['word/document.xml']).toContain('<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>');
    expect(saved['word/styles.xml']).toBe('<w:styles/>');
    expect(saved['[Content_Types].xml']).toBe(CONTENT_TYPES);
  });

  test('a document that was only looked at is saved with the same text in every part', () => {
    const opened = openText('docx', docx());

    opened.paragraphs();
    const saved = partsOf(opened.save());

    expect(saved['word/document.xml']).toBe(DOCUMENT);
  });

  test('adds a paragraph after another with its formatting but not its section break, and removes one unless it holds a picture or is a cell’s only paragraph', () => {
    const withSection =
      `<w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="Body"/><w:sectPr><w:pgSz w:w="1"/></w:sectPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>` +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>only</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing/></w:r></w:p><w:p><w:r><w:t>last</w:t></w:r></w:p></w:body></w:document>';
    const opened = openText('docx', withDocument(withSection));
    const [one, only, picture, last] = opened.paragraphs();

    const added = opened.addAfter(one.key, 'two');
    const refusals = [opened.remove(only.key), opened.remove(picture.key)];
    const removed = opened.remove(last.key);
    const xml = partsOf(opened.save())['word/document.xml'];

    expect(opened.paragraphs().map((paragraph) => paragraph.text)).toEqual(['one', 'two', 'only', '']);
    expect(added).not.toBe(one.key);
    expect(refusals).toEqual([false, false]);
    expect(removed).toBe(true);
    expect(xml).toContain('<w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:t xml:space="preserve">two</w:t></w:r></w:p>');
    expect(xml.match(/<w:sectPr>/g)).toHaveLength(1);
  });

  test('refuses a file that is not an archive, and one that unpacks to far more than it should', () => {
    expect(() => openText('docx', strToU8('this is not a zip'))).toThrow(/not a readable Office document/);
    expect(() => openText('docx', archive({ '[Content_Types].xml': CONTENT_TYPES }))).toThrow(/no word\/document\.xml/);
    const bomb = zipSync({ 'word/document.xml': new Uint8Array(210 * 1024 * 1024) });
    expect(() => openText('docx', bomb)).toThrow(/unpacks to far more/);
  });
});

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const slide = (...paragraphs: string[]) => `<p:sld ${A}><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/>${paragraphs.join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

describe('a PowerPoint document', () => {
  test('lists the paragraphs of its slides in the order the presentation shows them (not the order of the files), and an edit keeps the first run’s formatting', () => {
    const pptx = archive({
      '[Content_Types].xml': CONTENT_TYPES,
      'ppt/presentation.xml': `<p:presentation ${A}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>`,
      'ppt/_rels/presentation.xml.rels': '<Relationships xmlns="x"><Relationship Id="rId1" Type="t" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="t" Target="slides/slide2.xml"/></Relationships>',
      'ppt/slides/slide1.xml': slide('<a:p><a:r><a:rPr b="1"/><a:t>Second in the deck</a:t></a:r></a:p>'),
      'ppt/slides/slide2.xml': slide('<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="4400"/><a:t>Welcome </a:t></a:r><a:br><a:rPr lang="en-US"/></a:br><a:r><a:rPr/><a:t>everyone</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>'),
    });
    const opened = openText('pptx', pptx);

    expect(opened.paragraphs().map(({ text, where }) => [where, text])).toEqual([['Slide 1', 'Welcome \neveryone'], ['Slide 2', 'Second in the deck']]);
    opened.setText(opened.paragraphs()[0].key, 'Hello\nall of you & more');
    const saved = partsOf(opened.save());

    expect(saved['ppt/slides/slide2.xml']).toContain('<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="4400"/><a:t>Hello</a:t></a:r><a:br><a:rPr lang="en-US" sz="4400"/></a:br><a:r><a:rPr lang="en-US" sz="4400"/><a:t>all of you &amp; more</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>');
    expect(saved['ppt/slides/slide1.xml']).toBe(partsOf(pptx)['ppt/slides/slide1.xml']);
  });
});

const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const WORKBOOK = `<workbook ${S}><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="x">Budget!A1</definedName></definedNames></workbook>`;
const SHEET1 =
  `<worksheet ${S}><dimension ref="A1:C2"/><sheetData>` +
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="3"><v>12.5</v></c><c r="C1" t="b"><v>1</v></c></row>' +
  '<row r="2"><c r="A2" t="inlineStr"><is><t>inline</t></is></c><c r="B2"><f>B1*2</f><v>25</v></c><c r="C2" t="str"><f>A1&amp;"!"</f><v>Rent!</v></c></row>' +
  '</sheetData></worksheet>';
const SHEET2 = `<worksheet ${S}><sheetData/></worksheet>`;
const xlsx = () =>
  archive({
    '[Content_Types].xml': `${CONTENT_TYPES.slice(0, -8)}<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>`,
    'xl/workbook.xml': WORKBOOK,
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="x"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': SHEET1,
    'xl/worksheets/sheet2.xml': SHEET2,
    'xl/sharedStrings.xml': `<sst ${S} count="1" uniqueCount="1"><si><r><t>Re</t></r><r><t>nt</t></r></si></sst>`,
    'xl/calcChain.xml': '<calcChain/>',
  });

describe('an Excel workbook', () => {
  test('shows each sheet’s cells: shared and inline strings, numbers, booleans, and a formula with its text so it can be edited', () => {
    const opened = openSheets(xlsx());

    expect(opened.sheets().map((sheet) => [sheet.name, sheet.rows, sheet.cols])).toEqual([['Budget', 2, 3], ['Notes', 0, 0]]);
    const budget = opened.sheets()[0];
    expect([budget.cell(0, 0), budget.cell(0, 1), budget.cell(0, 2), budget.cell(1, 0), budget.cell(1, 1), budget.cell(1, 2)]).toEqual([
      { text: 'Rent', input: 'Rent' },
      { text: '12.5', input: '12.5' },
      { text: 'TRUE', input: 'TRUE' },
      { text: 'inline', input: 'inline' },
      { text: '25', input: '=B1*2' },
      { text: 'Rent!', input: '=A1&"!"' },
    ]);
    expect(budget.cell(5, 5)).toEqual({ text: '', input: '' });
  });
});

describe('editing an Excel workbook', () => {
  test('sets text, numbers, booleans and formulas in one cell each, in order and keeping styles, and marks the workbook to be calculated when opened without its stale calculation chain', () => {
    const opened = openSheets(xlsx());

    opened.setCell(0, 0, 0, 'Rent & utilities');
    opened.setCell(0, 0, 1, '13');
    opened.setCell(0, 1, 1, '=B1*3');
    opened.setCell(0, 0, 2, 'false');
    opened.setCell(0, 2, 3, '007');
    opened.setCell(0, 2, 0, '42');
    opened.setCell(0, 1, 0, '');
    opened.setCell(1, 0, 0, 'on Notes');
    const saved = partsOf(opened.save());
    const reopened = openSheets(zipSync(Object.fromEntries(Object.entries(unzipSync(opened.save())))));

    const budget = reopened.sheets()[0];
    expect([budget.cell(0, 0).text, budget.cell(0, 1).text, budget.cell(1, 1).input, budget.cell(0, 2).text, budget.cell(2, 3).text, budget.cell(2, 0).text, budget.cell(1, 0).text]).toEqual(['Rent & utilities', '13', '=B1*3', 'false', '007', '42', '']);
    expect(reopened.sheets()[1].cell(0, 0).text).toBe('on Notes');
    expect(saved['xl/worksheets/sheet1.xml']).toContain('<c r="B1" s="3"><v>13</v></c>');
    // New cells land in the right order: column D after C in row 3, row 3 after row 2.
    expect(saved['xl/worksheets/sheet1.xml']).toContain('</row><row r="3"><c r="A3"><v>42</v></c><c r="D3" t="inlineStr">');
    expect(saved['xl/worksheets/sheet1.xml']).toContain('<dimension ref="A1:D3"/>');
    expect(saved['xl/workbook.xml']).toContain('</definedNames><calcPr fullCalcOnLoad="1"/></workbook>');
    expect(saved['xl/calcChain.xml']).toBeUndefined();
    expect(saved['[Content_Types].xml']).not.toContain('calcChain');
    expect(saved['xl/_rels/workbook.xml.rels']).not.toContain('calcChain');
    expect(saved['xl/sharedStrings.xml']).toBe(partsOf(xlsx())['xl/sharedStrings.xml']);
  });

  test('a workbook that was only looked at keeps its calculation chain and every part as it was', () => {
    const opened = openSheets(xlsx());

    opened.sheets()[0].cell(0, 0);

    expect(partsOf(opened.save())).toEqual(partsOf(xlsx()));
  });
});
