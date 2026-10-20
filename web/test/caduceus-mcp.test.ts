import { describe, expect, test } from 'vitest';
import type { McpServerInfo } from '@caduceus/contracts/caduceus-api';
import { isRegistered, parseMcpServerInfo, registrationCommand, registrationForm } from '../src/modules/tools/caduceus-mcp.ts';
import { serverCreate, argsOf, type McpServer } from '../src/modules/tools/mcp-model.ts';

const info: McpServerInfo = {
  name: 'caduceus',
  command: '/usr/local/bin/node',
  args: ['--import', '/Users/me/Caduceus Dashboard/node_modules/tsx/dist/loader.mjs', '/Users/me/Caduceus Dashboard/server/src/mcp-main.ts', '--url', 'http://127.0.0.1:9130', '--root', '/Users/me/.hermes'],
  tools: [{ name: 'list_projects', title: 'List projects', description: 'Lists projects.', readOnly: true }],
};

describe('the registration of the Caduceus MCP server', () => {
  test('the command is Hermes’s own `mcp add` for the profile, with a path that has a space quoted', () => {
    expect(registrationCommand(info, 'work')).toBe(
      "hermes -p work mcp add caduceus --command /usr/local/bin/node --args --import '/Users/me/Caduceus Dashboard/node_modules/tsx/dist/loader.mjs' '/Users/me/Caduceus Dashboard/server/src/mcp-main.ts' --url http://127.0.0.1:9130 --root /Users/me/.hermes",
    );
  });

  test('the button makes the same registration as the command: a stdio server with the same program and arguments, so the add flow asks for the typed name', () => {
    const form = registrationForm(info);

    expect(form).toMatchObject({ transport: 'stdio', name: 'caduceus', command: '/usr/local/bin/node', env: [] });
    expect(argsOf(form.args)).toEqual(info.args);
    expect(serverCreate(form, 'work')).toEqual({ method: 'POST', path: '/api/mcp/servers?profile=work', body: { name: 'caduceus', command: '/usr/local/bin/node', args: info.args } });
  });

  test('the profile is registered when it has a server of that name, and not when it does not', () => {
    const server = (name: string) => ({ name }) as McpServer;

    expect(isRegistered(info, [server('github'), server('caduceus')])).toBe(true);
    expect(isRegistered(info, [server('github')])).toBe(false);
  });

  test('a body that is not the server’s info is not read as one, and a tool without a title is called by its name', () => {
    expect(parseMcpServerInfo({ name: 'caduceus' })).toBeUndefined();
    expect(parseMcpServerInfo(null)).toBeUndefined();
    expect(parseMcpServerInfo({ ...info, tools: [{ name: 'x' }, { nope: 1 }] })?.tools).toEqual([{ name: 'x', title: 'x', description: '', readOnly: false }]);
  });
});
