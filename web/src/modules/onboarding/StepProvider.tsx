// Step 2: set up a provider with the flows of System › Keys (M5 #10): an API key (validated by Hermes before it is saved, Tier 2 to save), or an account
// sign-in (a device code). Nothing is duplicated here: the sheets, the actions and their confirmations are Keys's own. What this step adds is the answer
// to "does it work now?" (Hermes's strict check of the one provider just connected) and Hermes's recommended default model.
import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { gatewayConnection } from '../../gateway.ts';
import { AppLink } from '../../shell/navigation.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { saveKey } from '../keys/key-actions.ts';
import { read } from '../keys/keys-data.ts';
import { KeySheet } from '../keys/KeySheet.tsx';
import { OauthSection } from '../keys/OauthSection.tsx';
import { parseKeys, parseOauth, type KeyRow } from '../keys/keys-model.ts';
import { setMainModel } from '../models/model-actions.ts';
import { useMainModel, useProfileLoad } from '../models/model-data.ts';
import type { ModelChoice } from '../models/model-catalogue.ts';
import type { SetupView } from './setup-data.ts';
import { readSetup } from './setup-hermes.ts';

/** What Hermes's strict check said of the provider the owner just connected. */
interface Verdict {
  provider: string;
  ok: boolean;
  text: string;
}

export function StepProvider({ profile, setup }: { profile: string; setup: SetupView }) {
  const keys = useProfileLoad(profile, async (name) => parseKeys(await read(`/api/env?profile=${encodeURIComponent(name)}`)));
  const oauth = useProfileLoad(profile, async (name) => parseOauth(await read(`/api/providers/oauth?profile=${encodeURIComponent(name)}`)));
  const model = useMainModel(profile);
  const [adding, setAdding] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>();
  const provider = setup.checks?.find((check) => check.id === 'provider');

  /** Asks Hermes about one provider alone, so another provider's fallback cannot make a failed connection look fine. */
  const verify = async (name: string) => {
    const { runtime } = await readSetup(gatewayConnection().client, profile, name);
    setVerdict(runtime === undefined ? { provider: name, ok: false, text: 'Hermes did not answer, so the connection could not be checked.' } : { provider: name, ok: runtime.ok, text: runtime.ok ? `Hermes can use ${name}.` : runtime.error || `Hermes cannot use ${name} yet.` });
  };

  const afterChange = async () => {
    await Promise.all([keys.reload(), oauth.reload(), model.reload(), setup.recheck()]);
  };

  const save = async (key: KeyRow, value: string): Promise<boolean> => {
    const outcome = await saveKey(key, value, profile);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return false;
    toast(`${key.name} saved for ${profile}`, { detail: 'Recorded in the audit log.' });
    await afterChange();
    if (key.provider) await verify(key.provider);
    return true;
  };

  const pickModel = async (choice: ModelChoice) => {
    const outcome = await setMainModel(profile, choice);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`${profile} now uses ${choice.model}`, { detail: 'New sessions use it.' });
    await Promise.all([model.reload(), setup.recheck()]);
  };

  // Only the providers Hermes can sign in itself: the ones another program owns are a command to run elsewhere, which System › Keys lists.
  const signIns = (oauth.value ?? []).filter((candidate) => candidate.flow === 'device_code');
  // The keys of providers: a tool's key (a search API, say) is not what this step is for, and System › Keys has it.
  const known = (keys.value ?? []).filter((group) => group.id === 'provider').flatMap((group) => group.keys);
  const main = model.value?.main;
  const recommended = model.value?.recommended;

  return (
    <div className="stack">
      <p>
        Hermes needs a provider to think with. Add the API key of one, such as OpenRouter or Anthropic, or sign in with an account. Both are the same flows as System › Keys, so a key is checked with Hermes before it is saved and is never shown again. When a provider works, Hermes’s <Term id="recommended-model">recommended model</Term> is offered.
      </p>
      <div className="ob-status panel panel--pad" aria-live="polite">
        <div className="ob-check__head">
          <span className="ob-check__label">Provider</span>
          {provider ? <StatusBadge state={provider.state === 'pass' ? 'succeeded' : 'failed'} label={provider.state === 'pass' ? 'Pass' : 'Fail'} variant="plain" /> : <span className="subtle">Checking…</span>}
        </div>
        {provider && <p className="ob-check__detail">{provider.detail}</p>}
        {verdict && (
          <p className="ob-check__detail" role="status" data-ok={verdict.ok}>
            <Icon name={verdict.ok ? 'check' : 'alert'} small /> {verdict.text}
          </p>
        )}
      </div>

      <section className="ob-block" aria-labelledby="ob-key">
        <h3 id="ob-key">With an API key</h3>
        <WriteButton type="button" className="btn btn--secondary" disabled={keys.value === undefined} onClick={() => setAdding(true)}>
          <Icon name="key" />
          Add a provider key
        </WriteButton>
        {keys.failed && <p className="ob-check__detail">Hermes did not list its keys. Try again in a moment.</p>}
      </section>

      {signIns.length > 0 && <OauthSection profile={profile} providers={signIns} onChanged={afterChange} />}

      <section className="ob-block" aria-labelledby="ob-model">
        <h3 id="ob-model">Model</h3>
        {main === undefined ? (
          <p className="subtle">Asking Hermes which model it would use…</p>
        ) : main.model ? (
          <p>
            Hermes uses <span className="mono">{main.model}</span> {main.provider && <span className="subtle">on {main.provider}</span>}.{' '}
            <AppLink to="/agents/models">Change it in Models</AppLink>
          </p>
        ) : recommended ? (
          <div className="ob-recommend">
            <p>
              Hermes recommends <span className="mono">{recommended.model}</span> <span className="subtle">on {recommended.provider}</span>
              <span className="tag" data-tone="accent">
                Recommended by Hermes
              </span>
            </p>
            <WriteButton type="button" className="btn btn--primary" onClick={() => void pickModel(recommended)}>
              Use {recommended.model}
            </WriteButton>
          </div>
        ) : (
          <p className="subtle">No model is chosen yet. Once a provider works, Hermes suggests one here; or choose one in <AppLink to="/agents/models">Models</AppLink>.</p>
        )}
      </section>

      {adding && <KeySheet mode="add" profile={profile} known={known} onSave={save} onClose={() => setAdding(false)} />}
    </div>
  );
}
