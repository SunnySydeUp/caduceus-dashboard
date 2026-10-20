// A tiny MCP server over stdio for tests (newline-delimited JSON-RPC, no dependencies). By default it has two tools, no prompts or resources:
// Hermes's "test server" probe connects to it, lists the tools and disconnects. With `--notes` it is a notes source (M4 #10): `search_notes`, `read_note`
// and, to show they are never called, `create_note` and `delete_note`. Every `tools/call` is appended to the file named by `NOTES_LOG` (one JSON line each),
// so a test can tell what was called. It never touches the network.
import fs from 'node:fs';
import readline from 'node:readline';

const NOTES = process.argv.includes('--notes');

const BASE_TOOLS = [
  { name: 'echo', description: 'Echo the text back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
  { name: 'add_numbers', description: 'Add two numbers.', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } },
];

const NOTE_TOOLS = [
  { name: 'search_notes', description: 'Search the notes for a text.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] }, annotations: { readOnlyHint: true } },
  { name: 'read_note', description: 'Read one note by its id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, annotations: { readOnlyHint: true } },
  { name: 'create_note', description: 'Create a note.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] } },
  { name: 'delete_note', description: 'Delete a note.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, annotations: { destructiveHint: true } },
];

const NOTE_BODIES = {
  'deploy-checklist': { title: 'Deploy checklist', body: 'Run the migrations, then flip the flag. Deploys happen on Sundays.' },
  'tea-blends': { title: 'Tea blends', body: 'Green tea with jasmine in the morning. Oolong in the afternoon.' },
  'boat-upkeep': { title: 'Boat upkeep', body: 'The Zanzibar boat needs a new sail before the deploy season.' },
};

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

function callTool(name, args) {
  if (process.env.NOTES_LOG) fs.appendFileSync(process.env.NOTES_LOG, `${JSON.stringify({ name, arguments: args })}\n`);
  const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
  switch (name) {
    case 'echo':
      return text(String(args.text ?? ''));
    case 'add_numbers':
      return text(String(Number(args.a) + Number(args.b)));
    case 'search_notes': {
      const words = String(args.query ?? '').toLowerCase().split(/\W+/).filter(Boolean);
      const results = Object.entries(NOTE_BODIES)
        .filter(([, note]) => words.some((word) => `${note.title} ${note.body}`.toLowerCase().includes(word)))
        .map(([id, note]) => ({ id, title: note.title, snippet: note.body.slice(0, 60) }));
      return { ...text({ results }), structuredContent: { results } };
    }
    case 'read_note': {
      const note = NOTE_BODIES[String(args.id)];
      if (!note) return { ...text(`No note with id ${args.id}.`), isError: true };
      return text(`# ${note.title}\n\n${note.body}`);
    }
    case 'create_note':
    case 'delete_note':
      return text('done');
    default:
      return undefined;
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  switch (message.method) {
    case 'initialize':
      return send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'caduceus-fixture', version: '1.0.0' } } });
    case 'tools/list':
      return send({ jsonrpc: '2.0', id: message.id, result: { tools: NOTES ? NOTE_TOOLS : BASE_TOOLS } });
    case 'tools/call': {
      const offered = (NOTES ? NOTE_TOOLS : BASE_TOOLS).some((tool) => tool.name === message.params?.name);
      const result = offered ? callTool(message.params.name, message.params.arguments ?? {}) : undefined;
      if (!result) return send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `Unknown tool: ${message.params?.name}` } });
      return send({ jsonrpc: '2.0', id: message.id, result });
    }
    case 'ping':
      return send({ jsonrpc: '2.0', id: message.id, result: {} });
    default:
      return send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  }
});
