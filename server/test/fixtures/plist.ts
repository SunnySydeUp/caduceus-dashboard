// A reader for the small subset of property lists a LaunchAgent uses (dict, array, string, integer, true, false), so that tests
// can check a generated plist by what it says rather than by how it is spelled. `plutil -lint` checks it against the real format.

export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

const TOKEN = /<(\/?)(dict|array|key|string|integer)>|<(true|false)\/>|([^<]+)/g;

function unescapeXml(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
}

/** Reads the root value of a property list. Throws on anything outside the subset. */
export function readPlist(xml: string): PlistValue {
  const body = xml.slice(xml.indexOf('<plist'));
  const tokens = [...body.matchAll(TOKEN)].filter((match) => match[4] === undefined || match[4].trim() !== '');
  let index = 0;
  // The first tokens are `<plist version="1.0">` text; skip to the first value.
  const start = tokens.findIndex((token) => token[2] === 'dict' || token[2] === 'array' || token[2] === 'string' || token[3] !== undefined || token[2] === 'integer');
  index = start;

  const readText = (tag: string): string => {
    const text = tokens[index]?.[4] !== undefined ? tokens[index++][4] : '';
    const close = tokens[index++];
    if (close?.[1] !== '/' || close[2] !== tag) throw new Error(`Expected </${tag}>`);
    return unescapeXml(text);
  };
  const readValue = (): PlistValue => {
    const token = tokens[index++];
    if (token[3] !== undefined) return token[3] === 'true';
    if (token[1] === '/' || token[2] === undefined) throw new Error(`Unexpected ${token[0]}`);
    if (token[2] === 'string') return readText('string');
    if (token[2] === 'integer') return Number(readText('integer'));
    if (token[2] === 'array') {
      const items: PlistValue[] = [];
      while (!(tokens[index][1] === '/' && tokens[index][2] === 'array')) items.push(readValue());
      index++;
      return items;
    }
    if (token[2] === 'dict') {
      const entries: Record<string, PlistValue> = {};
      while (!(tokens[index][1] === '/' && tokens[index][2] === 'dict')) {
        const key = tokens[index++];
        if (key[2] !== 'key') throw new Error(`Expected a key, got ${key[0]}`);
        entries[readText('key')] = readValue();
      }
      index++;
      return entries;
    }
    throw new Error(`Unexpected ${token[0]}`);
  };
  return readValue();
}
