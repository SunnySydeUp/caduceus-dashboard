// The learning graph for the screen: where each node is drawn, and the same graph as a list. Pure: no DOM, no React. The list is the graph's
// accessible form (keyboard, screen reader and phone), so everything the drawing shows, the list says in words.
import type { Graph, GraphNode } from './memory-model.ts';

export interface Placed {
  node: GraphNode;
  x: number;
  y: number;
  radius: number;
  /** The node's category rank by size, from 0: which colour it is drawn in. */
  cluster: number;
}

export interface PlacedEdge {
  source: string;
  target: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Layout {
  nodes: Placed[];
  edges: PlacedEdge[];
}

const MAX_RADIUS = 14;

/** The categories by size, the larger first, then by name. */
function categoryRanks(nodes: readonly GraphNode[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const node of nodes) sizes.set(node.category, (sizes.get(node.category) ?? 0) + 1);
  return new Map([...sizes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([category], rank) => [category, rank]));
}

/**
 * Places the nodes on a sunflower spiral that fills the box, in the order of their category and name, so the same graph is in the same
 * place every time. A node that is used more is drawn larger. The circles never touch: their size is held under what the spiral leaves.
 */
export function layoutGraph(graph: Graph, size: { width: number; height: number }): Layout {
  const ranks = categoryRanks(graph.nodes);
  const ordered = [...graph.nodes].sort((a, b) => (ranks.get(a.category) ?? 0) - (ranks.get(b.category) ?? 0) || a.id.localeCompare(b.id));
  const count = ordered.length;
  if (count === 0) return { nodes: [], edges: [] };

  const golden = Math.PI * (3 - Math.sqrt(5));
  const reach = Math.sqrt(count - 0.5) || 1;
  const sx = count === 1 ? 0 : (size.width / 2 - MAX_RADIUS) / reach;
  const sy = count === 1 ? 0 : (size.height / 2 - MAX_RADIUS) / reach;
  const spots = ordered.map((_, index) => {
    const distance = Math.sqrt(index + 0.5);
    return { x: size.width / 2 + Math.cos(index * golden) * distance * sx, y: size.height / 2 + Math.sin(index * golden) * distance * sy };
  });
  let nearest = Infinity;
  for (const [index, a] of spots.entries()) for (const b of spots.slice(index + 1)) nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.y - b.y));
  const biggest = Math.min(MAX_RADIUS, nearest * 0.45);
  const mostUsed = Math.max(...ordered.map((node) => node.useCount));

  const nodes = ordered.map((node, index): Placed => {
    const weight = mostUsed === 0 ? 0 : Math.log2(1 + node.useCount) / Math.log2(1 + mostUsed);
    return { node, x: spots[index].x, y: spots[index].y, radius: biggest * (0.55 + 0.45 * weight), cluster: ranks.get(node.category) ?? 0 };
  });
  const at = new Map(nodes.map((placed) => [placed.node.id, placed]));
  const edges = graph.edges.flatMap(({ source, target }) => {
    const from = at.get(source);
    const to = at.get(target);
    return from && to ? [{ source, target, x1: from.x, y1: from.y, x2: to.x, y2: to.y }] : [];
  });
  return { nodes, edges };
}

export interface ListRow {
  node: GraphNode;
  /** The nodes it is linked to, by label. */
  links: GraphNode[];
}

export interface ListGroup {
  category: string;
  rows: ListRow[];
}

const byLabel = (a: GraphNode, b: GraphNode) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()) || a.id.localeCompare(b.id);

/** The graph as a list, grouped by category (the larger group first), keeping the nodes whose label or category has every word of `query`. */
export function graphList(graph: Graph, query: string): ListGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = graph.nodes.filter((node) => words.every((word) => `${node.label} ${node.category}`.toLowerCase().includes(word)));
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const linked = new Map<string, GraphNode[]>();
  for (const { source, target } of graph.edges) {
    const a = byId.get(source);
    const b = byId.get(target);
    if (!a || !b) continue;
    linked.set(a.id, [...(linked.get(a.id) ?? []), b]);
    linked.set(b.id, [...(linked.get(b.id) ?? []), a]);
  }
  const groups = new Map<string, GraphNode[]>();
  for (const node of shown) groups.set(node.category, [...(groups.get(node.category) ?? []), node]);
  const sizes = categoryRanks(graph.nodes);
  return [...groups]
    .sort(([a], [b]) => (sizes.get(a) ?? 0) - (sizes.get(b) ?? 0))
    .map(([category, nodes]) => ({ category, rows: nodes.sort(byLabel).map((node) => ({ node, links: [...(linked.get(node.id) ?? [])].sort(byLabel) })) }));
}

const times = (count: number) => (count === 0 ? 'never used' : count === 1 ? 'used once' : `used ${count} times`);

/** What a node is, in words. */
export function describeNode(node: GraphNode): string {
  if (node.kind === 'memory') return `Memory chunk of ${node.memorySource === 'profile' ? 'USER.md' : 'MEMORY.md'}`;
  const parts = ['Skill'];
  if (node.createdBy === 'agent') parts.push('made by the agent');
  else if (node.createdBy === 'learn') parts.push('taught with /learn');
  if (node.pinned) parts.push('pinned');
  if (node.state !== 'active') parts.push(node.state);
  parts.push(times(node.useCount));
  return parts.join(', ');
}
