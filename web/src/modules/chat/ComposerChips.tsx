// The composer's settings (M1 #08, calmer in M8 #09): one quiet button with the model and the folder the chat uses, which opens This chat, the popover that holds every
// setting (agent, model, effort, folder, toolsets, saved prompts, context, Fast mode). The owner can hide and reorder the settings of the list; that is a Caduceus
// preference kept for every device. Every value is Hermes's: the chat engine sends the change and Hermes answers.
import { useEffect, useState } from 'react';
import type { ChipId } from '@caduceus/contracts/chat-chips';
import type { ToolsetRow } from '@caduceus/contracts/hermes/gateway';
import { useGatewayStatus } from '../../gateway.ts';
import { Icon, type IconName } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { ComposerPopover } from './composer-popover.tsx';
import { chooseProfile } from '../../profile-scope.ts';
import { useAppNavigate } from '../../shell/navigation.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import type { Catalogue } from '../models/model-catalogue.ts';
import { useModelCatalogue } from '../models/model-data.ts';
import { ModelPickerSheet } from '../models/ModelPicker.tsx';
import { useRemoteWorkspace } from '../tools/terminal-data.ts';
import type { RemoteWorkspace } from '../tools/terminal-model.ts';
import { RemoteBadge } from '../tools/RemoteBadge.tsx';
import { useChipPreference } from './chip-preference.ts';
import { useEnv, useRuntimeVerdict } from './composer-data.ts';
import { chatRows, type ChatRow } from './composer-controls.ts';
import { CHIP_LABELS, confirmedIssue, contextRing, credentialIssue, folderName, type CredentialIssue } from './composer-model.ts';
import { ContextSheet } from './ContextRing.tsx';
import { fastMode, setFastMode } from './fast-session.ts';
import { useStore } from './use-store.ts';
import { ChipsEditor, ProfileEditor, ReasoningEditor, refusedChange, ToolsetsEditor, WorkspaceEditor } from './ComposerEditors.tsx';
import { CredentialBanner } from './CredentialBanner.tsx';
import { PromptLibraryHost, type PromptsAccess } from './Prompts.tsx';
import { onPromptLibraryRequest } from './prompts-handoff.ts';
import type { Chat, ChatState } from './chat-session.ts';

/** Everything the context button, This chat and the credential banner share: the chat, and what Hermes says about the model catalogue, the default folder, the toolsets and the keys. */
export interface ComposerSettings {
  profile: string;
  chat: Chat | undefined;
  state: ChatState;
  catalogue: Catalogue | undefined;
  /** The provider and model the chat will use: its own, or the profile's until it has any. */
  provider: string | undefined;
  model: string | undefined;
  defaultCwd: string | undefined;
  /** The profile's terminal backend when it is not the local one: the workspace is a path on that machine. */
  remote: RemoteWorkspace | undefined;
  toolsets: ToolsetRow[] | undefined;
  reloadToolsets(): void;
  issue: CredentialIssue | undefined;
  reloadEnv(): void;
}

export function useComposerSettings(chat: Chat | undefined, state: ChatState, profile: string): ComposerSettings {
  const connected = useGatewayStatus().state === 'connected';
  const { catalogue, reload } = useModelCatalogue(profile);
  const { env, reload: reloadEnv } = useEnv(profile);
  const remote = useRemoteWorkspace(profile);
  const [defaultCwd, setDefaultCwd] = useState<string>();
  const [toolsets, setToolsets] = useState<ToolsetRow[]>();
  const [toolsetsNonce, setToolsetsNonce] = useState(0);
  useEffect(() => {
    if (chat && connected) chat.defaultWorkspace().then(setDefaultCwd, () => undefined);
  }, [chat, connected]);
  // Read again when the chat gets its session (its agent may have other tools) and after a change.
  useEffect(() => {
    if (chat && connected) chat.toolsets().then(setToolsets, () => undefined);
  }, [chat, connected, state.storedId, toolsetsNonce]);
  // A model picked in another place (the Models screen) shows after the next catalogue read; this one is read again when the chat's own pick changes.
  useEffect(() => {
    void reload();
  }, [reload, state.model, state.provider]);
  const provider = state.provider ?? (catalogue?.current.provider || undefined);
  const model = state.model ?? (catalogue?.current.model || undefined);
  // The environment shows no key: ask Hermes before saying so, because a bridge or a sign-in is a credential the environment cannot show.
  const candidate = env === undefined ? undefined : credentialIssue({ provider, env });
  const runtime = useRuntimeVerdict(profile, candidate?.provider);
  const issue = candidate && runtime.settled ? confirmedIssue(candidate, runtime.verdict) : undefined;
  return {
    profile,
    chat,
    state,
    catalogue,
    provider,
    model,
    defaultCwd,
    remote,
    toolsets,
    reloadToolsets: () => setToolsetsNonce((n) => n + 1),
    issue,
    reloadEnv,
  };
}

