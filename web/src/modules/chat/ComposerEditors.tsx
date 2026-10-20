// The editors behind the composer's chips (M1 #08): what each setting offers, free of where it is shown. A chip opens one in a sheet (a dialog on a wide
// screen); on a phone the config sheet holds them all. They call the chat engine, which sends the matching Hermes call; Hermes's refusal comes back as
// words in a toast and nothing here keeps the choice (Hermes is the source of truth).
import { useId, useState, type FormEvent } from 'react';
import { CHIP_IDS, type ChipPreference } from '@caduceus/contracts/chat-chips';
import type { ToolsetRow } from '@caduceus/contracts/hermes/gateway';
import { Icon } from '../../icons.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { useWorkspaceChoices } from '../work/workspace-registry-data.ts';
import { RemoteBadge } from '../tools/RemoteBadge.tsx';
import type { RemoteWorkspace } from '../tools/terminal-model.ts';
import { saveChipPreference } from './chip-preference.ts';
import { CHAT_REASONING, CHIP_LABELS, moveChip, toggleChip } from './composer-model.ts';
import type { Chat, ChatState } from './chat-session.ts';

/** What a refused change says: Hermes's own words. */
export const refusedChange = (title: string) => (error: unknown): void => {
  toast(title, { tone: 'danger', detail: error instanceof Error ? error.message : String(error) });
};

