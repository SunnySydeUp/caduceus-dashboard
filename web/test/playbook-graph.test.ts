import { describe, expect, test } from 'vitest';
import type { Playbook, PlaybookEdge } from '@caduceus/contracts/playbooks';
import { SEED_PLAYBOOKS } from '../../server/src/playbook-seeds.ts';
import { attemptText, GRAPH, layoutGraph, liveStages, loopEdges, neighbour, nodeName, truncateTitle, type GraphLayout } from '../src/modules/work/playbook-graph.ts';

const BRIEF = { brief: { goal: 'Do it.' } };
const stage = (key: string, extra: Record<string, unknown> = {}) => ({ key, title: `Title of ${key}`, ...BRIEF, ...extra });
const edge = (from: string, to: string, when: PlaybookEdge['when'] = 'on_done'): PlaybookEdge => ({ from, to, when });
const seed = (id: string) => {
  const found = SEED_PLAYBOOKS.find((playbook) => playbook.id === id);
  if (!found) throw new Error(`no seed ${id}`);
  return found;
};

/** start forks into a, b and c; a has a second step; the three join in `join`, which leads on to `end`. b reaches the join over a column it skips, c too. */
const FORK: Pick<Playbook, 'stages' | 'edges'> = {
  stages: ['start', 'a', 'b', 'c', 'a2', 'join', 'end'].map((key) => stage(key)),
  edges: [edge('start', 'a'), edge('start', 'b'), edge('start', 'c'), edge('a', 'a2'), edge('a2', 'join'), edge('b', 'join'), edge('c', 'join'), edge('join', 'end')],
};

const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The points a path passes through: its own numbers read back, a cubic sampled at its tenths. */
function samples(path: string): [number, number][] {
  const out: [number, number][] = [];
  let at: [number, number] = [0, 0];
  for (const [, command, rest] of path.matchAll(/([MLCHVQ]) ([^MLCHVQ]+)/g)) {
    const n = rest.trim().split(/\s+/).map(Number);
    if (command === 'M' || command === 'L') {
      at = [n[0], n[1]];
      out.push(at);
    } else if (command === 'H') {
      at = [n[0], at[1]];
      out.push(at);
    } else if (command === 'V') {
      at = [at[0], n[0]];
      out.push(at);
    } else if (command === 'C') {
      const [x0, y0] = at;
      for (let t = 0.1; t <= 1.0001; t += 0.1) {
        const u = 1 - t;
        out.push([u ** 3 * x0 + 3 * u * u * t * n[0] + 3 * u * t * t * n[2] + t ** 3 * n[4], u ** 3 * y0 + 3 * u * u * t * n[1] + 3 * u * t * t * n[3] + t ** 3 * n[5]]);
      }
      at = [n[4], n[5]];
    } else {
      at = [n[2], n[3]];
      out.push(at);
    }
  }
  return out;
}

function expectSound(definition: Pick<Playbook, 'stages' | 'edges'>, layout: GraphLayout) {
  // Every stage is placed once.
  expect(layout.nodes.map((node) => node.key).toSorted()).toEqual(definition.stages.map((item) => item.key).toSorted());
  expect(layout.nodes.map((node) => node.index)).toEqual(definition.stages.map((_, index) => index));
  // No two nodes overlap, and every node is inside the drawing.
  for (const [i, a] of layout.nodes.entries()) {
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.x + a.width).toBeLessThanOrEqual(layout.width);
    expect(a.y + a.height).toBeLessThanOrEqual(layout.height);
    for (const b of layout.nodes.slice(i + 1)) expect(overlap(a, b), `${a.key} and ${b.key} overlap`).toBe(false);
  }
  const node = (key: string) => layout.nodes.find((candidate) => candidate.key === key);
  expect(layout.edges).toHaveLength(definition.edges.length);
  for (const drawn of layout.edges) {
    const from = node(drawn.from);
    const to = node(drawn.to);
    if (!from || !to) throw new Error('an edge joins stages that are placed');
    if (drawn.loop) {
      // A loop-back returns to the same column or an earlier one.
      expect(to.x, `${drawn.from} → ${drawn.to}`).toBeLessThanOrEqual(from.x);
    } else {
      // A forward edge goes from the right of one stage to the left of a later one.
      expect(from.x + from.width, `${drawn.from} → ${drawn.to}`).toBeLessThan(to.x);
      // And it runs through no stage.
      for (const [x, y] of samples(drawn.path)) {
        for (const other of layout.nodes.filter((candidate) => candidate.key !== drawn.from && candidate.key !== drawn.to)) {
          expect(x > other.x && x < other.x + other.width && y > other.y && y < other.y + other.height, `${drawn.from} → ${drawn.to} runs through ${other.key}`).toBe(false);
        }
      }
    }
  }
}

