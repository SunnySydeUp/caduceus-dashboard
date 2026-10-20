// The cards of what the agent does (M1 #05): reasoning, tool calls and subagents. Each is an accordion: a button that opens and closes its
// body (Enter or Space), closed by default in Worklog and open in Stream; a tool that failed opens by itself in either. The state is
// `activity.ts`'s; this only draws it, in the transcript (live and from history) and, for subagents, in the Run tab.
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../icons.tsx';
import { Sigil } from '../../shell/Sigil.tsx';
import { handoffOf } from './handoff-row.ts';
import { opensByDefault, shownActivity, type ActivityItem, type ActivityMode, type ReasoningActivity, type SubagentActivity, type ToolActivity } from './activity.ts';
import { summaryOf, type ActivitySummary } from './activity-summary.ts';

const TOOL_STATUS: Record<ToolActivity['status'], { label: string; icon: IconName }> = {
  generating: { label: 'Preparing', icon: 'running' },
  running: { label: 'Running', icon: 'running' },
  done: { label: 'Done', icon: 'succeeded' },
  failed: { label: 'Failed', icon: 'failed' },
  incomplete: { label: 'No result', icon: 'stale' },
};

const SUBAGENT_STATUS: Record<SubagentActivity['status'], { label: string; icon: IconName; tone: 'running' | 'done' | 'failed' | 'idle' }> = {
  queued: { label: 'Queued', icon: 'queued', tone: 'idle' },
  running: { label: 'Running', icon: 'running', tone: 'running' },
  completed: { label: 'Done', icon: 'succeeded', tone: 'done' },
  failed: { label: 'Failed', icon: 'failed', tone: 'failed' },
  error: { label: 'Failed', icon: 'failed', tone: 'failed' },
  timeout: { label: 'Timed out', icon: 'failed', tone: 'failed' },
  interrupted: { label: 'Stopped', icon: 'cancelled', tone: 'failed' },
  delegated: { label: 'Delegated', icon: 'agents', tone: 'idle' },
};

