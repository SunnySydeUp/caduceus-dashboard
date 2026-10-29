import { useId, useMemo, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Term } from '../../shell/Term.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { describeNode, graphList, layoutGraph } from './graph-view.ts';
import { useGraph } from './memory-data.ts';
import type { GraphNode } from './memory-model.ts';
import { NodeSheet } from './NodeSheet.tsx';
import './memory.css';

const SIZE = { width: 640, height: 420 };
/** Where nodes may sit: the labels go under them, so the box ends above the bottom of the drawing. */
const PLACE = { width: SIZE.width, height: SIZE.height - 24 };
/** Past this many nodes the names are left to the tooltips and the list: they would write over each other. */
const LABELLED_UP_TO = 30;
const LABEL_MARGIN = 70;
const VIEWS = [
  { value: 'graph', label: 'Graph' },
  { value: 'list', label: 'List' },
] as const;

/** What the profile has learned, as Hermes's learning graph: skills the agent made or used, and the chunks of its memory, linked by what they share. */
export function GraphPanel({ profile }: { profile: string }) {
  const view = useGraph(profile);
  const [mode, setMode] = useState<(typeof VIEWS)[number]['value']>('graph');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string>();
  const modeLabel = useId();
  const searchId = useId();
  const graph = view.value;
  const layout = useMemo(() => (graph ? layoutGraph(graph, PLACE) : undefined), [graph]);
  const groups = useMemo(() => (graph ? graphList(graph, query) : []), [graph, query]);
  const legend = useMemo(() => [...new Map(layout?.nodes.map((placed) => [placed.node.category, { category: placed.node.category, cluster: placed.cluster }]) ?? []).values()].sort((a, b) => a.cluster - b.cluster), [layout]);
  const opened = graph?.nodes.find((node) => node.id === open);
  const lit = new Set(layout?.edges.filter((edge) => edge.source === open || edge.target === open).flatMap((edge) => [edge.source, edge.target]));

  return (
    <div className="mm-panel">
      <p className="help-text">
        The <Term id="learning-graph">learning graph</Term> shows what <strong>{profile}</strong> has learned: skills its agent made or used, and the chunks of <Term id="memory-md">MEMORY.md</Term> and <Term id="user-md">USER.md</Term>. Lines join skills that name each other and memory that shares words with a skill. Open a node to read it, edit it or delete it.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so the learning graph could not be read{graph ? ': this is the graph from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!graph && !view.failed && <Loading label="Loading the learning graph…" lines={4} onRetry={() => void view.reload()} />}
      {graph && graph.nodes.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="git" />
          </span>
          <p>Nothing learned yet. Skills show here once the agent makes one or uses one, and memory chunks once MEMORY.md or USER.md has text.</p>
          <div className="mm-actions">
            <AppLink className="btn btn--secondary" to="/agents/skills/learn">
              Teach it a skill
            </AppLink>
            <AppLink className="btn btn--secondary" to="/agents/memory/built-in">
              Built-in memory
            </AppLink>
          </div>
        </div>
      )}
      {graph && layout && graph.nodes.length > 0 && (
        <div className="mm-graph" data-view={mode}>
          <p className="mm-stats" role="status">
            <span>{graph.stats.learnedSkills} learned {graph.stats.learnedSkills === 1 ? 'skill' : 'skills'}</span>
            <span>{graph.stats.memoryNodes} memory {graph.stats.memoryNodes === 1 ? 'chunk' : 'chunks'}</span>
            <span>{graph.stats.edges} {graph.stats.edges === 1 ? 'link' : 'links'}</span>
          </p>
          <div className="mm-bar">
            <span className="field__label mm-graph__toggle" id={modeLabel}>
              View
            </span>
            <RadioGroup labelledBy={modeLabel} value={mode} options={VIEWS} onChange={setMode} className="seg mm-graph__toggle" />
            <input id={searchId} className="input mm-search" type="search" aria-label="Search the learning graph" placeholder="Search by name or category" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="mm-graph__view">
            <svg className="mm-graph__canvas" viewBox={`0 0 ${SIZE.width} ${SIZE.height}`} role="img" aria-label={`Learning graph of ${profile}: ${graph.nodes.length} nodes and ${graph.edges.length} links. The list has the same nodes for the keyboard and screen readers.`}>
              {layout.edges.map((edge) => (
                <line key={`${edge.source}>${edge.target}`} className="mm-graph__edge" data-lit={edge.source === open || edge.target === open} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
              ))}
              {layout.nodes.map((placed) => {
                const dimmed = query !== '' && !groups.some((group) => group.rows.some((row) => row.node.id === placed.node.id));
                return (
                  <circle key={placed.node.id} className="mm-graph__node" data-c={placed.cluster % 6} data-selected={placed.node.id === open || lit.has(placed.node.id)} cx={placed.x} cy={placed.y} r={placed.radius} opacity={dimmed ? 0.25 : 1} onClick={() => setOpen(placed.node.id)}>
                    <title>{`${placed.node.label}: ${describeNode(placed.node)}`}</title>
                  </circle>
                );
              })}
              {layout.nodes.length <= LABELLED_UP_TO &&
                layout.nodes.map((placed) => (
                  <text key={`label-${placed.node.id}`} className="mm-graph__label" x={Math.min(Math.max(placed.x, LABEL_MARGIN), SIZE.width - LABEL_MARGIN)} y={placed.y + placed.radius + 14} textAnchor="middle">
                    {placed.node.label.length > 22 ? `${placed.node.label.slice(0, 21)}…` : placed.node.label}
                  </text>
                ))}
            </svg>
          </div>
          <ul className="mm-legend mm-graph__view" aria-label="Colours of the graph">
            {legend.map((entry) => (
              <li key={entry.category}>
                <span className="mm-graph__dot" data-c={entry.cluster % 6} aria-hidden="true" /> {entry.category}
              </li>
            ))}
          </ul>
          <div className="mm-list">
            {groups.length === 0 && <p className="mm-note">No node matches “{query}”.</p>}
            <div className="mm-groups">
              {groups.map((group) => (
                <section key={group.category} aria-label={group.category}>
                  <h3 className="mm-group-title">
                    {group.category} <span className="subtle">{group.rows.length}</span>
                  </h3>
                  <ul className="mm-group-list">
                    {group.rows.map(({ node, links }) => (
                      <li key={node.id}>
                        <button type="button" className="mm-row" onClick={() => setOpen(node.id)}>
                          <span className="mm-row__label">{node.label}</span>
                          <span className="mm-row__links">
                            {describeNode(node)}
                            {links.length > 0 ? ` · linked to ${links.map((linked) => linked.label).join(', ')}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
      {opened && graph && <NodeSheet key={`${profile}:${opened.id}`} node={opened} links={linksOf(graph.edges, graph.nodes, opened.id)} profile={profile} reload={view.reload} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

function linksOf(edges: readonly { source: string; target: string }[], nodes: readonly GraphNode[], id: string): GraphNode[] {
  const ids = new Set(edges.flatMap((edge) => (edge.source === id ? [edge.target] : edge.target === id ? [edge.source] : [])));
  return nodes.filter((node) => ids.has(node.id));
}
