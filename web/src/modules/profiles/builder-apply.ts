// Finish of the profile builder (M4 #12): carries out the plan in Hermes, one step at a time, through the same calls the other Agents
// screens make (`POST /api/profiles`, the SOUL write, the model set, the skill toggle, the hub install, the MCP add and catalogue
// install), each with the tier the policy map gives it. A step that fails or is declined does not stop the independent ones after it, and
// nothing is hidden: the result of every step is kept so the screen can list what succeeded and retry exactly the rest. The profile is the
// first step: when it is not made, nothing after it is tried. Caduceus keeps nothing of what it sends.
import { startedAction, installGate, installRequest, installResult, parseHubScan, readActionLog, hubScanPath, actionLogPath, type HubScan } from '../skills/hub-model.ts';
import { toggleRequest, listPath, parseSkills } from '../skills/skills-model.ts';
import { mainModelRequest, readSetAnswer } from '../models/model-settings.ts';
import { catalogInstall, commandLine, serverCreate, type CatalogEntry } from '../tools/mcp-model.ts';
import { saveAssistantName, type Request } from '../../profile-preferences.ts';
import type { TieredRequest, TieredResult } from '../../tiered-fetch.ts';
import { fileRef, saveRequest } from './behaviour-files.ts';
import { copyForm, remaining, type Baseline, type PlanStep, type StepResult } from './builder-model.ts';

export interface RunnerDeps {
  /** `fetchTiered`: asks the owner for what a request's tier needs and sends it. */
  send(request: TieredRequest): Promise<TieredResult>;
  /** A plain read of Hermes (a GET through the policy proxy): the status and the JSON body, `undefined` for none. */
  read(path: string): Promise<{ status: number; body: unknown }>;
  /** The call to Caduceus's own API (the assistant name). */
  request: Request;
  /** Waits between looks at a background action's log (an event is not available: Hermes sends none when one ends). */
  pause(): Promise<void>;
}

export interface RunContext {
  plan: readonly PlanStep[];
  baseline: Baseline | undefined;
  /** Hermes's MCP catalogue, for the steps that install an entry. */
  catalogue: readonly CatalogEntry[];
  /** What earlier runs of this plan did: steps that are done are not run again. */
  results: Readonly<Record<string, StepResult>>;
  /** Told as each step starts and when it ends, so the screen shows progress. */
  onStep?(step: PlanStep, result: StepResult | undefined): void;
}

const MAX_LOOKS = 1500;

const failed = (message: string): StepResult => ({ state: 'failed', message });

/** What Hermes's REST error says: FastAPI's `detail`, the policy's `message`, or the status. */
function reasonOf(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const { detail, message } = body as { detail?: unknown; message?: unknown };
    if (typeof detail === 'string') return detail;
    if (typeof message === 'string') return message;
  }
  return `Hermes answered HTTP ${status}.`;
}

/** The outcome of a tiered request: what Hermes answered, or why nothing was done. */
type Outcome = { kind: 'ok'; body: unknown } | StepResult;

async function outcomeOf(sending: Promise<TieredResult>): Promise<Outcome> {
  const result = await sending;
  if (result.kind === 'cancelled') return { state: 'cancelled' };
  if (result.kind === 'refused') return failed(result.refusal.message);
  const text = await result.response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return result.response.ok ? { kind: 'ok', body } : failed(reasonOf(body, result.response.status));
}

const toResult = (outcome: Outcome): StepResult => ('kind' in outcome ? { state: 'done' } : outcome);

const verdictWords = (scan: HubScan) => `${scan.verdict} (${scan.counts.critical} critical, ${scan.counts.high} high, ${scan.counts.medium} medium, ${scan.counts.low} low)`;

export interface BuilderRunner {
  /**
   * Runs the steps of the plan that are not done. Returns every step's result so far (earlier ones included). The profile's own step
   * failing or being declined ends the run, because every other step is about a profile that is not there.
   */
  run(context: RunContext): Promise<Record<string, StepResult>>;
}