/** A duration in seconds, short: `0.3 s`, `12 s`, `2 min 5 s`. */
export function formatDuration(seconds: number): string {
  if (seconds < 10) return `${Math.round(seconds * 10) / 10} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

/**
 * What the transcript's tools (M1 #15) ask of every card on screen, and of the ones scrolled to later: open them all or close them all, and
 * open the card that holds the match search is on. A card reads it when it appears and when it changes; the owner's own click still works after.
 */
export interface CardControl {
  /** Expand all (true) or collapse all (false); `nonce` makes a second press of the same button a new command. */
  command?: { open: boolean; nonce: number };
  /** The card that holds the current match: it opens. */
  reveal?: { cardKey: string; nonce: number };
}
export const CardControlContext = createContext<CardControl>({});

/** The agent whose conversation the cards are in: the sigil at the start of a handoff row. A card drawn outside a conversation has none. */
export const AgentContext = createContext<string | undefined>(undefined);

/** An accordion card. `data-status` and `data-kind` are what the stylesheet colours. */
function Card({ itemKey, kind, status, open: opened, icon, lead, title, aside, chip, preview, children }: { itemKey: string; kind: string; status: string; open: boolean; icon: IconName; /** Replaces the icon (a handoff's two marks). */ lead?: ReactNode; title: ReactNode; aside?: ReactNode; chip?: string; /** Stays in view while the card is closed (a handoff's answer). */ preview?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(opened);
  const body = useId();
  const { command, reveal } = useContext(CardControlContext);
  useEffect(() => {
    if (command) setOpen(command.open);
  }, [command?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (reveal?.cardKey === itemKey) setOpen(true);
  }, [reveal?.nonce, reveal?.cardKey, itemKey]);
  return (
    <section className="act" data-kind={kind} data-status={status} data-card={itemKey}>
      <h4 className="act__heading">
        <button type="button" className="act__toggle" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}>
          {lead ?? <Icon name={icon} small />}
          <span className="act__title">{title}</span>
          {aside && <span className="act__aside">{aside}</span>}
          {chip && <span className="act__chip">{chip}</span>}
          <Icon name={open ? 'chev-u' : 'chev-d'} small />
        </button>
      </h4>
      {!open && preview}
      <div id={body} className="act__body" hidden={!open}>
        {open && children}
      </div>
    </section>
  );
}

/** A unified diff, a line at a time, so that added and removed lines are coloured (and the `+` and `-` stay in the text for everyone else). */
function Diff({ diff }: { diff: string }) {
  return (
    <div className="act__section">
      <h5>Changes</h5>
      <pre className="act__pre act__diff" tabIndex={0} aria-label="File changes">
        {diff
          .replace(/\n$/, '')
          .split('\n')
          .map((line, index) => (
            <span key={index} className="act__line" data-line={line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'remove' : line.startsWith('@@') ? 'hunk' : undefined}>
              {line}
              {'\n'}
            </span>
          ))}
      </pre>
    </div>
  );
}

function ToolCard({ tool, mode }: { tool: ToolActivity; mode: ActivityMode }) {
  const status = TOOL_STATUS[tool.status];
  return (
    <Card
      itemKey={tool.key}
      kind="tool"
      status={tool.status}
      open={opensByDefault(tool, mode)}
      icon={status.icon}
      title={
        <>
          <span className="mono">{tool.name}</span>
          {tool.context && <span className="act__context">{tool.context}</span>}
        </>
      }
      aside={tool.durationS === undefined ? undefined : formatDuration(tool.durationS)}
      chip={status.label}
    >
      {tool.error && (
        <p className="act__error">
          <Icon name="alert" small />
          <span>{tool.error}</span>
        </p>
      )}
      {tool.risk && (
        <p className="act__risk">
          <Icon name="alert" small />
          <span>
            Hermes flagged this output as {tool.risk.level} risk{tool.risk.redacted ? ' and hid part of it' : ''}
            {tool.risk.findings.length > 0 ? `: ${tool.risk.findings.join(', ')}` : ''}.
          </span>
        </p>
      )}
      {tool.args && Object.keys(tool.args).length > 0 && (
        <div className="act__section">
          <h5>Arguments</h5>
          <pre className="act__pre" tabIndex={0} aria-label="Arguments">
            {JSON.stringify(tool.args, null, 2)}
          </pre>
        </div>
      )}
      {tool.diff && <Diff diff={tool.diff} />}
      {tool.output !== undefined && (
        <div className="act__section">
          <h5>Output</h5>
          <pre className="act__pre" tabIndex={0} aria-label="Output">
            {tool.output}
          </pre>
        </div>
      )}
      {tool.summary && tool.output === undefined && <p className="subtle">{tool.summary}</p>}
      {tool.status === 'incomplete' && <p className="subtle">Hermes has no result for this call.</p>}
    </Card>
  );
}

function ReasoningCard({ item, mode }: { item: ReasoningActivity; mode: ActivityMode }) {
  return (
    <Card itemKey={item.key} kind="reasoning" status={item.streaming ? 'running' : 'done'} open={opensByDefault(item, mode)} icon="bolt" title={item.streaming ? 'Thinking…' : 'Reasoning'} aside={item.streaming ? item.caption : undefined}>
      <p className="act__text">{item.text}</p>
    </Card>
  );
}

/** The facts about a child: shared by its card and its row in the Run tab. */
function SubagentFacts({ child, openChild }: { child: SubagentActivity; openChild?: (sessionId: string) => ReactNode }) {
  const tokens = child.inputTokens === undefined && child.outputTokens === undefined ? undefined : `${child.inputTokens ?? 0} in · ${child.outputTokens ?? 0} out`;
  const facts = [
    child.model && ['Model', child.model],
    child.toolCount !== undefined && ['Tool calls', String(child.toolCount)],
    child.lastTool && ['Last tool', child.lastTool],
    child.durationS !== undefined && ['Took', formatDuration(child.durationS)],
    tokens && ['Tokens', tokens],
  ].filter((fact): fact is [string, string] => Array.isArray(fact));
  return (
    <>
      {child.summary && <p className="act__text">{child.summary}</p>}
      {!child.summary && child.note && <p className="act__text subtle">{child.note}</p>}
      {facts.length > 0 && (
        <dl className="act__facts">
          {facts.map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {child.childSessionId && openChild?.(child.childSessionId)}
    </>
  );
}

/**
 * A delegation as an event row in the thread (M8 #04): the agent's mark, an arrow and a helper's mark, what it was asked, and, once the helper is done, what it
 * answered. The facts and the link to the helper's own activity stay in the card's body.
 */
function SubagentCard({ child, mode, openChild }: { child: SubagentActivity; mode: ActivityMode; openChild?: (sessionId: string) => ReactNode }) {
  const status = SUBAGENT_STATUS[child.status];
  const handoff = handoffOf(child);
  const agent = useContext(AgentContext);
  return (
    <Card
      itemKey={child.key}
      kind="subagent"
      status={status.tone}
      open={opensByDefault(child, mode)}
      icon="agents"
      lead={
        <span className="act__pair" aria-hidden="true">
          {agent !== undefined && <Sigil name={agent} size="xs" />}
          <Icon name="arrow-r" small />
          <span className="act__helper">
            <Icon name="subagent" small />
          </span>
        </span>
      }
      title={
        <span className="act__goal">
          <strong>{handoff.asked}</strong> {child.goal}
        </span>
      }
      chip={status.label}
      preview={
        handoff.answer && (
          <p className="act__answer" data-state={handoff.state}>
            <strong>{handoff.answer.label}</strong>
            {handoff.answer.text !== '' && <span>{handoff.answer.text}</span>}
          </p>
        )
      }
    >
      <SubagentFacts child={child} openChild={openChild} />
    </Card>
  );
}

/** A run of cards. In Final only none are shown; a reasoning card with no words yet is not a card. */
export function ActivityGroup({ items, mode, openChild }: { items: readonly ActivityItem[]; mode: ActivityMode; openChild?: (sessionId: string) => ReactNode }) {
  const shown = shownActivity(items, mode).filter((item) => item.kind !== 'reasoning' || item.text !== '');
  if (shown.length === 0) return null;
  return (
    <div className="activity" role="group" aria-label="Agent activity">
      {/* The mode is in the key: changing it puts every card back to that mode's open or closed. */}
      {shown.map((item) => {
        const key = `${mode}:${item.key}`;
        if (item.kind === 'tool') return <ToolCard key={key} tool={item} mode={mode} />;
        if (item.kind === 'reasoning') return <ReasoningCard key={key} item={item} mode={mode} />;
        return <SubagentCard key={key} child={item} mode={mode} openChild={openChild} />;
      })}
    </div>
  );
}

const SUMMARY_ICON: Record<ActivitySummary['tone'], IconName> = { running: 'running', failed: 'failed', done: 'succeeded' };

/**
 * A run of cards in the thread (M8 #09). Worklog folds it into one line ("3 commands ran, 1 failed") that opens the cards; Stream shows the cards open, as it
 * always did; Final only shows none. The transcript's expand all and collapse all work the fold too, and a card that search is on opens the fold that holds it.
 */
export function ActivityFold({ items, mode, openChild }: { items: readonly ActivityItem[]; mode: ActivityMode; openChild?: (sessionId: string) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const body = useId();
  const { command, reveal } = useContext(CardControlContext);
  const shown = shownActivity(items, mode).filter((item) => item.kind !== 'reasoning' || item.text !== '');
  const holdsReveal = reveal !== undefined && shown.some((item) => item.key === reveal.cardKey);
  useEffect(() => {
    if (command) setOpen(command.open);
  }, [command?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (holdsReveal) setOpen(true);
  }, [holdsReveal, reveal?.nonce]);
  if (mode === 'stream') return <ActivityGroup items={items} mode={mode} openChild={openChild} />;
  const summary = summaryOf(shown);
  if (!summary) return null;
  return (
    <div className="activity-fold" data-tone={summary.tone}>
      <button type="button" className="activity-fold__toggle" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}>
        <Icon name={SUMMARY_ICON[summary.tone]} small />
        <span>{summary.text}</span>
        <Icon name={open ? 'chev-u' : 'chev-d'} small />
      </button>
      <div id={body} hidden={!open}>
        {open && <ActivityGroup items={items} mode={mode} openChild={openChild} />}
      </div>
    </div>
  );
}