export function ProfileEditor({ profiles, current, hasSession, onPick }: { profiles: readonly string[]; current: string; hasSession: boolean; onPick(name: string): void }) {
  return (
    <div className="cfg-field">
      <p className="subtle cfg-help">{hasSession ? 'A conversation stays in the profile it started in. Choosing another profile starts a new chat there.' : 'The profile this chat will start in.'}</p>
      <ul className="list panel" aria-label="Profiles">
        {profiles.map((name) => (
          <li key={name}>
            <button type="button" className="list-row hit cfg-row" aria-current={name === current ? 'true' : undefined} onClick={() => onPick(name)}>
              <span className="list-row__main">
                <span className="list-row__title">{name}</span>
              </span>
              {name === current ? <Icon name="check" small /> : <Icon name="chev-r" small />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReasoningEditor({ chat, state }: { chat: Chat | undefined; state: ChatState }) {
  const labelId = useId();
  const value = state.reasoning ?? '';
  // A level Hermes reports that the list does not know still shows as chosen.
  const options = value === '' || CHAT_REASONING.some((level) => level.value === value) ? CHAT_REASONING : [...CHAT_REASONING, { value, label: value }];
  return (
    <div className="cfg-field">
      <p id={labelId} className="cfg-label">
        Reasoning effort
      </p>
      <p className="subtle cfg-help">{value === '' ? 'The profile’s default is in use. ' : ''}A choice here is for this chat only.</p>
      <RadioGroup
        labelledBy={labelId}
        className="seg cfg-seg"
        value={value}
        options={value === '' ? [{ value: '', label: 'Default' }, ...options] : options.map((level) => ({ value: level.value, label: level.label }))}
        onChange={(next) => next !== '' && void chat?.setReasoning(next).catch(refusedChange('Hermes did not take that reasoning effort'))}
      />
    </div>
  );
}

export function WorkspaceEditor({ chat, state, fallback, remote }: { chat: Chat | undefined; state: ChatState; fallback: string | undefined; remote: RemoteWorkspace | undefined }) {
  const id = useId();
  const [draft, setDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const shown = state.cwd ?? fallback ?? '';
  const value = draft ?? shown;
  const hasSession = state.storedId !== undefined;
  // The owner's registered workspaces (Work › Projects), in the owner's order; a tap fills the field, and Use or Move sends it.
  const choices = useWorkspaceChoices(value);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cwd = value.trim();
    if (!chat || cwd === '' || cwd === state.cwd) return;
    // A chat with a session is moved in Hermes (Tier 1); one that has none only remembers where it will start.
    if (hasSession && !(await confirmTier({ tier: 'T1', moduleId: 'chat', action: 'chat.workspace', label: 'Move this chat to another folder?', text: `Hermes’s agent works in ${cwd} from the next message on.`, object: cwd, confirmLabel: 'Move chat' }))) return;
    setBusy(true);
    try {
      await chat.setWorkspace(cwd);
      setDraft(undefined);
    } catch (error) {
      refusedChange('Hermes did not move the chat')(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="cfg-field" onSubmit={(event) => void submit(event)}>
      <label className="cfg-label" htmlFor={id}>
        Workspace folder <RemoteBadge remote={remote} />
      </label>
      <p className="subtle cfg-help" id={`${id}-help`}>
        The folder Hermes’s agent works in: its commands and files start there.{fallback && state.cwd === undefined ? ' Until you choose one, Hermes uses its default.' : ''}
        {remote ? <> The terminal backend of this profile is {remote.label}, so this is a path on that machine, a <Term id="remote-workspace">remote workspace</Term>. {remote.backend === 'ssh' ? 'Hermes does not check it: it takes the path as you type it.' : 'Hermes checks a folder on its own Mac, and refuses one that exists only there with its own message.'}</> : ''}
        {state.running ? ' Hermes cannot move a chat while it is writing a reply.' : ''}
      </p>
      <div className="cfg-inline">
        <input id={id} className="input mono" value={value} spellCheck={false} autoCapitalize="none" autoCorrect="off" aria-describedby={`${id}-help`} onChange={(event) => setDraft(event.target.value)} />
        <WriteButton type="submit" className="btn btn--secondary" disabled={!chat || busy || state.running || value.trim() === '' || value.trim() === state.cwd}>
          {hasSession ? 'Move' : 'Use'}
        </WriteButton>
      </div>
      {choices !== undefined && (
        <div className="cfg-choices">
          <p className="cfg-label" id={`${id}-choices`}>
            Your workspaces
          </p>
          {choices.length === 0 ? (
            <p className="subtle cfg-help">
              You have none yet. Name the folders you use often under <AppLink to="/work/projects">Work › Projects</AppLink> and they are listed here.
            </p>
          ) : (
            <ul className="list panel" aria-labelledby={`${id}-choices`}>
              {choices.map((choice) => (
                <li key={choice.id}>
                  <button type="button" className="list-row hit cfg-row" aria-current={choice.current ? 'true' : undefined} onClick={() => setDraft(choice.path)}>
                    <span className="list-row__main">
                      <span className="list-row__title">{choice.name}</span>
                      <span className="list-row__sub mono">{choice.path}</span>
                    </span>
                    {choice.current ? <Icon name="check" small /> : <Icon name="chev-r" small />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

export function ToolsetsEditor({ chat, profile, rows, reload }: { chat: Chat | undefined; profile: string; rows: readonly ToolsetRow[] | undefined; reload(): void }) {
  const [busy, setBusy] = useState<string>();
  const toggle = async (row: ToolsetRow) => {
    if (!chat) return;
    const action = row.enabled ? 'disable' : 'enable';
    // Hermes saves this in the profile's config, so it is not only this chat's: say so before it is done.
    const confirmed = await confirmTier({
      tier: 'T1',
      moduleId: 'chat',
      action: 'chat.toolsets',
      label: `Turn ${row.enabled ? 'off' : 'on'} ${row.name} for ${profile}?`,
      text: 'Hermes saves this in the profile’s config: it holds for every chat in the profile, and this chat’s agent starts again with the new tools.',
      object: row.name,
      profile,
      confirmLabel: row.enabled ? 'Turn off' : 'Turn on',
    });
    if (!confirmed) return;
    setBusy(row.name);
    try {
      await chat.configureToolsets(action, [row.name]);
      reload();
    } catch (error) {
      refusedChange(`Hermes did not turn ${row.name} ${row.enabled ? 'off' : 'on'}`)(error);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <div className="cfg-field">
      <p className="cfg-label">Toolsets</p>
      <p className="subtle cfg-help">What the agent can use. Toolsets belong to the profile, not to one chat: a change applies to every chat in {profile}.</p>
      {rows === undefined ? (
        <p className="subtle" role="status">
          Asking Hermes for its toolsets…
        </p>
      ) : (
        <ul className="list panel cfg-toolsets" aria-label="Toolsets">
          {rows.map((row) => (
            <li key={row.name} className="switch-row cfg-toolset">
              <span className="cfg-toolset__text" id={`ts-${row.name}`}>
                <span className="cfg-toolset__name">{row.name}</span>
                <span className="subtle cfg-toolset__desc">
                  {row.tool_count} {row.tool_count === 1 ? 'tool' : 'tools'}
                  {row.description ? ` · ${row.description}` : ''}
                </span>
              </span>
              <WriteButton type="button" role="switch" className="switch" aria-checked={row.enabled} aria-labelledby={`ts-${row.name}`} disabled={!chat || busy !== undefined} onClick={() => void toggle(row)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Reorders and hides the chips; every change is saved for every device. */
export function ChipsEditor({ preference }: { preference: ChipPreference }) {
  const save = (next: ChipPreference) => void saveChipPreference(next).catch(refusedChange('The list was not saved'));
  return (
    <div className="cfg-field">
      <p className="cfg-label">Settings in This chat</p>
      <p className="subtle cfg-help">Choose which <Term id="composer-chips">settings</Term> This chat lists, and in what order. This is kept for every device you use.</p>
      <ul className="list panel" aria-label="Settings in This chat">
        {preference.order.map((id, index) => (
          <li key={id} className="switch-row cfg-chip">
            <span className="cfg-chip__name" id={`chip-${id}`}>
              {CHIP_LABELS[id]}
            </span>
            <span className="cfg-chip__actions">
              <button type="button" className="btn btn--ghost btn--icon" aria-label={`Move ${CHIP_LABELS[id]} earlier`} disabled={index === 0} onClick={() => save(moveChip(preference, id, 'earlier'))}>
                <Icon name="chev-d" className="cfg-up" />
              </button>
              <button type="button" className="btn btn--ghost btn--icon" aria-label={`Move ${CHIP_LABELS[id]} later`} disabled={index === CHIP_IDS.length - 1} onClick={() => save(moveChip(preference, id, 'later'))}>
                <Icon name="chev-d" />
              </button>
              <button type="button" role="switch" className="switch" aria-checked={!preference.hidden.includes(id)} aria-labelledby={`chip-${id}`} onClick={() => save(toggleChip(preference, id))} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
