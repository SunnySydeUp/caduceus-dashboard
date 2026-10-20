// Throwaway server for the M1 #04 browser checks (not part of `npm test`): Caduceus on 127.0.0.1:9231 in front of the real `hermes serve`
// in a temp HERMES_HOME (a stub LLM is its only model), with the owner signed in and a 2,000-message session seeded in Hermes's own
// store. The stub answers the next prompts with a reply that holds every content type. Never touches ~/.hermes, :9119, :8787 or the gateway.
//
//   npm run build -w web && npx tsx .scratch/m1-chat/m1-04-smoke/serve.ts
//
// Writes the cookie to /tmp/caduceus-m1-04-cookie (mode 600) and `{ sessionId, promptRowIds }` to /tmp/caduceus-m1-04-info.json,
// prints `READY <url> <pid>`. SIGINT stops everything and deletes the temp home.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';
import { seedSession } from '../../../server/test/fixtures/seed-session.ts';
import { startStubLlm } from '../../../server/test/fixtures/stub-llm.ts';

/** A solid-gradient PNG, so that the image content type needs no file. */
function png(width: number, height: number): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.set([(x * 255) / width, (y * 255) / height, 160], y * (width * 3 + 1) + 1 + x * 3);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const file = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${file.toString('base64')}`;
}

export const RICH = `# Rich reply

A paragraph with **strong**, *emphasis*, ~~strike~~, \`inline code\`, a [link](https://example.com/docs) and the formula $E = mc^2$.

## Lists and quotes

- first item
- second item with a nested list:
  - inner one
  - [x] inner done
1. numbered
2. numbered too

> A quote that wraps over a couple of lines so that the left rule is seen against the text.

## Code

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}! This line is long enough that a phone has to scroll the code sideways inside its box.\`;
}
\`\`\`

## Maths

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

## Diagram

\`\`\`mermaid
graph TD
  A[Prompt] --> B{Hermes}
  B -->|tools| C[Run]
  B -->|answer| D[Reply]
\`\`\`

## Table

| Fruit | Quantity | Price | A rather long column heading to force sideways scrolling | Notes |
|:------|---------:|------:|:---------------------------------------------------------|:------|
| apple | 3 | $10.00 | the first row has a long note that does not fit a phone | fresh |
| pear | 12 | $1.50 | second | ripe |
| Banana | 100 | $0.25 | third | green |
| fig | 7 | $2 | fourth | dried |
| kiwi | 41 | $0.80 | fifth | tart |
| plum | 5 | $3.10 | sixth | soft |

## JSON

\`\`\`json
{"name": "caduceus", "ports": [9130, 9443], "nested": {"ok": true, "items": [{"id": 1}, {"id": 2}]}, "empty": {}}
\`\`\`

## YAML

\`\`\`yaml
service: caduceus
ports:
  - 9130
  - 9443
env:
  mode: live
  debug: false
\`\`\`

## Media

![A gradient](${png(320, 200)})

![A clip](/smoke/clip.wav)

![A film](/smoke/film.mp4)

![A paper](/smoke/paper.pdf)

## HTML

\`\`\`html
<h3 style="color: teal">HTML preview</h3><p>Sandboxed.</p><script>document.title = 'owned'; parent.document.title = 'owned'</script>
\`\`\`

## Injection

<script>document.title = 'owned-by-markdown'</script> <img src=x onerror="document.title='owned-by-img'"> [click](javascript:document.title='owned-by-link')

The end.
`;

const hermes = await launchTestHermes();
await hermes.backend.ready();
const llm = await startStubLlm();
llm.connect(hermes);
// The next prompts get the rich reply, a few words at a time.
const words = RICH.match(/\S+\s*/g) ?? [];
const chunks = Array.from({ length: Math.ceil(words.length / 6) }, (_, index) => words.slice(index * 6, index * 6 + 6).join(''));
for (let n = 0; n < 8; n++) llm.nextReply({ chunks });

// A 2,000-message session: a prompt and an answer per turn; every tenth answer is the rich reply, the others short.
const turns = Array.from({ length: 1000 }, (_, n) => [
  { role: 'user' as const, content: n % 10 === 0 ? `Question ${n}: please show me everything you can render.` : `Question ${n}` },
  { role: 'assistant' as const, content: n % 10 === 0 ? RICH.replace('# Rich reply', `# Rich reply ${n}`) : `Answer ${n}: short.` },
]).flat();
const rowIds = seedSession(hermes.home, 'long-rich', turns);
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port: Number(process.env.PORT ?? 9231),
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
fs.writeFileSync('/tmp/caduceus-m1-04-cookie', await ownerCookie(server.url), { mode: 0o600 });
fs.writeFileSync('/tmp/caduceus-m1-04-info.json', JSON.stringify({ sessionId: 'long-rich', promptRowIds: rowIds.filter((_, index) => index % 2 === 0) }));
console.log(`READY ${server.url} ${process.pid}`);

process.once('SIGINT', async () => {
  await server.close();
  await llm.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m1-04-cookie', { force: true });
  fs.rmSync('/tmp/caduceus-m1-04-info.json', { force: true });
  process.exit(0);
});