describe('which edges are loop-backs', () => {
  test('software delivery loops back to design, and five times to implement', () => {
    const playbook = seed('software-delivery');
    const loops = [...loopEdges(playbook)].map((index) => `${playbook.edges[index].from}>${playbook.edges[index].to}:${playbook.edges[index].when}`);
    expect(loops.toSorted()).toEqual(
      ['design_review>design:on_reject', 'check>implement:on_fail', 'code_review>implement:on_fail', 'security>implement:on_fail', 'verify>implement:on_fail', 'release_approval>implement:on_reject'].toSorted(),
    );
  });

  test('draft → review loops back on a reject, and a plain chain has no loop', () => {
    const draft = seed('draft-review');
    expect([...loopEdges(draft)].map((index) => draft.edges[index])).toEqual([edge('review', 'draft', 'on_reject')]);
    expect(loopEdges(seed('research-summarise')).size).toBe(0);
  });

  test('a stage that leads to itself is a loop, and the edge into a join from a second branch is not', () => {
    const definition = { stages: [stage('a'), stage('b'), stage('c')], edges: [edge('a', 'b'), edge('a', 'c'), edge('b', 'c'), edge('c', 'c', 'on_fail')] };
    expect([...loopEdges(definition)]).toEqual([3]);
  });

  test('a stage no edge reaches still gets a walk of its own', () => {
    const definition = { stages: [stage('a'), stage('b'), stage('c')], edges: [edge('a', 'b'), edge('c', 'a'), edge('b', 'c')] };
    // a → b → c → a: the edge back into a is the loop.
    expect([...loopEdges(definition)]).toEqual([1]);
  });
});

