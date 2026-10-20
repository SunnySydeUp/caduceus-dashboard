// A hub skill's detail sheet: what it is, Hermes's security scan (always above Install), and its SKILL.md, read without installing.
// Install is off until the scan has answered, and a verdict Hermes does not allow keeps it off for good.
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { toast } from '../../shell/toasts.ts';
import { Term } from '../../shell/Term.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { SkillDocument } from './SkillDetail.tsx';
import type { LogRun } from './ActionLogSheet.tsx';
import { installHubSkill } from './hub-actions.ts';
import { fetchHubPreview, fetchHubScan } from './hub-data.ts';
import { forceCommand, installGate, installResult, type HubScan, type HubSkill, type InstallGate, type Severity, type Trust } from './hub-model.ts';
import { fetchSkills } from './skills-data.ts';
import { useLoaded } from './use-loaded.ts';
import './skills.css';

export const TRUST_WORDS: Record<Trust, string> = { builtin: 'Official, ships with Hermes', trusted: 'Trusted repository', community: 'Community' };

const VERDICT_WORDS = { safe: 'Safe', caution: 'Caution', dangerous: 'Dangerous' } as const;
const VERDICT_TONE = { safe: 'success', caution: 'warning', dangerous: 'danger' } as const;
const SEVERITY_TONE: Record<Severity, string> = { critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral' };

/** What the scan says, as it is shown above Install: the verdict, how many findings of each severity, and each finding. */
function ScanReport({ scan, sourceLabel }: { scan: HubScan; sourceLabel: string }) {
  const counted = (['critical', 'high', 'medium', 'low'] as const).filter((severity) => scan.counts[severity] > 0);
  return (
    <div className="sk-scan" data-verdict={scan.verdict}>
      <p className="sk-scan__verdict">
        <span className="tag" data-tone={VERDICT_TONE[scan.verdict]}>
          <Icon name={scan.verdict === 'safe' ? 'succeeded' : 'alert'} small />
          {VERDICT_WORDS[scan.verdict]}
        </span>
        <span>{scan.summary || `${VERDICT_WORDS[scan.verdict]} verdict.`}</span>
      </p>
      <p className="subtle sk-note">
        Source: {sourceLabel} · {TRUST_WORDS[scan.trust]}. Hermes’s install policy for this: {scan.policyReason || scan.policy}
      </p>
      {counted.length > 0 && (
        <ul className="sk-tags" aria-label="Findings by severity">
          {counted.map((severity) => (
            <li key={severity} className="tag" data-tone={SEVERITY_TONE[severity]}>
              {scan.counts[severity]} {severity}
            </li>
          ))}
        </ul>
      )}
      {scan.findings.length > 0 && (
        <ul className="sk-findings" aria-label="Findings">
          {scan.findings.map((finding, index) => (
            <li key={index}>
              <span className="tag" data-tone={SEVERITY_TONE[finding.severity]}>
                {finding.severity}
              </span>
              <span className="sk-findings__what">
                <strong>{finding.description}</strong>
                <span className="mono subtle">
                  {finding.category} · {finding.file}
                  {finding.line > 0 ? `:${finding.line}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Why Install is not available, or what it will ask, from the gate the scan gave. */
function GateNote({ gate, profile, identifier }: { gate: InstallGate; profile: string; identifier: string }) {
  if (gate.kind === 'installed') return <p className="muted">This skill is installed in {profile}. Uninstall it from the Installed list.</p>;
  if (gate.kind === 'override') {
    return (
      <p className="banner sk-gate" data-tone="warning" role="note">
        <Icon name="alert" />
        <span className="banner__content">The scan is not clean, but Hermes allows this source. Installing needs your explicit override: the confirmation asks you to type it.</span>
      </p>
    );
  }
  if (gate.kind === 'blocked') {
    return (
      <div className="banner sk-gate" data-tone="danger" role="note">
        <Icon name="alert" />
        <div className="banner__content">
          <p>Hermes’s policy does not allow this install: {gate.reason}</p>
          {gate.canForce ? (
            <>
              <p>Hermes’s install endpoint cannot be told to force it, so Caduceus cannot either. If you have read the findings and still want it, run this in a terminal:</p>
              <pre className="sk-pre" tabIndex={0}>
                {forceCommand(profile, identifier)}
              </pre>
            </>
          ) : (
            <p>Hermes does not let anyone override this verdict for a community or trusted source, from a terminal either.</p>
          )}
        </div>
        <span />
      </div>
    );
  }
  return null;
}

export interface HubDetailProps {
  profile: string;
  identifier: string;
  /** What the lists already know of it, shown while the preview loads. */
  known: HubSkill | undefined;
  sourceLabel(id: string): string;
  /** Names of the hub skills the profile has installed. */
  installedNames: ReadonlySet<string>;
  /** Hermes started the install: the screen follows its log. */
  onStarted(run: LogRun): void;
  onClose(): void;
  onInstalled(name: string): void;
}

export function HubDetail({ profile, identifier, known, sourceLabel, installedNames, onStarted, onClose, onInstalled }: HubDetailProps) {
  const preview = useLoaded(() => fetchHubPreview(profile, identifier), `preview/${profile}/${identifier}`);
  const scan = useLoaded(() => fetchHubScan(profile, identifier), `scan/${profile}/${identifier}`);
  const shown = preview.loaded.state === 'ready' ? preview.loaded.value : undefined;
  const name = shown?.name ?? known?.name ?? identifier;
  const scanned = scan.loaded.state === 'ready' ? scan.loaded.value : undefined;
  const gate = scanned ? installGate(scanned, { installed: installedNames.has(name) }) : undefined;

  const install = async () => {
    if (!scanned || !gate || (gate.kind !== 'ready' && gate.kind !== 'override')) return;
    const outcome = await installHubSkill(profile, { name, identifier }, scanned, gate);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    onStarted({
      action: outcome.body.action,
      title: `Installing ${name}`,
      doneTitle: `Installed ${name}`,
      async judge(log) {
        // Hermes can print "Not installed" and exit 0: the profile's list says whether it is there.
        const installed = (await fetchSkills(profile).catch(() => [])).some((skill) => skill.name === name && skill.provenance === 'hub');
        const result = installResult(log, installed);
        if (result.ok) onInstalled(name);
        return result.ok ? { ok: true, message: `${name} is installed in ${profile}. The agent can use it from the next session.` } : result;
      },
    });
  };

  let installLabel = 'Install…';
  let why: string | undefined;
  if (scan.loaded.state === 'loading') why = 'Install is off until the security scan has finished.';
  else if (scan.loaded.state === 'failed' || (scan.loaded.state === 'ready' && !scanned)) why = 'Hermes could not scan this skill, so it cannot be installed from here.';
  else if (gate?.kind === 'installed') installLabel = 'Installed';
  else if (gate?.kind === 'blocked') why = 'Hermes’s policy does not allow this install.';
  else if (gate?.kind === 'override') installLabel = 'Install anyway…';
  const ready = gate?.kind === 'ready' || gate?.kind === 'override';

  return (
    <Sheet
      title={name}
      detents={['full', 'half']}
      className="sk-sheet"
      initialFocus="[data-close]"
      onClose={onClose}
      footer={
        <>
          {why && (
            <p className="subtle sk-note sk-why" id="sk-install-why">
              {why}
            </p>
          )}
          <WriteButton type="button" className={`btn ${gate?.kind === 'override' ? 'btn--danger' : 'btn--primary'}`} disabled={!ready} aria-describedby={why ? 'sk-install-why' : undefined} onClick={() => void install()}>
            <Icon name="download" />
            {installLabel}
          </WriteButton>
        </>
      }
    >
      <div className="sk-facts">
        <p>{shown?.description || known?.description || <span className="subtle">No description.</span>}</p>
        <ul className="sk-tags" aria-label="About this skill">
          <li className="tag">{sourceLabel(shown?.source ?? known?.source ?? '')}</li>
          <li className="tag" data-tone={(shown?.trust ?? known?.trust) === 'community' ? 'neutral' : 'accent'}>
            {TRUST_WORDS[shown?.trust ?? known?.trust ?? 'community']}
          </li>
          {(shown?.tags ?? known?.tags ?? []).map((tag) => (
            <li key={tag} className="tag">
              {tag}
            </li>
          ))}
        </ul>
        {shown?.repo && <p className="subtle sk-note mono">{shown.repo}</p>}
        <p className="subtle sk-note mono">{identifier}</p>
      </div>

      <section className="sk-section" aria-labelledby="sk-scan-title">
        <h3 id="sk-scan-title">Security scan</h3>
        {scan.loaded.state === 'loading' && <p role="status">Hermes is fetching the skill and scanning it…</p>}
        {(scan.loaded.state === 'failed' || (scan.loaded.state === 'ready' && !scanned)) && (
          <p role="alert" className="sk-error">
            Hermes could not scan this skill.{' '}
            <button type="button" className="btn btn--secondary btn--sm" onClick={scan.retry}>
              Retry
            </button>
          </p>
        )}
        {scanned && <ScanReport scan={scanned} sourceLabel={sourceLabel(shown?.source ?? known?.source ?? '')} />}
        {gate && <GateNote gate={gate} profile={profile} identifier={identifier} />}
        <p className="subtle sk-note">
          What is a <Term id="security-scan">security scan</Term>?
        </p>
      </section>

      {preview.loaded.state === 'loading' && <p role="status">Loading SKILL.md…</p>}
      {preview.loaded.state === 'failed' && (
        <p role="alert" className="sk-error">
          Hermes did not answer, so SKILL.md could not be read.{' '}
          <button type="button" className="btn btn--secondary btn--sm" onClick={preview.retry}>
            Retry
          </button>
        </p>
      )}
      {preview.loaded.state === 'ready' && !shown && <p className="muted">Hermes has no skill with this identifier in its hub.</p>}
      {shown && (
        <>
          <SkillDocument text={shown.skillMd} name={`hub-${shown.name}`} />
          {shown.files.length > 1 && (
            <section className="sk-files" aria-labelledby="sk-hub-files-title">
              <h3 id="sk-hub-files-title">Files it installs</h3>
              <ul className="sk-filelist sk-plainfiles">
                {shown.files.map((file) => (
                  <li key={file} className="mono sk-note">
                    {file}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Sheet>
  );
}
