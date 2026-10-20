// The playbook as a graph (M6 #04): stages as nodes in columns and lanes, edges as arrows with their condition, loop-backs as arcs with the attempts the stage
// they return to allows, and, on a run, each node's live status. Plain SVG; where everything goes is `playbook-graph.ts`. It is only ever rendered from 1024 px
// up and is loaded on demand (`PlaybookGraphView.tsx`), so none of it counts toward the first screen. The stage list stays the alternative: the page that shows
// this offers “View as list” beside it.
//
// Keyboard: one node is in the tab order (the one you were on last); the arrow keys move to the stage an edge connects to on that side, or to the next
// parallel stage above or below; Enter (and Space on a button) opens the stage. Nothing here is a pointer-only target.
import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { fillPlaceholders, type Playbook } from '@caduceus/contracts/playbooks';
import type { RunDetail } from '@caduceus/contracts/playbook-runs';
import { GATE_BADGE, layoutGraph, liveStages, neighbour, nodeName, truncateTitle, type Direction } from './playbook-graph.ts';
import { outgoingEdges } from './playbook-model.ts';
import './playbook-graph.css';

export interface PlaybookGraphProps {
  playbook: Pick<Playbook, 'name' | 'stages' | 'edges'>;
  /** A run of the playbook: each node then shows its latest attempt, and the stage's titles have the run's answers in. */
  run?: Pick<RunDetail, 'definition' | 'timeline' | 'inputs'>;
  /** The stage the page is showing the inspector of. */
  selected?: string;
  /** What Enter does: a stage opens in the inspector (a button), or its task opens (a link). */
  opens: 'stage' | 'task';
  /** A node was opened; `taskId` is the task of the stage's latest attempt, when it has one. */
  onOpen(stage: string, taskId?: string): void;
}

const KEYS: Record<string, Direction> = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down' };

const HINT_OPENS = { stage: 'Enter opens the stage in the inspector.', task: 'Enter opens the stage’s task.' } as const;

