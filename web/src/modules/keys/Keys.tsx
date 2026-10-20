import { useMemo, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { KeyCard } from './KeyCard.tsx';
import { KeySheet } from './KeySheet.tsx';
import { saveKey } from './key-actions.ts';
import { useKeysData } from './keys-data.ts';
import type { KeyGroup, KeyRow } from './keys-model.ts';
import { EndpointsSection } from './EndpointsSection.tsx';
import { OauthSection } from './OauthSection.tsx';
import { PoolSection } from './PoolSection.tsx';
import { PortalCard } from './PortalCard.tsx';
import '../profiles/profiles.css';
import './keys.css';
import './keys-page.css';

/** Whether every word of the search is somewhere in `text`. */
const matches = (words: readonly string[], text: string): boolean => words.every((word) => text.toLowerCase().includes(word));

/** The keys that are set, by group, narrowed by the search. */
function setKeys(groups: readonly KeyGroup[], words: readonly string[]): KeyGroup[] {
  return groups
    .map((group) => ({ ...group, keys: group.keys.filter((key) => key.isSet && matches(words, `${key.name} ${key.provider} ${key.providerLabel} ${key.description}`)) }))
    .filter((group) => group.keys.length > 0);
}

/** What a sheet is open for: a new key, or a replacement of one that is set. */
type Editing = { mode: 'add' } | { mode: 'replace'; key: KeyRow };

function KeysScreen({ profile }: { profile: string }) {
  const data = useKeysData(profile);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editing>();
  /** Counts the keys saved on this screen: a card starts afresh (no earlier test result) once its key has a new value. */
  const [saved, setSaved] = useState(0);
  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const groups = data.keys.value;
  const failed = data.keys.failed || data.pool.failed || data.oauth.failed || data.endpoints.failed || data.portal.failed;
  const loading = groups === undefined || data.pool.value === undefined || data.oauth.value === undefined || data.endpoints.value === undefined;

  const shownKeys = useMemo(() => setKeys(groups ?? [], words), [groups, words]);
  const known = useMemo(() => (groups ?? []).flatMap((group) => group.keys), [groups]);
  const shownOauth = (data.oauth.value ?? []).filter((provider) => matches(words, `${provider.name} ${provider.id}`));
  const shownPool = (data.pool.value ?? []).filter((pool) => matches(words, `${pool.provider} pool ${pool.entries.map((entry) => entry.label).join(' ')}`));
  const shownEndpoints = (data.endpoints.value ?? []).filter((endpoint) => matches(words, `${endpoint.name} ${endpoint.baseUrl} ${endpoint.model} endpoint`));
  const keyCount = (groups ?? []).reduce((count, group) => count + group.keys.filter((key) => key.isSet).length, 0);

  const save = async (key: KeyRow, value: string): Promise<boolean> => {
    const outcome = await saveKey(key, value, profile);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return false;
    toast(`${key.name} ${key.isSet ? 'replaced' : 'saved'} for ${profile}`, { detail: 'Recorded in the audit log. Test connection checks that it works.' });
    setSaved((count) => count + 1);
    await data.keys.reload();
    return true;
  };

  const nothingMatches = !loading && words.length > 0 && shownKeys.length === 0 && shownOauth.length === 0 && shownPool.length === 0 && shownEndpoints.length === 0;

  return (
    <div className="ky">
      <PageHeader
        overline="System"
        title="Keys"
        subtitle={
          <span className="ky-head__meta">
            <Sigil name={profile} size="xs" />
            <span>
              Credentials of <strong>{profile}</strong>
            </span>
            {groups && <span className="subtle">{keyCount === 1 ? '1 key set' : `${keyCount} keys set`}</span>}
          </span>
        }
        actions={
          <WriteButton type="button" className="btn btn--primary" onClick={() => setEditing({ mode: 'add' })}>
            <Icon name="plus" />
            Add key
          </WriteButton>
        }
      />
      <p className="help-text">
        Provider keys, account sign-ins, <Term id="credential-pool">credential pools</Term> and <Term id="custom-endpoint">custom endpoints</Term> are kept by Hermes for each profile. A key is never sent to this page, not even in part: the one way to see it is Reveal, which is a <Term id="risk-tiers">Tier 3</Term> action, shows it for 30 seconds and is audited.
      </p>
      {failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer for some of this page{loading ? '' : ': what shows is from a moment ago'}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void data.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      <div className="ky-search" role="search">
        <div className="input-wrap">
          <Icon name="search" />
          <input type="search" className="input" placeholder="Search providers, variables and endpoints" aria-label="Search keys and sign-ins" autoComplete="off" spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>
      {loading && !failed && <p role="status">Loading credentials…</p>}
      {nothingMatches && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="key" />
          </span>
          <p>Nothing matches “{query.trim()}”.</p>
          <button type="button" className="btn btn--secondary" onClick={() => setQuery('')}>
            Clear the search
          </button>
        </div>
      )}

      {data.oauth.value && shownOauth.length > 0 && <OauthSection profile={profile} providers={shownOauth} onChanged={data.reload} />}

      {groups && (words.length === 0 || shownKeys.length > 0) && (
        <section className="ky-section" aria-labelledby="ky-keys">
          <div className="ky-section__head">
            <h2 className="ky-section__title" id="ky-keys">
              <Icon name="key" />
              Provider keys
              <span className="ky-section__count">{shownKeys.reduce((count, group) => count + group.keys.length, 0)}</span>
            </h2>
          </div>
          {shownKeys.length === 0 ? (
            <div className="empty">
              <span className="empty__icon">
                <Icon name="key" />
              </span>
              <p>No keys are set for {profile}.</p>
              <p>Add the key of a provider, such as OpenRouter or Anthropic, so the profile can use its models.</p>
              <WriteButton type="button" className="btn btn--primary" onClick={() => setEditing({ mode: 'add' })}>
                <Icon name="plus" />
                Add key
              </WriteButton>
            </div>
          ) : (
            shownKeys.map((group) => (
              <div key={group.id} className="ky-group">
                <h3 className="ky-group__title">{group.title}</h3>
                <ul className="ky-cards" aria-label={group.title}>
                  {group.keys.map((key) => (
                    <KeyCard key={`${key.name}:${saved}`} keyRow={key} profile={profile} onReplace={(row) => setEditing({ mode: 'replace', key: row })} onChanged={data.keys.reload} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      )}

      {data.pool.value && (words.length === 0 || shownPool.length > 0) && <PoolSection profile={profile} pool={shownPool} onChanged={data.reload} />}
      {data.endpoints.value && (words.length === 0 || shownEndpoints.length > 0) && <EndpointsSection profile={profile} endpoints={shownEndpoints} onChanged={data.reload} />}
      {words.length === 0 && data.portal.value && <PortalCard profile={profile} portal={data.portal.value} />}

      {editing && <KeySheet mode={editing.mode} replacing={editing.mode === 'replace' ? editing.key : undefined} profile={profile} known={known} onSave={save} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

/** System › Keys: the credentials of the profile this tab is scoped to. */
export function Keys() {
  const { effective } = useProfileScope();
  return effective ? <KeysScreen key={effective.name} profile={effective.name} /> : <p role="status">Loading…</p>;
}
