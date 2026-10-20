import { describe, expect, test } from 'vitest';
import { parseXml, serializeXml } from '../src/modules/files/office/xml.ts';

// The XML of an Office document is read into a tree and written back: what was not edited must come back byte for byte, so that the editor changes
// nothing but the text it was used on.
describe('the XML of an Office part', () => {
  test('comes back byte for byte when nothing was edited: declaration, comments, CDATA, entities, attribute order, empty elements and namespaces', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="x" mc:Ignorable="w14">' +
      '<!-- a comment --><w:body><w:p w:rsidR="00A1" w:rsidP="00B2"><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Tom &amp; Jerry &lt;3 &#233; </w:t></w:r></w:p>' +
      '<w:p/><![CDATA[ raw <text> ]]><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';

    expect(serializeXml(parseXml(xml))).toBe(xml);
  });
});
