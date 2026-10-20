import { describe, expect, test } from 'vitest';
import type { McpTool, McpToolResult } from '../src/notes-mcp.ts';
import { hitsOf, notesTools, readArguments, searchArguments, toolRole } from '../src/notes-tools.ts';

// The allow-list of a notes source's tools and the reading of its answers (R11, M4 #10): pure, over names and answers MCP notes servers really use.
const tool = (name: string, annotations: Record<string, unknown> = {}, properties: Record<string, { type?: string }> = { query: { type: 'string' } }, required?: string[]): McpTool => ({ name, description: '', inputSchema: { properties, required }, annotations });
const answer = (over: Partial<McpToolResult>): McpToolResult => ({ text: '', structured: undefined, isError: false, ...over });

describe('which tools may be called', () => {
  test.each([
    ['search_notes', 'search'],
    ['searchNotes', 'search'],
    ['notes-search', 'search'],
    ['find_files', 'search'],
    ['obsidian_simple_search', 'search'],
    ['get_note', 'read'],
    ['read_note', 'read'],
    ['obsidian_get_file_contents', 'read'],
    ['fetchPage', 'read'],
  ] as const)('%s is a %s tool', (name, role) => {
    expect(toolRole(tool(name))).toBe(role);
  });

  test.each(['create_note', 'delete_note', 'update_note', 'append_to_file', 'run_search_and_delete', 'search_and_replace', 'get_and_set', 'send_message', 'execute_command', 'list_notes', 'echo', 'rename_file', 'moveNote', 'archive_note'])('%s is not called', (name) => {
    expect(toolRole(tool(name))).toBeUndefined();
  });

  test('a server’s annotations can only take a tool away, never give one', () => {
    expect(toolRole(tool('search_notes', { destructiveHint: true }))).toBeUndefined();
    expect(toolRole(tool('search_notes', { readOnlyHint: false }))).toBeUndefined();
    expect(toolRole(tool('do_things', { readOnlyHint: true }))).toBeUndefined();
    expect(toolRole(tool('search_notes', { readOnlyHint: true }))).toBe('search');
  });

  test('the tool that does a role is the first one for notes, then the first one', () => {
    const tools = [tool('create_note'), tool('search_web'), tool('search_notes'), tool('get_page'), tool('read_note')];

    expect(notesTools(tools)).toEqual({ search: 'search_notes', read: 'read_note' });
    expect(notesTools([tool('delete_note')])).toEqual({ search: undefined, read: undefined });
    expect(notesTools([tool('find_files'), tool('open_file')])).toEqual({ search: 'find_files', read: 'open_file' });
  });
});

describe('the arguments of a call', () => {
  test('come from the tool’s own schema: the query under its name, a limit when it takes one', () => {
    expect(searchArguments(tool('s', {}, { q: { type: 'string' }, limit: { type: 'integer' } }), 'tea')).toEqual({ q: 'tea', limit: 10 });
    expect(searchArguments(tool('s', {}, { phrase: { type: 'string' }, flag: { type: 'boolean' } }, ['phrase']), 'tea')).toEqual({ phrase: 'tea' });
    expect(searchArguments(tool('s', {}, { limit: { type: 'number' } }), 'tea')).toBeUndefined();
    expect(readArguments(tool('r', {}, { note_id: { type: 'string' } }), 'n1')).toEqual({ note_id: 'n1' });
    expect(readArguments(tool('r', {}, { filepath: { type: 'string' } }), 'a/b.md')).toEqual({ filepath: 'a/b.md' });
  });
});

describe('the hits of a search', () => {
  test('are read from structured content, or from the text as JSON, under the names notes servers use', () => {
    const rows = [{ path: 'a/b.md', name: 'B', excerpt: '  a\n  long  snippet ' }, { id: 7, title: 'Seven' }, { snippet: 'no reference' }];

    expect(hitsOf(answer({ structured: { results: rows } }))).toEqual([
      { ref: 'a/b.md', title: 'B', snippet: 'a long snippet' },
      { ref: '7', title: 'Seven', snippet: '' },
    ]);
    expect(hitsOf(answer({ text: JSON.stringify(rows) }))).toHaveLength(2);
    expect(hitsOf(answer({ text: JSON.stringify({ total: 1, notes: [{ id: 'x', title: 'X', content: 'y'.repeat(500) }] }) }))).toEqual([{ ref: 'x', title: 'X', snippet: 'y'.repeat(300) }]);
    expect(hitsOf(answer({ text: '[]' }))).toEqual([]);
  });

  test('are none for an answer in prose, which the page shows as the text it is', () => {
    expect(hitsOf(answer({ text: 'Found 2 notes:\n- Deploy checklist\n- Tea blends' }))).toBeUndefined();
    expect(hitsOf(answer({ text: '{"count": 2}' }))).toBeUndefined();
  });
});
