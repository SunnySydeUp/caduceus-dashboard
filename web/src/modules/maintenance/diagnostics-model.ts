// What System › Maintenance › Diagnostics shows, as pure functions (M5 #13): the diagnostic actions Hermes runs, the live output of one as the page folds it
// from Caduceus's events, and the install-facts block that Copy for bug report puts on the clipboard.
import type { InstallFacts } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';

export type DiagnosticId = 'doctor' | 'security-audit' | 'prompt-size' | 'dump' | 'config-migrate';

export interface DiagnosticAction {
  id: DiagnosticId;
  label: string;
  summary: string;
  /** Prompt size only reads; the others cost Hermes real work (or write a file), so the owner confirms. */
  tier: 'T0' | 'T1';
  confirm?: { title: string; text: string; confirmLabel: string };
}

export const DIAGNOSTIC_ACTIONS: readonly DiagnosticAction[] = [
  {
    id: 'doctor',
    label: 'Doctor',
    summary: 'Hermes checks its own install: Python, dependencies, keys, the config and the services it needs.',
    tier: 'T1',
    confirm: { title: 'Run Hermes doctor?', text: 'Hermes inspects its install and the services it uses. It can take a minute, and it may call out to your providers to test keys. It changes nothing.', confirmLabel: 'Run doctor' },
  },
  {
    id: 'security-audit',
    label: 'Security audit',
    summary: 'Hermes looks for weak spots: loose file permissions, keys in the open, risky settings.',
    tier: 'T1',
    confirm: { title: 'Run the security audit?', text: 'Hermes reads its config and files and reports what looks unsafe. It changes nothing.', confirmLabel: 'Run audit' },
  },
  { id: 'prompt-size', label: 'Prompt size', summary: 'How many tokens the standing parts of a prompt take: the system prompt, tools, memory and skills.', tier: 'T0' },
  {
    id: 'dump',
    label: 'Support dump',
    summary: 'A summary of this Hermes setup for a bug report: versions, platform, which providers and tools are on. Secrets are not in it.',
    tier: 'T1',
    confirm: { title: 'Make a support dump?', text: 'Hermes collects a summary of its setup and prints it here. Nothing is uploaded.', confirmLabel: 'Make dump' },
  },
  {
    id: 'config-migrate',
    label: 'Config migrate',
    summary: 'Brings the config file up to the shape this Hermes expects, adding options that are new since it was written.',
    tier: 'T1',
    confirm: { title: 'Migrate the Hermes config?', text: 'Hermes rewrites its config file with the options that are new in this version, keeping your values. Take a backup first if you want to be able to go back.', confirmLabel: 'Migrate config' },
  },
];

export interface ActionOutput {
  status: 'running' | 'ok' | 'failed' | 'lost';
  lines: string[];
  exitCode: number | null;
}

export const startAction = (): ActionOutput => ({ status: 'running', lines: [], exitCode: null });

/**
 * Folds one server-sent event of an action's output into the state: `line` adds a line, `end` says how Hermes's command exited, and `dropped` (the page's own
 * word for a stream that closed) before an end says the page lost the output. Anything else leaves the state as it was.
 */
export function foldAction(state: ActionOutput, { event, data }: { event: string; data: unknown }): ActionOutput {
  if (state.status !== 'running') return state;
  if (event === 'line' && isRecord(data) && typeof data.text === 'string') return { ...state, lines: [...state.lines, data.text] };
  if (event === 'end' && isRecord(data) && typeof data.ok === 'boolean') return { ...state, status: data.ok ? 'ok' : 'failed', exitCode: typeof data.exitCode === 'number' ? data.exitCode : null };
  if (event === 'dropped') return { ...state, status: 'lost' };
  return state;
}

/** What must not leave in a bug report: the owner's home folder (and so their name), an address, a key. */
export function redact(text: string): string {
  return text
    .replace(/(?:\/Users|\/home)\/[^/\s]+/g, '~')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, '~')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[redacted]')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '[redacted]')
    .replace(/\b(?:ghp|gho|ghs|github_pat|xox[abp]|AIza)[A-Za-z0-9_-]{16,}/g, '[redacted]')
    .replace(/\b[A-Za-z0-9+/_-]{40,}\b/g, '[redacted]');
}

/** The block Copy for bug report puts on the clipboard: the install facts one to a line, redacted. */
export function bugReportText({ caduceus, hermes, contracts, host }: InstallFacts): string {
  const lines = [
    `Caduceus Dashboard: ${caduceus.version}`,
    `Node: ${caduceus.node}`,
    `Platform: ${caduceus.platform} ${caduceus.arch}`,
    `Hermes: ${hermes.version ?? 'unknown version'} (${hermes.state})`,
    `Contracts: pinned ${contracts.pinned}, Hermes ${contracts.hermes ?? 'unknown'}, ${contracts.state}`,
    ...contracts.differences.map((difference) => `  - ${difference}`),
    host.role === null ? 'Hermes host: unknown' : `Hermes host: ${host.role}${host.protocolVersion === null ? '' : `, protocol ${host.protocolVersion}`}`,
  ];
  return redact(lines.join('\n'));
}
