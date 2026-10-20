// The playbook graph, free of the DOM and of React (M6 #04; work model §2.3): where each stage of a definition is drawn and how each edge runs, which edges
// are loop-backs, which stage the arrow keys reach from the stage you are on, how a run's latest attempt of a stage looks on its node, and what a node is
// called for a screen reader. `PlaybookGraph.tsx` only draws what this says.
//
// Layout. A stage's column (layer) is the longest path to it from the start over the forward edges, the edges that are not loop-backs; a loop-back is an
// edge that leads to a stage already on the way (the depth-first walk the definition's own check uses, in the order the edges are written). Stages in one
// column sit in lanes (rows): the stages a stage forks into spread around its lane, a join sits between the branches it joins, and a chain stays in one lane.
// An edge that skips columns passes through the lanes of the columns it crosses, which no stage takes, so no edge runs through a stage. A loop-back is an
// arc above (or, when the stage has others above it, below) every lane, in a track of its own when it would run over another, from the stage that loops to
// the stage it returns to.
import type { EdgeCondition, Playbook, PlaybookStage } from '@caduceus/contracts/playbooks';
import type { RunDetail, Verdict } from '@caduceus/contracts/playbook-runs';
import { taskStatusChip, VERDICT_CHIP, waitingAtGate } from './playbook-runs-model.ts';

/** What the graph needs of a definition. */
export type GraphDefinition = Pick<Playbook, 'stages' | 'edges'>;

/** The drawing's measures, in user units of the SVG (the drawing scales with the root text size, not with the window). */
export const GRAPH = {
  nodeWidth: 184,
  nodeHeight: 72,
  /** Between two columns: wide enough for the label of an edge. */
  gap: 64,
  /** From one lane to the next, top to top. */
  lanePitch: 104,
  pad: 16,
  /** The first loop-back track above (or below) the stages, and the distance between tracks. */
  trackFirst: 26,
  trackStep: 26,
  arrow: 7,
  /** The corner radius of a loop-back. */
  corner: 8,
  /** The edge of a stage that loop-backs keep clear of. */
  slotPad: 14,
} as const;

/** What an edge's condition is called on the graph. */
export const EDGE_WORD: Record<EdgeCondition, string> = { on_done: 'done', on_fail: 'fail', on_approve: 'approve', on_reject: 'reject', always: 'always' };

/** What a gate is called on a node. */
export const GATE_BADGE: Record<NonNullable<PlaybookStage['gate']>, string> = { approval: 'Approval', clarify: 'Question' };

/** The most characters of a title a node shows; the whole title is its tooltip and its accessible name. */
const TITLE_CHARS = 22;

export const truncateTitle = (title: string, max = TITLE_CHARS): string => (title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title);