export default function PlaybookGraph({ playbook, run, selected, opens, onOpen }: PlaybookGraphProps) {
  const hintId = useId();
  const layout = useMemo(() => layoutGraph(playbook), [playbook]);
  const live = useMemo(() => (run ? liveStages(run) : undefined), [run]);
  const nodes = useRef(new Map<string, SVGGElement>());
  const [active, setActive] = useState(selected ?? playbook.stages[0]?.key);
  const here = layout.nodes.some((node) => node.key === active) ? active : playbook.stages[0]?.key;
  const titleOf = (title: string) => (run ? fillPlaceholders(title, run.inputs) : title);

  const open = (key: string) => {
    const taskId = live?.get(key)?.taskId;
    if (opens === 'task' && taskId === undefined) return;
    onOpen(key, taskId);
  };

  const onKeyDown = (event: KeyboardEvent, key: string) => {
    const direction = KEYS[event.key];
    if (direction !== undefined) {
      event.preventDefault();
      const next = neighbour(layout, key, direction);
      if (next !== undefined) nodes.current.get(next)?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      nodes.current.get((event.key === 'Home' ? playbook.stages[0] : playbook.stages[playbook.stages.length - 1])?.key ?? key)?.focus();
    } else if (event.key === 'Enter' || (event.key === ' ' && opens === 'stage')) {
      event.preventDefault();
      open(key);
    }
  };

  return (
    <div className="pg">
      <div className="pg__scroll">
        <svg className="pg__svg" viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ '--pg-w': layout.width, '--pg-h': layout.height } as CSSProperties} role="group" aria-label={`Graph of ${playbook.name}`} aria-describedby={hintId}>
          <g aria-hidden="true">
            {layout.edges.map((edge) => (
              <g key={edge.index} className="pg__edge" data-when={edge.when} data-loop={edge.loop ? '' : undefined}>
                <path className="pg__line" d={edge.path} />
                <path className="pg__arrow" d={edge.arrow} />
                <g transform={`translate(${edge.label.x} ${edge.label.y})`}>
                  <rect className="pg__label-box" x={-edge.label.text.length * 3.3 - 6} y={-9} width={edge.label.text.length * 6.6 + 12} height={18} rx={9} />
                  <text className="pg__label" textAnchor="middle" dominantBaseline="central">
                    {edge.label.text}
                  </text>
                </g>
              </g>
            ))}
          </g>
          {layout.nodes.map((node) => {
            const stage = playbook.stages[node.index];
            const state = live?.get(node.key);
            const title = titleOf(stage.title);
            const leads = outgoingEdges(playbook, node.key).map((edge) => ({ when: edge.when, title: titleOf(edge.title) }));
            const openable = opens === 'stage' || state?.taskId !== undefined;
            return (
              <g key={node.key} className="pg__node" transform={`translate(${node.x} ${node.y})`} data-state={state?.state} data-selected={selected === node.key ? '' : undefined} data-disabled={openable ? undefined : ''}>
                <g aria-hidden="true">
                  <rect className="pg__card" width={node.width} height={node.height} rx={8} />
                  <rect className="pg__strip" x={0} y={0} width={5} height={node.height} />
                  <g className="pg__num" transform="translate(24 23)">
                    <circle r={11} />
                    <text textAnchor="middle" dominantBaseline="central">
                      {node.index + 1}
                    </text>
                  </g>
                  <text className="pg__title" x={42} y={23} dominantBaseline="central">
                    {truncateTitle(title)}
                  </text>
                  {stage.gate && (
                    <g className="pg__gate" data-gate={stage.gate} transform="translate(16 34)">
                      <rect width={66} height={18} rx={9} />
                      <text x={33} y={9} textAnchor="middle" dominantBaseline="central">
                        {GATE_BADGE[stage.gate]}
                      </text>
                    </g>
                  )}
                  {stage.max_attempts !== undefined && (
                    <text className="pg__meta" x={stage.gate ? 92 : 16} y={43} dominantBaseline="central">
                      max {stage.max_attempts}
                    </text>
                  )}
                  {stage.gate === undefined && stage.max_attempts === undefined && stage.assignee && (
                    <text className="pg__meta" x={16} y={43} dominantBaseline="central">
                      {truncateTitle(stage.assignee, 26)}
                    </text>
                  )}
                  {state && (
                    <>
                      <text className="pg__status" x={16} y={60} dominantBaseline="central">
                        {state.label}
                      </text>
                      {state.attempt > 0 && (
                        <text className="pg__attempt" x={node.width - 12} y={60} textAnchor="end" dominantBaseline="central">
                          {stage.max_attempts === undefined ? `attempt ${state.attempt}` : `attempt ${state.attempt}/${stage.max_attempts}`}
                        </text>
                      )}
                    </>
                  )}
                </g>
                {/* What the keyboard and the screen reader reach: the node's whole box, named in full. The drawing above is hidden from them, so the name is the only text. */}
                <g
                  ref={(element) => {
                    if (element) nodes.current.set(node.key, element);
                    else nodes.current.delete(node.key);
                  }}
                  className="pg__hit"
                  role={opens === 'task' ? 'link' : 'button'}
                  tabIndex={here === node.key ? 0 : -1}
                  aria-label={nodeName({ index: node.index, title, stage, live: state, leads })}
                  aria-disabled={openable ? undefined : true}
                  aria-current={selected === node.key ? 'true' : undefined}
                  onFocus={() => setActive(node.key)}
                  onClick={() => open(node.key)}
                  onKeyDown={(event) => onKeyDown(event, node.key)}
                >
                  <title>{title}</title>
                  <rect className="pg__area" width={node.width} height={node.height} rx={8} />
                </g>
                <rect className="pg__ring" x={-4} y={-4} width={node.width + 8} height={node.height + 8} rx={12} />
              </g>
            );
          })}
        </svg>
      </div>
      <p id={hintId} className="pg__hint subtle">
        Arrow keys move between stages: left and right follow the edges, up and down move between parallel stages. {HINT_OPENS[opens]} The stage list has the same stages.
      </p>
    </div>
  );
}
