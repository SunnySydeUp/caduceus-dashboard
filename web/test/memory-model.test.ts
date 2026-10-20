import { describe, expect, test } from 'vitest';
import { describeNode, graphList, layoutGraph } from '../src/modules/memory/graph-view.ts';
import type { Graph, GraphNode } from '../src/modules/memory/memory-model.ts';

const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({ id, label: id, kind: 'skill', category: 'ops', useCount: 0, state: 'active', createdBy: undefined, pinned: false, memorySource: undefined, timestamp: undefined, ...over });
const graph = (nodes: GraphNode[], edges: [string, string][] = []): Graph => ({ nodes, edges: edges.map(([source, target]) => ({ source, target })), clusters: [], stats: { learnedSkills: 0, memoryNodes: 0, edges: edges.length, isolatedPercent: 0 } });

describe('the learning graph laid out', () => {
  const size = { width: 600, height: 400 };
  const many = graph([...Array.from({ length: 12 }, (_, index) => node(`skill-${index}`, { category: index % 2 ? 'ops' : 'writing', useCount: index })), node('memory:memory:0', { kind: 'memory', category: 'memory', memorySource: 'memory' })]);

  test('puts every node inside the box, none on top of another, and the same graph in the same place every time', () => {
    const first = layoutGraph(many, size);
    const second = layoutGraph(many, size);

    expect(first.nodes).toEqual(second.nodes);
    expect(first.nodes).toHaveLength(13);
    for (const placed of first.nodes) {
      expect(placed.x - placed.radius).toBeGreaterThanOrEqual(0);
      expect(placed.x + placed.radius).toBeLessThanOrEqual(size.width);
      expect(placed.y - placed.radius).toBeGreaterThanOrEqual(0);
      expect(placed.y + placed.radius).toBeLessThanOrEqual(size.height);
    }
    for (const [index, a] of first.nodes.entries())
      for (const b of first.nodes.slice(index + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.node.id} and ${b.node.id}`).toBeGreaterThan(a.radius + b.radius);
  });

  test('stays inside the box with no circle touching another however many nodes there are, by drawing them smaller', () => {
    const crowd = graph(Array.from({ length: 300 }, (_, index) => node(`n${index}`, { category: `c${index % 7}`, useCount: index % 11 })));
    const laid = layoutGraph(crowd, size);

    expect(Math.max(...laid.nodes.map((placed) => placed.radius))).toBeLessThan(14);
    for (const placed of laid.nodes) {
      expect(placed.x - placed.radius).toBeGreaterThanOrEqual(0);
      expect(placed.x + placed.radius).toBeLessThanOrEqual(size.width);
      expect(placed.y - placed.radius).toBeGreaterThanOrEqual(0);
      expect(placed.y + placed.radius).toBeLessThanOrEqual(size.height);
    }
    for (const [index, a] of laid.nodes.entries()) for (const b of laid.nodes.slice(index + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.radius + b.radius);
  });

  test('a node that is used more is drawn larger, and an edge joins the two places of its nodes', () => {
    const laid = layoutGraph(graph([node('a', { useCount: 0 }), node('b', { useCount: 20 })], [['a', 'b']]), size);
    const [a, b] = laid.nodes;

    expect(b.radius).toBeGreaterThan(a.radius);
    expect(laid.edges).toEqual([{ source: 'a', target: 'b', x1: a.x, y1: a.y, x2: b.x, y2: b.y }]);
    expect(layoutGraph(graph([]), size)).toEqual({ nodes: [], edges: [] });
  });
});

describe('the learning graph as a list', () => {
  const sample = graph(
    [node('deploy-notes', { category: 'ops', useCount: 3, createdBy: 'agent' }), node('staging-check', { category: 'ops', useCount: 1 }), node('memory:memory:0', { kind: 'memory', category: 'memory', label: 'Deploys go through staging', memorySource: 'memory' }), node('lonely', { category: 'writing', pinned: true })],
    [['deploy-notes', 'staging-check'], ['memory:memory:0', 'staging-check']],
  );

  test('groups nodes by category, the larger group first, and says what each is linked to', () => {
    const groups = graphList(sample, '');

    expect(groups.map((group) => [group.category, group.rows.map((row) => row.node.id)])).toEqual([
      ['ops', ['deploy-notes', 'staging-check']],
      ['memory', ['memory:memory:0']],
      ['writing', ['lonely']],
    ]);
    expect(groups[0].rows[1].links.map((linked) => linked.id)).toEqual(['deploy-notes', 'memory:memory:0']);
    expect(groups[2].rows[0].links).toEqual([]);
  });

  test('a search keeps the rows whose label or category has the words, in any case', () => {
    expect(graphList(sample, 'DEPLOY').flatMap((group) => group.rows.map((row) => row.node.id))).toEqual(['deploy-notes', 'memory:memory:0']);
    expect(graphList(sample, 'writing').map((group) => group.category)).toEqual(['writing']);
    expect(graphList(sample, 'nothing like it')).toEqual([]);
  });

  test('a node is described in words for a screen reader and for the list', () => {
    expect(describeNode(sample.nodes[0])).toBe('Skill, made by the agent, used 3 times');
    expect(describeNode(sample.nodes[1])).toBe('Skill, used once');
    expect(describeNode(sample.nodes[2])).toBe('Memory chunk of MEMORY.md');
    expect(describeNode(node('chunk', { kind: 'memory', memorySource: 'profile' }))).toBe('Memory chunk of USER.md');
    expect(describeNode(sample.nodes[3])).toBe('Skill, pinned, never used');
  });
});