describe('the layout of the seeds', () => {
  for (const playbook of SEED_PLAYBOOKS) {
    test(`${playbook.name}: every stage once, nothing overlaps, forward edges go right and no edge runs through a stage`, () => {
      const layout = layoutGraph(playbook);
      expectSound(playbook, layout);
      expect(layout.edges.filter((drawn) => drawn.loop).map((drawn) => drawn.index)).toEqual([...loopEdges(playbook)].toSorted((a, b) => a - b));
    });
  }

  test('a chain is one column per stage in one lane, and its loop-backs are arcs above it', () => {
    const playbook = seed('software-delivery');
    const layout = layoutGraph(playbook);
    expect(layout.nodes.map((node) => node.layer)).toEqual(playbook.stages.map((_, index) => index));
    expect(new Set(layout.nodes.map((node) => node.lane))).toEqual(new Set([0]));
    expect(new Set(layout.nodes.map((node) => node.y)).size).toBe(1);
    const loops = layout.edges.filter((drawn) => drawn.loop);
    expect(loops).toHaveLength(6);
    expect(loops.every((drawn) => drawn.side === 'top')).toBe(true);
    // Every loop-back is drawn clear of the stages: above all of them.
    const rails = loops.map((drawn) => drawn.label.y);
    expect(Math.min(...layout.nodes.map((node) => node.y))).toBeGreaterThan(Math.max(...rails));
    // The five that return to implement run on tracks of their own, so their labels do not sit on each other.
    const toImplement = loops.filter((drawn) => drawn.to === 'implement');
    expect(new Set(toImplement.map((drawn) => drawn.label.y)).size).toBe(5);
  });

  test('a loop-back says the condition and how many attempts the stage it returns to allows; a forward edge says only the condition', () => {
    const layout = layoutGraph(seed('software-delivery'));
    const labels = (when: string, to: string) => layout.edges.filter((drawn) => drawn.when === when && drawn.to === to).map((drawn) => drawn.label.text);
    expect(labels('on_fail', 'implement')).toEqual(['fail × 5', 'fail × 5', 'fail × 5', 'fail × 5']);
    expect(labels('on_reject', 'implement')).toEqual(['reject × 5']);
    expect(labels('on_reject', 'design')).toEqual(['reject × 3']);
    expect(labels('on_approve', 'plan')).toEqual(['approve']);
    expect(labels('on_done', 'explore')).toEqual(['done']);
    expect(layoutGraph(seed('draft-review')).edges.map((drawn) => drawn.label.text)).toEqual(['done', 'approve', 'reject × 3']);
    expect(layoutGraph({ stages: [stage('a'), stage('b')], edges: [edge('a', 'b', 'always')] }).edges[0].label.text).toBe('always');
  });

  test('a loop-back arrives at the stage it returns to and leaves the stage that loops', () => {
    const playbook = seed('draft-review');
    const layout = layoutGraph(playbook);
    const back = layout.edges[2];
    const review = layout.nodes.find((node) => node.key === 'review');
    const draft = layout.nodes.find((node) => node.key === 'draft');
    if (!review || !draft) throw new Error('placed');
    const start = /^M ([\d.]+) ([\d.]+)/.exec(back.path);
    expect(Number(start?.[1])).toBeGreaterThan(review.x);
    expect(Number(start?.[1])).toBeLessThan(review.x + review.width);
    expect(Number(start?.[2])).toBe(review.y);
    const tip = /^M ([\d.]+) ([\d.]+) L/.exec(back.arrow);
    expect(Number(tip?.[1])).toBeGreaterThan(draft.x);
    expect(Number(tip?.[1])).toBeLessThan(draft.x + draft.width);
    expect(Number(tip?.[2])).toBe(draft.y);
  });
});

describe('parallel groups', () => {
  const layout = layoutGraph(FORK);
  const at = (key: string) => {
    const found = layout.nodes.find((node) => node.key === key);
    if (!found) throw new Error(`no node ${key}`);
    return found;
  };

  test('a fork’s branches are in the same column, in lanes of their own, and the join is one column after the longest branch', () => {
    expectSound(FORK, layout);
    expect([at('start').layer, at('a').layer, at('b').layer, at('c').layer, at('a2').layer, at('join').layer, at('end').layer]).toEqual([0, 1, 1, 1, 2, 3, 4]);
    expect(new Set([at('a').lane, at('b').lane, at('c').lane]).size).toBe(3);
    expect(at('a').y).toBeLessThan(at('b').y);
    expect(at('b').y).toBeLessThan(at('c').y);
    // The fork is centred on the stage it comes from, and the join sits between the branches it joins, in the same lane as the stage before the fork.
    expect(at('b').lane).toBe(at('start').lane);
    expect(at('join').lane).toBe(at('b').lane);
    expect(at('end').lane).toBe(at('join').lane);
  });

  test('two branches are a lane apart around their source, and the join is halfway between them', () => {
    const two = layoutGraph({ stages: ['s', 'x', 'y', 'j'].map((key) => stage(key)), edges: [edge('s', 'x'), edge('s', 'y'), edge('x', 'j'), edge('y', 'j')] });
    const lane = (key: string) => two.nodes.find((node) => node.key === key)?.lane ?? NaN;
    expect(lane('y') - lane('x')).toBe(1);
    expect(lane('s')).toBe((lane('x') + lane('y')) / 2);
    expect(lane('j')).toBe(lane('s'));
    expect(two.nodes.find((node) => node.key === 'x')?.layer).toBe(two.nodes.find((node) => node.key === 'y')?.layer);
  });

  test('a loop inside a branch is a loop-back and the rest are forward edges', () => {
    const definition = { stages: FORK.stages.map((item) => (item.key === 'a' ? { ...item, max_attempts: 2 } : item)), edges: [...FORK.edges, edge('a2', 'a', 'on_fail')] };
    const drawn = layoutGraph(definition);
    expectSound(definition, drawn);
    expect(drawn.edges.filter((item) => item.loop).map((item) => `${item.from}>${item.to}:${item.label.text}`)).toEqual(['a2>a:fail × 2']);
  });

  test('a loop-back to a stage with others above it, and none below, runs under the stages', () => {
    // y is written first, so the walk reaches it first and z → y is the loop; x, listed before y, is above it.
    const definition = {
      stages: [stage('start'), stage('x'), stage('y', { max_attempts: 2 }), stage('j'), stage('z')],
      edges: [edge('start', 'y'), edge('start', 'x'), edge('y', 'j'), edge('x', 'j'), edge('j', 'z'), edge('z', 'y', 'on_fail')],
    };
    const drawn = layoutGraph(definition);
    expectSound(definition, drawn);
    const back = drawn.edges.find((item) => item.loop);
    expect(back?.side).toBe('bottom');
    expect(back?.label.y).toBeGreaterThan(Math.max(...drawn.nodes.map((node) => node.y + node.height)));
    expect(drawn.height).toBeGreaterThan((back?.label.y ?? Infinity) + 8);
  });

  test('a definition with one stage and one with none are drawn too', () => {
    expectSound({ stages: [stage('only')], edges: [] }, layoutGraph({ stages: [stage('only')], edges: [] }));
    expect(layoutGraph({ stages: [], edges: [] }).nodes).toEqual([]);
  });

  test('the drawing is as wide as its columns and as tall as its lanes and loop tracks', () => {
    const { nodeWidth, gap, pad } = GRAPH;
    expect(layout.width).toBe(pad * 2 + 5 * nodeWidth + 4 * gap);
  });
});