export function createBuilderRunner(deps: RunnerDeps): BuilderRunner {
  /** Hermes's hub install runs in the background: its log is followed until it ends, and the skill must be in the profile's list. */
  async function installHub(profile: string, skill: { name: string; identifier: string }): Promise<StepResult> {
    const scanned = await deps.read(hubScanPath(profile, skill.identifier)).catch(() => undefined);
    const scan = scanned?.status === 200 ? parseHubScan(scanned.body) : undefined;
    if (!scan) return failed(`Hermes could not scan ${skill.name}, so it is not installed. Try it from Skills › Hub.`);
    const gate = installGate(scan, { installed: false });
    // A skill whose scan is not clean needs the explicit override the Hub screen asks for: the builder never installs one on its own.
    if (gate.kind === 'blocked') return failed(`Hermes’s install policy blocks ${skill.name}: ${gate.reason}`);
    if (gate.kind !== 'ready') return failed(`The security scan of ${skill.name} is ${verdictWords(scan)}. Install it from Skills › Hub, where you can read the findings and confirm.`);
    const answer = await outcomeOf(
      deps.send({
        ...installRequest(profile, skill.identifier),
        confirm: {
          title: `Install ${skill.name} into ${profile}?`,
          text: 'Hermes downloads the skill, scans it again, and copies it into this profile’s skills. The scan found nothing.',
          object: skill.name,
          profile,
          confirmLabel: 'Install skill',
          recoverability: { undoable: true, note: 'Uninstall removes it from this profile again.' },
        },
      }),
    );
    if (!('kind' in answer)) return answer;
    const action = startedAction(answer.body);
    if (!action) return failed(`Hermes did not say which action it started, so Caduceus cannot follow the install of ${skill.name}.`);
    for (let look = 0; look < MAX_LOOKS; look++) {
      const seen = await deps.read(actionLogPath(action)).catch(() => undefined);
      if (seen?.status === 200) {
        const log = readActionLog(seen.body);
        if (!log.running) {
          const list = await deps.read(listPath(profile)).catch(() => undefined);
          const installed = list?.status === 200 && parseSkills(list.body).some((row) => row.name === skill.name);
          const verdict = installResult(log, installed);
          return verdict.ok ? { state: 'done' } : failed(verdict.message);
        }
      }
      await deps.pause();
    }
    return failed(`Hermes is still installing ${skill.name}. Look at Skills › Installed in a while.`);
  }

  async function run(step: PlanStep, { baseline, catalogue }: RunContext, profile: string): Promise<StepResult> {
    switch (step.kind) {
      case 'create':
        return toResult(
          await outcomeOf(
            deps.send({
              method: 'POST',
              path: '/api/profiles',
              body: { name: step.request.name, ...(step.request.cloneFrom ? { clone_from: step.request.cloneFrom } : { clone_from_default: false }) },
              confirm: { title: step.label, text: 'Hermes makes the profile. The steps after it are what you chose in the builder.', object: step.request.name, confirmLabel: 'Create profile' },
              // The Review step lists everything Finish does: pressing Finish is the owner's confirmation of the profile itself.
              alreadyConfirmed: true,
            }),
          ),
        );
      case 'description':
        return toResult(await outcomeOf(deps.send({ method: 'PUT', path: `/api/profiles/${encodeURIComponent(profile)}/description`, body: { description: step.text } })));
      case 'display-name':
        try {
          await saveAssistantName(profile, step.text, deps.request);
          return { state: 'done' };
        } catch (error) {
          return failed(error instanceof Error ? error.message : 'Caduceus did not save the assistant name.');
        }
      case 'soul': {
        const request = saveRequest(fileRef('soul', profile, ''), step.text);
        return toResult(
          await outcomeOf(
            deps.send({
              ...request,
              confirm: {
                title: `Write the SOUL of ${profile}?`,
                text: 'Hermes replaces the profile’s SOUL.md with the text you wrote in the builder. Caduceus keeps the text it replaces as a snapshot, so you can restore it from History.',
                object: profile,
                profile,
                confirmLabel: 'Write SOUL.md',
                recoverability: { undoable: true, note: 'The previous text stays in History.' },
              },
            }),
          ),
        );
      }
      case 'model': {
        const outcome = await outcomeOf(deps.send({ ...mainModelRequest(profile, step.choice), confirm: { title: step.label, object: profile, profile, confirmLabel: 'Use this model' }, alreadyConfirmed: true }));
        if (!('kind' in outcome)) return outcome;
        const answer = readSetAnswer(outcome.body);
        return answer.kind === 'saved' ? { state: 'done' } : failed(`${answer.message} Set the model from Models once the profile exists.`);
      }
      case 'skill-off':
        return toResult(await outcomeOf(deps.send(toggleRequest(profile, step.skill, false))));
      case 'hub':
        return installHub(profile, step.skill);
      case 'mcp-copy': {
        const form = baseline ? copyForm(baseline, step.server) : undefined;
        if (!form) return failed(`The server ${step.server} is no longer in ${baseline?.source ?? 'the source profile'}.`);
        const stdio = form.transport === 'stdio';
        return toResult(
          await outcomeOf(
            deps.send({
              ...serverCreate(form, profile),
              confirm: {
                title: `Add the ${stdio ? 'stdio' : form.transport.toUpperCase()} server ${form.name} to ${profile}?`,
                text: stdio ? `Hermes will start this program on this computer whenever a session uses the server, with the access of your account: ${commandLine(form.command.trim(), form.args.split('\n').filter((line) => line.trim() !== ''))}` : `Hermes saves ${form.name} (${form.url.trim()}) to the profile’s config.`,
                object: form.name,
                profile,
                confirmLabel: 'Add server',
              },
            }),
          ),
        );
      }
      case 'mcp-catalogue': {
        const entry = catalogue.find((candidate) => candidate.name === step.entry);
        if (!entry) return failed(`Hermes’s catalogue has no entry ${step.entry} now.`);
        return toResult(
          await outcomeOf(
            deps.send({
              ...catalogInstall(entry, {}, profile),
              confirm: {
                title: `Install ${entry.name} for ${profile}?`,
                text: entry.command ? `Hermes adds ${entry.name} to the profile’s config. It will start ${commandLine(entry.command, entry.args)} on this computer.` : `Hermes adds ${entry.name} (${entry.url ?? 'a remote server'}) to the profile’s config.`,
                object: entry.name,
                profile,
                confirmLabel: 'Install',
              },
            }),
          ),
        );
      }
    }
  }

  return {
    async run(context): Promise<Record<string, StepResult>> {
      const results: Record<string, StepResult> = { ...context.results };
      const create = context.plan.find((step) => step.kind === 'create');
      const profile = create?.kind === 'create' ? create.request.name : '';
      for (const step of remaining(context.plan, results)) {
        context.onStep?.(step, undefined);
        let result: StepResult;
        try {
          result = await run(step, context, profile);
        } catch (error) {
          result = failed(error instanceof Error ? error.message : String(error));
        }
        results[step.id] = result;
        context.onStep?.(step, result);
        if (step.kind === 'create' && result.state !== 'done') break;
      }
      return results;
    },
  };
}
