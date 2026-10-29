// What the owner can do with a skill, from its row, its ⋮ menu or its detail: one place holds them, and the menu sheet. Hermes does
// the work (`skill-actions.ts`); this asks, says what happened, and asks Hermes for the list again.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../icons.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useAppNavigate } from '../../shell/navigation.tsx';
import { toast } from '../../shell/toasts.ts';
import { deleteSkill, setSkillEnabled, uninstallSkill } from './skill-actions.ts';
import { removalOf, type SkillRow } from './skills-model.ts';
import '../profiles/profiles.css';

export interface SkillCommands {
  /** The profile every command works on. */
  profile: string;
  /** Skills Hermes is changing now: their switch waits for the answer. */
  busy: ReadonlySet<string>;
  open(skill: SkillRow): void;
  openMenu(skill: SkillRow): void;
  toggle(skill: SkillRow): Promise<void>;
  edit(skill: SkillRow): void;
  remove(skill: SkillRow): Promise<void>;
}

const CommandsContext = createContext<SkillCommands | undefined>(undefined);

export function useSkillCommands(): SkillCommands {
  const commands = useContext(CommandsContext);
  if (!commands) throw new Error('useSkillCommands needs a SkillCommandsProvider');
  return commands;
}

/** The address of a skill's editor; `new` is the editor of a skill that does not exist yet. */
export const editorPath = (profile: string, name: string) => `/agents/skills/${encodeURIComponent(name)}?profile=${encodeURIComponent(profile)}`;

const PROVENANCE_WORDS = { hub: 'Installed from the hub', bundled: 'Bundled with Hermes', agent: 'Local skill' } as const;
export const provenanceWords = (skill: SkillRow) => PROVENANCE_WORDS[skill.provenance];

export function SkillCommandsProvider({ profile, reload, open, closeDetail, children }: { profile: string; reload(): Promise<void>; open(skill: SkillRow): void; closeDetail(): void; children: ReactNode }) {
  const [menu, setMenu] = useState<SkillRow>();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const navigate = useAppNavigate();

  const commands = useMemo<SkillCommands>(() => {
    const working = async (name: string, run: () => Promise<void>) => {
      setBusy((now) => new Set(now).add(name));
      try {
        await run();
      } finally {
        setBusy((now) => {
          const next = new Set(now);
          next.delete(name);
          return next;
        });
      }
    };
    const toggle = (skill: SkillRow): Promise<void> =>
      working(skill.name, async () => {
        const outcome = await setSkillEnabled(profile, skill.name, !skill.enabled);
        if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
        if (outcome.kind !== 'done') return;
        await reload();
        toast(`${skill.name} is switched ${skill.enabled ? 'off' : 'on'} for ${profile}`, {
          tone: 'info',
          detail: skill.enabled ? 'Sessions that start from now on do not use it.' : 'Sessions that start from now on can use it.',
          undo: () =>
            void setSkillEnabled(profile, skill.name, skill.enabled).then(async (undone) => {
              if (undone.kind === 'failed') toast(undone.message, { tone: 'danger' });
              await reload();
            }),
        });
      });
    return {
      profile,
      busy,
      open,
      openMenu: setMenu,
      toggle,
      edit: (skill) => void navigate(editorPath(profile, skill.name)),
      remove: (skill) =>
        working(skill.name, async () => {
          const kind = removalOf(skill);
          if (kind === 'none') return;
          const outcome = kind === 'uninstall' ? await uninstallSkill(profile, skill.name) : await deleteSkill(profile, skill.name);
          if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
          if (outcome.kind !== 'done') return;
          closeDetail();
          await reload();
          if (kind === 'uninstall') toast(`Uninstalled ${skill.name} from ${profile}`, { tone: 'info' });
          else toast(`Deleted ${skill.name} from ${profile}`, { tone: 'info', detail: outcome.body?.message });
        }),
    };
  }, [profile, busy, open, closeDetail, reload, navigate]);

  return (
    <CommandsContext value={commands}>
      {children}
      {menu && <SkillMenu skill={menu} onClose={() => setMenu(undefined)} />}
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

/** A row's ⋮ menu, as a sheet (mobile spec §2: nothing is hover-only). */
function SkillMenu({ skill, onClose }: { skill: SkillRow; onClose(): void }) {
  const commands = useSkillCommands();
  const removal = removalOf(skill);
  const actions: MenuAction[] = [
    { id: 'open', icon: 'chev-r', label: 'Open details', sub: 'Reads SKILL.md and its linked files', run: () => commands.open(skill) },
    { id: 'toggle', icon: 'sliders', label: skill.enabled ? 'Switch off' : 'Switch on', sub: `For ${commands.profile} only · you can undo it`, run: () => void commands.toggle(skill) },
    { id: 'edit', icon: 'type', label: 'Edit SKILL.md…', sub: 'You confirm · the frontmatter is kept as it is', run: () => commands.edit(skill) },
    ...(removal === 'uninstall' ? [{ id: 'remove', icon: 'trash', label: 'Uninstall…', sub: `You confirm · from ${commands.profile}`, danger: true, run: () => void commands.remove(skill) } satisfies MenuAction] : []),
    ...(removal === 'delete' ? [{ id: 'remove', icon: 'trash', label: 'Delete…', sub: 'You confirm · Hermes archives it', danger: true, run: () => void commands.remove(skill) } satisfies MenuAction] : []),
  ];
  return (
    <Sheet title={skill.name} detents={['auto', 'full']} onClose={onClose}>
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
      {removal === 'none' && <p className="subtle pf-note">A skill bundled with Hermes cannot be removed here. Switching it off keeps it from this profile’s sessions.</p>}
    </Sheet>
  );
}