describe('moving with the arrow keys', () => {
  const layout = layoutGraph(FORK);
  const loops = layoutGraph(seed('software-delivery'));

  test('right follows an edge to a later stage and left to an earlier one', () => {
    expect(neighbour(layout, 'start', 'right')).toBe('b');
    expect(neighbour(layout, 'a', 'right')).toBe('a2');
    expect(neighbour(layout, 'a2', 'left')).toBe('a');
    expect(neighbour(layout, 'join', 'left')).toBe('a2');
    expect(neighbour(layout, 'join', 'right')).toBe('end');
    expect(neighbour(layout, 'end', 'right')).toBeUndefined();
    expect(neighbour(layout, 'start', 'left')).toBeUndefined();
  });

  test('right from a stage that is joined only from far away goes there', () => {
    expect(neighbour(layout, 'b', 'right')).toBe('join');
    expect(neighbour(layout, 'join', 'left')).not.toBe('b');
  });

  test('up and down move between the branches of a column, nearest first, and stop at the ends', () => {
    expect(neighbour(layout, 'a', 'down')).toBe('b');
    expect(neighbour(layout, 'b', 'down')).toBe('c');
    expect(neighbour(layout, 'c', 'down')).toBeUndefined();
    expect(neighbour(layout, 'c', 'up')).toBe('b');
    expect(neighbour(layout, 'a', 'up')).toBeUndefined();
    expect(neighbour(layout, 'start', 'down')).toBeUndefined();
  });

  test('a loop-back is walked along its stage’s edges: the stage it returns to is to the left, and the nearest column goes first', () => {
    expect(neighbour(loops, 'check', 'left')).toBe('implement');
    expect(neighbour(loops, 'implement', 'right')).toBe('check');
    expect(neighbour(loops, 'design_review', 'left')).toBe('design');
    expect(neighbour(loops, 'design_review', 'right')).toBe('plan');
  });

  test('a stage that is not in the graph reaches nothing', () => {
    expect(neighbour(layout, 'nowhere', 'right')).toBeUndefined();
  });
});