/** Switches the chat's model. Hermes may warn about an expensive one and wants its words confirmed first. True when the model is set. */
export async function applyModel(chat: Chat, choice: { provider: string; model: string }): Promise<boolean> {
  try {
    let answer = await chat.setModel(choice);
    if (answer.kind === 'confirm') {
      const confirmed = await confirmTier({ tier: 'T1', moduleId: 'chat', action: 'chat.model', label: 'Hermes warns about this model', text: answer.message, object: choice.model, confirmLabel: 'Use it anyway' });
      if (!confirmed) return false;
      answer = await chat.setModel(choice, { confirmExpensive: true });
    }
    if (answer.kind === 'set' && answer.warning) toast(answer.warning, { tone: 'warning' });
    return true;
  } catch (error) {
    refusedChange('Hermes did not switch the model')(error);
    return false;
  }
}

function ModelSheet({ settings, onClose }: { settings: ComposerSettings; onClose(): void }) {
  const { chat, profile, provider, model } = settings;
  return (
    <ModelPickerSheet
      title="Model for this chat"
      profile={profile}
      {...(provider && model ? { value: { provider, model } } : {})}
      onPick={async (choice) => {
        if (chat && (await applyModel(chat, choice))) onClose();
      }}
      onClose={onClose}
    />
  );
}

/** The warning above the message box when the chat's provider has no key. */
export function ComposerBanner({ settings }: { settings: ComposerSettings }) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      <CredentialBanner profile={settings.profile} issue={settings.issue} onSwitchModel={() => setPicking(true)} onSaved={settings.reloadEnv} />
      {picking && <ModelSheet settings={settings} onClose={() => setPicking(false)} />}
    </>
  );
}

type Editor = ChipId | 'context' | 'customise';

const FAST_OFF = { on: false };

/** What each row of This chat shows to the left, and the icon. */
const ROW_META: Record<Exclude<ChatRow, 'fast' | 'yolo'>, { label: string; icon: IconName | undefined }> = {
  profile: { label: 'Agent', icon: 'user' },
  model: { label: 'Model', icon: 'cpu' },
  reasoning: { label: 'Effort', icon: 'bolt' },
  workspace: { label: 'Folder', icon: 'folder' },
  toolsets: { label: 'Toolsets', icon: 'tool' },
  prompts: { label: 'Saved prompts', icon: 'book' },
  context: { label: 'Context', icon: undefined },
  customise: { label: 'Customise this list', icon: 'sliders' },
};

/**
 * The one quiet button of the composer (M8 #09): the model and the folder the chat uses. It opens This chat, a popover with every setting of the chat: agent, model,
 * effort, folder, toolsets, saved prompts, the context window, Fast mode, and the way to choose which settings are listed. A setting opens the editor the chips used to
 * open (a sheet, a window on a wide screen); the pickers are the same ones.
 */
