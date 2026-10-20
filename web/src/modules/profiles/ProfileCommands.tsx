// What the owner can do with a profile, from a card's ⋮ menu or from the detail: one place holds them, and the sheets they open.
// Hermes does the work (`profile-actions.ts`, `make-default.ts`); this asks, says what happened, and refreshes what shows profiles.
import { createContext, useContext, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Icon, type IconName } from '../../icons.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useAppNavigate, useRouteInfo } from '../../shell/navigation.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { deleteProfile, renameProfile, type ActionOutcome } from './profile-actions.ts';
import { makeDefault } from './make-default.ts';
import { cliCommand, deleteRefusal, renameProblem, type ProfileCard } from './profiles-model.ts';

export interface ProfileCommands {
  openMenu(card: ProfileCard): void;
  /** Opens the profile builder, blank, or as a clone of `from`. */
  openCreate(from?: ProfileCard): void;
  useInThisTab(card: ProfileCard): void;
  makeDefault(card: ProfileCard): Promise<void>;
  copyCliCommand(card: ProfileCard): Promise<void>;
  openRename(card: ProfileCard): void;
  remove(card: ProfileCard): Promise<void>;
}

const CommandsContext = createContext<ProfileCommands | undefined>(undefined);

export function useProfileCommands(): ProfileCommands {
  const commands = useContext(CommandsContext);
  if (!commands) throw new Error('useProfileCommands needs a ProfileCommandsProvider');
  return commands;
}

type Open = { kind: 'menu'; card: ProfileCard } | { kind: 'rename'; card: ProfileCard };

/** Says why an action did not happen; a decline says nothing. Returns whether it went through. */
function report(outcome: ActionOutcome): boolean {
  if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
  return outcome.kind === 'done';
}

export function ProfileCommandsProvider({ cards, reload, children }: { cards: readonly ProfileCard[]; reload(): Promise<void>; children: ReactNode }) {
  const [open, setOpen] = useState<Open>();
  const scope = useProfileScope();
  const navigate = useAppNavigate();
  const { pathname } = useRouteInfo();

  /** Hermes has changed: this screen and the profile switcher ask again. */
  const refresh = async () => {
    scope.reload();
    await reload();
  };
  /** A profile's detail screen follows it to its new name. */
  const followRename = (from: string, to: string) => {
    const [agents, profiles, name, ...rest] = pathname.split('/').filter(Boolean);
    if (agents === 'agents' && profiles === 'profiles' && name === from) void navigate(`/agents/profiles/${[to, ...rest].join('/')}`, { replace: true });
  };

  const commands = useMemo<ProfileCommands>(
    () => ({
      openMenu: (card) => setOpen({ kind: 'menu', card }),
      openCreate: (from) => void navigate(from ? `/agents/profiles/new?clone=${encodeURIComponent(from.name)}` : '/agents/profiles/new'),
      useInThisTab: (card) => void scope.choose(card.name),
      async makeDefault(card) {
        const previous = cards.find((c) => c.isDefault)?.name ?? 'default';
        if (report(await makeDefault(card.name, previous))) {
          toast(`${card.name} is now the default profile`, { detail: `was ${previous}` });
          await refresh();
        }
      },
      async copyCliCommand(card) {
        const command = cliCommand(card.name);
        try {
          await navigator.clipboard.writeText(command);
          toast('Copied the CLI command', { detail: command, tone: 'info' });
        } catch {
          toast(`This browser would not copy. The command is: ${command}`, { tone: 'warning' });
        }
      },
      openRename: (card) => setOpen({ kind: 'rename', card }),
      async remove(card) {
        const refusal = deleteRefusal(card, cards);
        if (refusal) {
          toast(refusal, { tone: 'warning' });
          return;
        }
        if (!report(await deleteProfile(card))) return;
        toast(`Deleted the profile ${card.name}`, { tone: 'info', detail: 'This cannot be undone from Caduceus.' });
        if (pathname.startsWith(`/agents/profiles/${card.name}`)) void navigate('/agents/profiles', { replace: true });
        await refresh();
      },
    }),
    // `refresh` and `followRename` are rebuilt every render from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, scope, navigate, pathname],
  );

  /** Renames, then offers the undo for a few seconds. */
  const rename = async (card: ProfileCard, to: string): Promise<boolean> => {
    const outcome = await renameProfile(card.name, to);
    if (!report(outcome) || outcome.kind !== 'done') return false;
    const now = outcome.body.name;
    followRename(card.name, now);
    await refresh();
    toast(card.isRoot ? `Renamed ${card.name} to ${to}` : `Renamed ${card.name} to ${now}`, {
      undo: () => {
        // The root profile keeps its id: undoing puts back the display name it had, or its id when it had none.
        void renameProfile(now, card.isRoot ? card.displayName || card.name : card.name).then(async (undone) => {
          if (report(undone)) {
            followRename(now, card.name);
            await refresh();
          }
        });
      },
    });
    return true;
  };

  return (
    <CommandsContext value={commands}>
      {children}
      {open?.kind === 'menu' && <ProfileMenu card={open.card} cards={cards} onClose={() => setOpen(undefined)} />}
      {open?.kind === 'rename' && <RenameSheet card={open.card} cards={cards} rename={rename} onClose={() => setOpen(undefined)} />}
    </CommandsContext>
  );
}