export interface GraphNode {
  key: string;
  /** Where the stage is in the definition's list, from 0. */
  index: number;
  /** The column, from 0 at the first stage. */
  layer: number;
  /** The row of the column; a fork's branches are a whole lane apart and a join sits between them, so it may be halfway between two lanes. */
  lane: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphEdge {
  /** Where the edge is in the definition's list. */
  index: number;
  from: string;
  to: string;
  when: EdgeCondition;
  /** An edge back to a stage already on the way: drawn as an arc, with the attempts the stage it returns to allows. */
  loop: boolean;
  /** Which side of the stages a loop-back runs on. */
  side?: 'top' | 'bottom';
  path: string;
  /** The arrow head, a closed path. */
  arrow: string;
  label: { text: string; x: number; y: number };
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

interface Edge {
  index: number;
  from: string;
  to: string;
  when: EdgeCondition;
}

/**
 * The indexes of the edges that lead back to a stage already on the way: a depth-first walk from the first stage in the order the edges are written, and then
 * from any stage it did not reach (a definition being written may have some). It is the walk `readPlaybook` uses to ask for `max_attempts`.
 */
export function loopEdges(definition: GraphDefinition): Set<number> {
  const back = new Set<number>();
  const done = new Set<string>();
  const onPath = new Set<string>();
  const walk = (key: string): void => {
    onPath.add(key);
    definition.edges.forEach((edge, index) => {
      if (edge.from !== key) return;
      if (onPath.has(edge.to)) back.add(index);
      else if (!done.has(edge.to)) walk(edge.to);
    });
    onPath.delete(key);
    done.add(key);
  };
  for (const stage of definition.stages) if (!done.has(stage.key)) walk(stage.key);
  return back;
}

/** A column slot: a stage, or the place an edge that skips the column passes through. */
interface Cell {
  id: string;
  layer: number;
  /** The cells of the column before that this one is reached from. */
  preds: string[];
  order: number;
  lane: number;
}

type Side = 'top' | 'bottom';

interface Loop {
  edge: Edge;
  lo: number;
  hi: number;
  side: Side;
  track: number;
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** Where every stage and edge of `definition` is drawn. */
export function layoutGraph(definition: GraphDefinition): GraphLayout {
  const { stages } = definition;
  const { nodeWidth: W, nodeHeight: H, gap, lanePitch, pad, trackFirst, trackStep, arrow, corner, slotPad } = GRAPH;
  const known = new Set(stages.map((stage) => stage.key));
  const loopIndexes = loopEdges(definition);
  const edges: Edge[] = definition.edges.flatMap((edge, index) => (known.has(edge.from) && known.has(edge.to) ? [{ ...edge, index }] : []));
  const forward = edges.filter((edge) => !loopIndexes.has(edge.index));

  // Columns: the longest path over the forward edges (they cannot form a cycle).
  const incoming = new Map<string, Edge[]>();
  for (const edge of forward) incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
  const columns = new Map<string, number>();
  const columnOf = (key: string): number => {
    const cached = columns.get(key);
    if (cached !== undefined) return cached;
    const column = Math.max(0, ...(incoming.get(key) ?? []).map((edge) => columnOf(edge.from) + 1));
    columns.set(key, column);
    return column;
  };

  // Cells: a stage each, and one for every column an edge passes over.
  const cells = new Map<string, Cell>();
  stages.forEach((stage, order) => cells.set(stage.key, { id: stage.key, layer: columnOf(stage.key), preds: [], order, lane: 0 }));
  const passes = new Map<number, string[]>();
  for (const edge of forward) {
    let previous = edge.from;
    const through: string[] = [];
    for (let layer = columnOf(edge.from) + 1; layer < columnOf(edge.to); layer++) {
      const id = `~${edge.index}:${layer}`;
      cells.set(id, { id, layer, preds: [previous], order: stages.length + edge.index, lane: 0 });
      through.push(id);
      previous = id;
    }
    passes.set(edge.index, through);
    const target = cells.get(edge.to);
    if (target && !target.preds.includes(previous)) target.preds.push(previous);
  }

  // Lanes, column by column: a cell wants the middle of the cells it comes from, the cells that share where they come from spread around it, and no two
  // cells of a column are closer than one lane.
  const everyCell = [...cells.values()];
  const lastColumn = Math.max(0, ...everyCell.map((cell) => cell.layer));
  for (let layer = 0; layer <= lastColumn; layer++) {
    const column = everyCell.filter((cell) => cell.layer === layer).sort((a, b) => a.order - b.order);
    const wanted = new Map<string, number>();
    const siblings = new Map<string, Cell[]>();
    let free = 0;
    for (const cell of column) {
      if (cell.preds.length === 0) wanted.set(cell.id, free++);
      else {
        const sharing = cell.preds.toSorted().join('|');
        siblings.set(sharing, [...(siblings.get(sharing) ?? []), cell]);
      }
    }
    for (const group of siblings.values()) {
      group.forEach((cell, position) => {
        const middle = cell.preds.reduce((sum, pred) => sum + (cells.get(pred)?.lane ?? 0), 0) / cell.preds.length;
        wanted.set(cell.id, middle + position - (group.length - 1) / 2);
      });
    }
    let previous: number | undefined;
    for (const cell of column.toSorted((a, b) => (wanted.get(a.id) ?? 0) - (wanted.get(b.id) ?? 0) || a.order - b.order)) {
      cell.lane = previous === undefined ? (wanted.get(cell.id) ?? 0) : Math.max(wanted.get(cell.id) ?? 0, previous + 1);
      previous = cell.lane;
    }
  }
  const firstLane = Math.min(0, ...everyCell.map((cell) => cell.lane));
  for (const cell of everyCell) cell.lane -= firstLane;
  const lastLane = Math.max(0, ...everyCell.map((cell) => cell.lane));
  const laneOf = (key: string): number => cells.get(key)?.lane ?? 0;
  const topOfColumn = new Map<number, number>();
  const bottomOfColumn = new Map<number, number>();
  for (const cell of everyCell) {
    topOfColumn.set(cell.layer, Math.min(topOfColumn.get(cell.layer) ?? Infinity, cell.lane));
    bottomOfColumn.set(cell.layer, Math.max(bottomOfColumn.get(cell.layer) ?? -Infinity, cell.lane));
  }

  // Loop-backs: the side each runs on (above, unless a stage it joins has others above it and none below), and a track on that side.
  const loops: Loop[] = edges
    .filter((edge) => loopIndexes.has(edge.index))
    .map((edge): Loop => {
      const ends = [edge.from, edge.to];
      const above = ends.every((key) => laneOf(key) === topOfColumn.get(columnOf(key)));
      const below = ends.every((key) => laneOf(key) === bottomOfColumn.get(columnOf(key)));
      const layers = ends.map(columnOf);
      return { edge, lo: Math.min(...layers), hi: Math.max(...layers), side: !above && below ? 'bottom' : 'top', track: 0 };
    });
  const placed: Loop[] = [];
  for (const loop of loops.toSorted((a, b) => a.hi - a.lo - (b.hi - b.lo) || a.lo - b.lo || a.edge.index - b.edge.index)) {
    const taken = new Set(placed.filter((other) => other.side === loop.side && other.lo <= loop.hi && loop.lo <= other.hi).map((other) => other.track));
    while (taken.has(loop.track)) loop.track++;
    placed.push(loop);
  }
  const tracks = (side: Side): number => Math.max(0, ...loops.filter((loop) => loop.side === side).map((loop) => loop.track + 1));
  const gutter = (side: Side): number => (tracks(side) === 0 ? pad : trackFirst + (tracks(side) - 1) * trackStep + 12);

  const top = gutter('top');
  const columnX = (layer: number): number => pad + layer * (W + gap);
  const laneY = (lane: number): number => top + lane * lanePitch;
  const bottom = laneY(lastLane) + H;
  const nodes: GraphNode[] = stages.map((stage, index) => {
    const layer = columnOf(stage.key);
    const lane = laneOf(stage.key);
    return { key: stage.key, index, layer, lane, x: columnX(layer), y: laneY(lane), width: W, height: H };
  });
  const at = new Map(nodes.map((node) => [node.key, node]));

  // Where on a stage's top or bottom edge each loop-back leaves it or comes in: the ones that come in on the left, the outermost leftmost, and the ones
  // that leave on the right, the outermost rightmost, so that no arc crosses another.
  const slots = new Map<string, number>();
  const ends = new Map<string, { id: string; role: 'target' | 'source'; track: number }[]>();
  for (const loop of loops) {
    for (const [key, role] of [[loop.edge.to, 'target'], [loop.edge.from, 'source']] as const) {
      const where = `${key}|${loop.side}`;
      ends.set(where, [...(ends.get(where) ?? []), { id: `${loop.edge.index}|${role}`, role, track: loop.track }]);
    }
  }
  for (const [where, list] of ends) {
    const node = at.get(where.split('|')[0]);
    if (!node) continue;
    const ordered = [...list.filter((end) => end.role === 'target').sort((a, b) => b.track - a.track), ...list.filter((end) => end.role === 'source').sort((a, b) => a.track - b.track)];
    ordered.forEach((end, position) => slots.set(`${where}|${end.id}`, round(node.x + slotPad + ((position + 0.5) * (W - 2 * slotPad)) / ordered.length)));
  }

  const laid: GraphEdge[] = edges.map((edge) => {
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    const word = EDGE_WORD[edge.when];
    if (!from || !to) throw new Error(`The stages of edge ${edge.index} are known`);
    const loop = loops.find((candidate) => candidate.edge.index === edge.index);
    if (loop) {
      const attempts = stages.find((stage) => stage.key === edge.to)?.max_attempts;
      const sx = slots.get(`${edge.from}|${loop.side}|${edge.index}|source`) ?? from.x + W / 2;
      const tx = slots.get(`${edge.to}|${loop.side}|${edge.index}|target`) ?? to.x + W / 2;
      const up = loop.side === 'top';
      const rail = up ? top - (trackFirst + loop.track * trackStep) : bottom + trackFirst + loop.track * trackStep;
      const leave = up ? from.y : from.y + H;
      const arrive = up ? to.y : to.y + H;
      const turn = up ? corner : -corner;
      const path = `M ${sx} ${leave} V ${rail + turn} Q ${sx} ${rail} ${sx - corner} ${rail} H ${tx + corner} Q ${tx} ${rail} ${tx} ${rail + turn} V ${up ? arrive - arrow : arrive + arrow}`;
      const back = up ? arrive - arrow : arrive + arrow;
      return { index: edge.index, from: edge.from, to: edge.to, when: edge.when, loop: true, side: loop.side, path, arrow: `M ${tx} ${arrive} L ${tx - 4} ${back} L ${tx + 4} ${back} Z`, label: { text: attempts === undefined ? word : `${word} × ${attempts}`, x: round((sx + tx) / 2), y: rail } };
    }
    const start: [number, number] = [from.x + W, from.y + H / 2];
    const end: [number, number] = [to.x - arrow, to.y + H / 2];
    const through = (passes.get(edge.index) ?? []).map((id): [number, number] => [columnX(cells.get(id)?.layer ?? 0), laneY(laneOf(id)) + H / 2]);
    const curve = ([x0, y0]: [number, number], [x1, y1]: [number, number]) => `C ${round((x0 + x1) / 2)} ${y0} ${round((x0 + x1) / 2)} ${y1} ${x1} ${y1}`;
    let path = `M ${start[0]} ${start[1]}`;
    let previous = start;
    for (const [x, y] of through) {
      path += ` ${curve(previous, [x, y])} L ${x + W} ${y}`;
      previous = [x + W, y];
    }
    path += ` ${curve(previous, end)}`;
    const first = through[0] ?? end;
    // Edges that join the same two stages on different conditions are drawn together: their labels are not.
    const twins = edges.filter((other) => other.from === edge.from && other.to === edge.to);
    const shift = (twins.findIndex((other) => other.index === edge.index) - (twins.length - 1) / 2) * 18;
    return {
      index: edge.index,
      from: edge.from,
      to: edge.to,
      when: edge.when,
      loop: false,
      path,
      arrow: `M ${to.x} ${end[1]} L ${to.x - arrow} ${end[1] - 4} L ${to.x - arrow} ${end[1] + 4} Z`,
      label: { text: word, x: round((start[0] + first[0]) / 2), y: round((start[1] + first[1]) / 2 + shift) },
    };
  });

  return { nodes, edges: laid, width: columnX(lastColumn) + W + pad, height: bottom + gutter('bottom') };
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * The stage the arrow key `direction` reaches from `key`. Right and left follow an edge to a later or an earlier column (the nearest column first, then the
 * nearest lane); up and down move to the next stage above or below in the same column, which is how one reaches the other branches of a fork.
 */
export function neighbour(layout: Pick<GraphLayout, 'nodes' | 'edges'>, key: string, direction: Direction): string | undefined {
  const here = layout.nodes.find((node) => node.key === key);
  if (!here) return undefined;
  if (direction === 'up' || direction === 'down') {
    const sign = direction === 'up' ? -1 : 1;
    const column = layout.nodes.filter((node) => node.layer === here.layer && (node.lane - here.lane) * sign > 0);
    return column.toSorted((a, b) => Math.abs(a.lane - here.lane) - Math.abs(b.lane - here.lane) || a.index - b.index)[0]?.key;
  }
  const sign = direction === 'right' ? 1 : -1;
  const linked = new Set(layout.edges.flatMap((edge) => (edge.from === key ? [edge.to] : edge.to === key ? [edge.from] : [])));
  const candidates = layout.nodes.filter((node) => linked.has(node.key) && (node.layer - here.layer) * sign > 0);
  return candidates.toSorted((a, b) => Math.abs(a.layer - here.layer) - Math.abs(b.layer - here.layer) || Math.abs(a.lane - here.lane) - Math.abs(b.lane - here.lane) || a.index - b.index)[0]?.key;
}

/** How a stage looks on a run: the colour of its node. */
export type StageState = 'pending' | 'queued' | 'running' | 'waiting' | 'blocked' | 'done' | 'failed' | 'rejected';

/** What a stage's latest attempt says about it. */
export interface StageLive {
  state: StageState;
  /** The words under the title: how the attempt ended, or where its task is. */
  label: string;
  /** The task of the latest attempt; nothing for a stage that has not started. */
  taskId?: string;
  /** The Kanban board's own word for the task's status. */
  status?: string;
  verdict?: Verdict;
  /** The number of the latest attempt, and how many attempts have been made. */
  attempt: number;
  attempts: number;
}

/** A stage's live state, by the stage's key, for every stage of the run's definition: its latest attempt, its Kanban status and its verdict. */
export function liveStages({ definition, timeline }: Pick<RunDetail, 'definition' | 'timeline'>): Map<string, StageLive> {
  return new Map(
    definition.stages.map((stage): [string, StageLive] => {
      const tries = timeline.filter((entry) => entry.stage === stage.key);
      const latest = tries.reduce<(typeof tries)[number] | undefined>((newest, entry) => (newest === undefined || entry.attempt >= newest.attempt ? entry : newest), undefined);
      if (!latest) return [stage.key, { state: 'pending', label: 'Not started', attempt: 0, attempts: 0 }];
      const kanban = taskStatusChip(latest.status).label;
      const verdict = latest.verdict;
      const state: StageState =
        verdict === 'failed' ? 'failed'
        : verdict === 'rejected' ? 'rejected'
        : waitingAtGate(latest, definition) ? 'waiting'
        : verdict !== undefined || latest.status === 'done' ? 'done'
        : latest.status === 'running' ? 'running'
        : latest.status === 'review' ? 'waiting'
        : latest.status === 'blocked' ? 'blocked'
        : 'queued';
      const label = verdict !== undefined ? VERDICT_CHIP[verdict].label : state === 'waiting' ? 'Waiting for you' : kanban;
      return [stage.key, { state, label, taskId: latest.taskId, status: kanban, verdict, attempt: latest.attempt, attempts: tries.length }];
    }),
  );
}

/** `attempt 2 of 5` when the stage bounds its attempts, `attempt 2` when it does not. */
export const attemptText = (attempt: number, max: number | undefined): string => (max === undefined ? `attempt ${attempt}` : `attempt ${attempt} of ${max}`);

const LEADS_WHEN: Record<EdgeCondition, string> = { on_done: 'when it is done', on_fail: 'when it fails', on_approve: 'when it is approved', on_reject: 'when it is rejected', always: 'always' };

/** A node's accessible name: its place in the list, its title in full, its gate, its attempts, how it stands on a run, and where it leads. */
export function nodeName(node: { index: number; title: string; stage: PlaybookStage; live?: StageLive; leads: readonly { when: EdgeCondition; title: string }[] }): string {
  const { stage, live } = node;
  const parts = [`Stage ${node.index + 1}: ${node.title}`];
  if (stage.gate) parts.push(stage.gate === 'approval' ? 'Approval gate' : 'Question gate');
  if (stage.max_attempts !== undefined) parts.push(`up to ${stage.max_attempts} attempts`);
  if (live) parts.push(live.attempt === 0 ? live.label : `${live.status ?? live.label}${live.verdict === undefined ? '' : `, ${live.label}`}, ${attemptText(live.attempt, stage.max_attempts)}${live.attempts > 1 ? `, ${live.attempts} attempts so far` : ''}`);
  if (node.leads.length > 0) parts.push(`Leads to ${node.leads.map((lead) => `${lead.title} ${LEADS_WHEN[lead.when]}`).join(', ')}`);
  return parts.join('. ');
}