describe('a run on the graph', () => {
  const definition: Playbook = {
    id: 'ship',
    version: 1,
    name: 'Ship',
    category: 'engineering',
    inputs: [],
    stages: [stage('build', { max_attempts: 3 }), stage('review', { gate: 'approval' }), stage('check'), stage('deploy'), stage('later'), stage('ask', { gate: 'clarify' })],
    edges: [edge('build', 'review'), edge('review', 'check', 'on_approve'), edge('check', 'deploy'), edge('deploy', 'later'), edge('later', 'ask')],
  };
  const entry = (over: Record<string, unknown>) => ({ stage: 'build', title: 'Build', attempt: 1, taskId: 't_1', status: 'done', assignee: null, createdAt: 1, completedAt: 2, ...over });

  test('each stage shows its latest attempt: its status, how it ended and how many tries it took', () => {
    const live = liveStages({
      definition,
      timeline: [
        entry({ verdict: 'failed', taskId: 't_1' }),
        entry({ attempt: 2, taskId: 't_2', status: 'done', verdict: 'passed' }),
        entry({ stage: 'review', taskId: 't_3', status: 'review' }),
        entry({ stage: 'check', taskId: 't_4', status: 'running', completedAt: null }),
        entry({ stage: 'deploy', taskId: 't_5', status: 'done', verdict: 'rejected' }),
        entry({ stage: 'later', taskId: 't_6', status: 'blocked', completedAt: null }),
      ],
    });
    expect(live.get('build')).toMatchObject({ state: 'done', label: 'Passed', taskId: 't_2', attempt: 2, attempts: 2, verdict: 'passed' });
    expect(live.get('review')).toMatchObject({ state: 'waiting', label: 'Waiting for you', taskId: 't_3', attempts: 1 });
    expect(live.get('check')).toMatchObject({ state: 'running', label: 'Running', taskId: 't_4' });
    expect(live.get('deploy')).toMatchObject({ state: 'rejected', label: 'Rejected' });
    expect(live.get('later')).toMatchObject({ state: 'blocked' });
    expect(live.get('ask')).toEqual({ state: 'pending', label: 'Not started', attempt: 0, attempts: 0 });
  });

  test('a stage that failed is failed, and a task that is waiting to be picked up is queued under the board’s own word', () => {
    const live = liveStages({ definition, timeline: [entry({ verdict: 'failed', status: 'done' }), entry({ stage: 'review', taskId: 't_2', status: 'ready' })] });
    expect(live.get('build')).toMatchObject({ state: 'failed', label: 'Failed' });
    expect(live.get('review')).toMatchObject({ state: 'queued', label: 'Ready' });
  });

  test('a clarify gate with its question open is waiting for the owner', () => {
    const live = liveStages({ definition, timeline: [entry({ stage: 'ask', taskId: 't_9', status: 'blocked', completedAt: null })] });
    expect(live.get('ask')).toMatchObject({ state: 'waiting', label: 'Waiting for you' });
  });

  test('attempts are counted in words, with the cap when the stage has one', () => {
    expect(attemptText(2, 5)).toBe('attempt 2 of 5');
    expect(attemptText(1, undefined)).toBe('attempt 1');
  });
});

describe('names', () => {
  test('a long title is cut with an ellipsis and a short one is not', () => {
    expect(truncateTitle('Short')).toBe('Short');
    expect(truncateTitle('Understand: a request with a long, long title').endsWith('…')).toBe(true);
    expect(truncateTitle('Understand: a request with a long, long title').length).toBeLessThanOrEqual(22);
  });

  test('a node is named by its place, its title, its gate, its attempts, its state on a run and where it leads', () => {
    const review = stage('review', { gate: 'approval', max_attempts: 3 });
    expect(nodeName({ index: 3, title: 'Approve the design', stage: review, leads: [{ when: 'on_approve', title: 'Plan' }, { when: 'on_reject', title: 'Design' }] })).toBe(
      'Stage 4: Approve the design. Approval gate. up to 3 attempts. Leads to Plan when it is approved, Design when it is rejected',
    );
    const live = { state: 'running' as const, label: 'Running', status: 'Running', attempt: 2, attempts: 2 };
    expect(nodeName({ index: 0, title: 'Build', stage: stage('build', { max_attempts: 5 }), live, leads: [] })).toBe('Stage 1: Build. up to 5 attempts. Running, attempt 2 of 5, 2 attempts so far');
    expect(nodeName({ index: 1, title: 'Later', stage: stage('later'), live: { state: 'pending', label: 'Not started', attempt: 0, attempts: 0 }, leads: [] })).toBe('Stage 2: Later. Not started');
  });
});