interface MenuAction {
  id: string;
  icon: IconName;
  label: string;
  sub?: string;
  danger?: boolean;
  run(): void;
}

/** A card's ⋮ menu, as a sheet (mobile spec §2: nothing is hover-only). */
function ProfileMenu({ card, cards, onClose }: { card: ProfileCard; cards: readonly ProfileCard[]; onClose(): void }) {
  const commands = useProfileCommands();
  const navigate = useAppNavigate();
  const { effective } = useProfileScope();
  const refusal = deleteRefusal(card, cards);
  const actions: MenuAction[] = [
    { id: 'open', icon: 'chev-r', label: 'Open profile', run: () => void navigate(`/agents/profiles/${card.name}`) },
    { id: 'chat', icon: 'chat', label: `New chat as ${card.name}`, run: () => void navigate(`/chat/new?profile=${encodeURIComponent(card.name)}`) },
    ...(effective?.name !== card.name ? [{ id: 'use', icon: 'user', label: 'Use in this tab', sub: 'Sets this tab’s profile only', run: () => commands.useInThisTab(card) } satisfies MenuAction] : []),
    ...(!card.isDefault ? [{ id: 'default', icon: 'fingerprint', label: 'Make default…', sub: 'Tier 2 · changes Hermes’s default profile', run: () => void commands.makeDefault(card) } satisfies MenuAction] : []),
    { id: 'clone', icon: 'copy', label: 'Clone…', sub: 'Opens the builder with this profile’s settings', run: () => commands.openCreate(card) },
    { id: 'cli', icon: 'terminal', label: 'Copy CLI command', sub: cliCommand(card.name), run: () => void commands.copyCliCommand(card) },
    { id: 'rename', icon: 'type', label: 'Rename…', sub: card.isRoot ? 'Sets its display name' : 'You can undo it', run: () => commands.openRename(card) },
    { id: 'delete', icon: 'trash', label: 'Delete…', sub: refusal ?? 'Tier 3 · type the name', danger: true, run: () => void commands.remove(card) },
  ];
  return (
    <Sheet title={card.name} detents={['auto', 'full']} onClose={onClose}>
      <ul className="pf-acts">
        {actions.map((action) => (
          <li key={action.id}>
            <button
              type="button"
              className={`pf-act${action.danger ? ' pf-act--danger' : ''}`}
              onClick={() => {
                onClose();
                // The sheet is closed before the next dialog opens, so the layers never stack.
                void closeAllLayers().then(action.run);
              }}
            >
              <Icon name={action.icon} />
              <span>
                <span>{action.label}</span>
                {action.sub && <small>{action.sub}</small>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function RenameSheet({ card, cards, rename, onClose }: { card: ProfileCard; cards: readonly ProfileCard[]; rename(card: ProfileCard, to: string): Promise<boolean>; onClose(): void }) {
  const id = useId();
  const [value, setValue] = useState(card.isRoot ? card.displayName || card.name : card.name);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const problem = renameProblem(card.name, value, cards.map((c) => c.name), { root: card.isRoot });
  const same = card.isRoot ? value.trim() === (card.displayName || card.name) : false;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (problem || same || busy) return;
    setBusy(true);
    if (await rename(card, value.trim())) onClose();
    else setBusy(false);
  };
  return (
    <Sheet title={`Rename ${card.name}`} initialFocus="input" onClose={onClose}>
      <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label className="field__label" htmlFor={id}>
            {card.isRoot ? 'Display name' : 'New name'}
          </label>
          <input
            id={id}
            className="input input--mono"
            value={value}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            aria-invalid={touched && problem ? true : undefined}
            aria-describedby={`${id}-help ${id}-error`}
            onChange={(event) => {
              setValue(event.target.value);
              setTouched(true);
            }}
          />
          <p className="field__help" id={`${id}-help`}>
            {card.isRoot
              ? 'The root profile keeps its id (default); Hermes stores this name beside it. You can undo for a few seconds.'
              : 'Hermes renames the profile’s folder and everything that points at it. If the gateway is running it is stopped first. You can undo for a few seconds.'}
          </p>
          <p className="field__error" id={`${id}-error`} role="alert">
            {touched && problem && (
              <>
                <Icon name="alert" small />
                {problem}
              </>
            )}
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <WriteButton type="submit" className="btn btn--primary" disabled={busy || same} aria-busy={busy}>
            Rename
          </WriteButton>
        </div>
      </form>
    </Sheet>
  );
}