export function ComposerContext({ settings, prompts }: { settings: ComposerSettings; prompts: PromptsAccess }) {
  const { chat, state, profile, model, defaultCwd, remote, toolsets } = settings;
  const preference = useChipPreference();
  const navigate = useAppNavigate();
  const { hermes } = useProfileScope();
  const { on: fast } = useStore(fastMode, FAST_OFF);
  const [stack, setStack] = useState<Editor[]>([]);
  const open = (editor: Editor) => setStack((now) => [...now, editor]);
  const close = () => setStack((now) => now.slice(0, -1));
  /** The saved-prompts library: a popover above the message box, or a bottom sheet on a phone. The add menu and the palette's command open it too. */
  const [library, setLibrary] = useState(false);
  useEffect(() => onPromptLibraryRequest(() => setLibrary(true)), []);
  const libraryAccess: PromptsAccess = {
    current: prompts.current,
    // A prompt that went into the message box leaves nothing open over it.
    insert: (text) => {
      prompts.insert(text);
      setStack([]);
    },
  };
  const profiles = hermes?.profiles.map((entry) => entry.name) ?? [profile];

  const pickProfile = (name: string) => {
    if (name === profile) return close();
    // A conversation never moves between profiles: the row starts a new chat in the chosen one.
    void navigate(`/chat/new${chooseProfile({ name, search: '', store: localStorage })}`);
  };

  const cwd = state.cwd ?? defaultCwd;
  const enabled = toolsets?.filter((row) => row.enabled).length;
  const ring = contextRing(state.usage);
  const ringWords = [ring.label, ring.cost && `${ring.cost} spent`, ring.cache].filter(Boolean).join(', ');
  const values: Record<Exclude<ChatRow, 'fast' | 'yolo' | 'prompts' | 'customise'>, { text: string; mono?: boolean; words: string }> = {
    profile: { text: profile, words: profile },
    model: { text: model ?? 'Choose', mono: true, words: model ?? 'not chosen yet' },
    reasoning: { text: state.reasoning || 'Default', words: state.reasoning ? `${state.reasoning} effort` : 'the profile’s default' },
    workspace: { text: cwd ? folderName(cwd) : 'Default', mono: true, words: `${cwd ?? 'Hermes’s default folder'}${remote ? ` Remote workspace on ${remote.label}` : ''}` },
    toolsets: { text: enabled === undefined ? 'Loading' : `${enabled} on`, words: enabled === undefined ? 'loading' : `${enabled} toolsets on` },
    context: { text: ring.percent === undefined ? '–' : `${ring.percent}%`, words: ringWords },
  };
  const rows = chatRows(preference, { fast });
  /** Turning YOLO on is a T2 (the chat engine asks for the passkey); the toast says what Hermes or the confirmation refused. */
  const toggleYolo = () =>
    chat?.setYolo(!state.yolo).catch((error: unknown) => toast(state.yolo ? 'YOLO was not switched off' : 'YOLO was not switched on', { tone: 'danger', detail: error instanceof Error ? error.message : String(error) }));

  const editorBody = (id: ChipId) => {
    switch (id) {
      case 'profile':
        return <ProfileEditor profiles={profiles} current={profile} hasSession={state.storedId !== undefined} onPick={pickProfile} />;
      case 'model':
        return null;
      case 'reasoning':
        return <ReasoningEditor chat={chat} state={state} />;
      case 'workspace':
        return <WorkspaceEditor chat={chat} state={state} fallback={defaultCwd} remote={remote} />;
      case 'toolsets':
        return <ToolsetsEditor chat={chat} profile={profile} rows={toolsets} reload={settings.reloadToolsets} />;
    }
  };

  return (
    <>
      <ComposerPopover
        label="This chat"
        placement="top"
        align="fill"
        className="composer__chat-pop"
        trigger={(props) => (
          <button {...props} className="composer__ctx" aria-label={`${model ?? 'Model'}${cwd ? ` ${folderName(cwd)}` : ''}, settings for this chat`} title={cwd ?? undefined}>
            <span className="mono composer__ctx-model">{model ?? 'Model'}</span>
            {cwd && ' '}
            {cwd && <span className="composer__ctx-folder">{folderName(cwd)}</span>}
            <Icon name="chev-d" small />
          </button>
        )}
      >
        {({ close: closeMenu }) => (
          <>
            <p className="pop__title">This chat</p>
            {rows.map((row) => {
              if (row === 'fast') {
                return (
                  <button key={row} type="button" role="switch" aria-checked={fast} className="pop__item" onClick={() => setFastMode(!fast)}>
                    <Icon name="bolt" />
                    <span>
                      Fast mode
                      <small className="pop__hint">Prompts go straight to a model: no agent, nothing saved</small>
                    </span>
                    <Icon name="check" small className="pop__tick" />
                  </button>
                );
              }
              if (row === 'yolo') {
                return (
                  <WriteButton key={row} type="button" role="switch" aria-checked={state.yolo} className="pop__item" disabled={!chat} onClick={() => (closeMenu(true), toggleYolo())}>
                    <Icon name="alert" />
                    <span>
                      YOLO for this chat
                      <small className="pop__hint">Hermes runs every command without asking; switching it on needs your passkey</small>
                    </span>
                    <Icon name="check" small className="pop__tick" />
                  </WriteButton>
                );
              }
              const meta = ROW_META[row];
              const value = row === 'prompts' || row === 'customise' ? undefined : values[row];
              return (
                <button
                  key={row}
                  type="button"
                  className="pop__item"
                  aria-haspopup="dialog"
                  {...(value ? { title: value.words } : {})}
                  onClick={() => {
                    closeMenu(true);
                    if (row === 'prompts') setLibrary(true);
                    else open(row === 'customise' ? 'customise' : row);
                  }}
                >
                  {row === 'context' ? <span className="ring" style={{ ['--v' as string]: ring.percent ?? 0 }} data-tone={ring.tone} aria-hidden="true" /> : meta.icon && <Icon name={meta.icon} />}
                  <span>{meta.label}</span>
                  {value && (
                    <span className={`pop__value composer__value${value.mono ? ' mono' : ''}`}>
                      {value.text}
                      {row === 'workspace' && <RemoteBadge remote={remote} inLabel />}
                    </span>
                  )}
                </button>
              );
            })}
          </>
        )}
      </ComposerPopover>
      {library && <PromptLibraryHost profile={profile} access={libraryAccess} onClose={() => setLibrary(false)} />}
      {stack.map((editor, index) => {
        if (editor === 'model') return <ModelSheet key={`${editor}-${index}`} settings={settings} onClose={close} />;
        if (editor === 'context') return <ContextSheet key={`${editor}-${index}`} chat={chat} state={state} onClose={close} />;
        if (editor === 'customise') {
          return (
            <Sheet key={`${editor}-${index}`} title="Customise this list" onClose={close}>
              <ChipsEditor preference={preference} />
            </Sheet>
          );
        }
        return (
          <Sheet key={`${editor}-${index}`} title={CHIP_LABELS[editor]} onClose={close}>
            {editorBody(editor)}
          </Sheet>
        );
      })}
    </>
  );
}
