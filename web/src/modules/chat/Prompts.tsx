// The saved-prompts library (M1 #11): the owner's named prompts, to search, filter by tag, insert into the message box, edit, delete and make from what is
// typed. A desktop composer opens it as a popover above the message box; a phone opens it as a bottom sheet from the config sheet. The palette opens either.
// The prompts are Caduceus's own (kept on the Caduceus server, for every device); nothing here goes to Hermes until a prompt is in the box and Send is pressed.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { SavedPrompt, SavedPromptInput } from '@caduceus/contracts/chat-drafts';
import { MAX_PROMPT_NAME, MAX_PROMPT_TAGS, MAX_PROMPT_TEXT_BYTES } from '@caduceus/contracts/chat-drafts';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { deletePrompt, savePrompt, usePrompts } from './prompts-data.ts';
import { filterPrompts, forProfile, parseTags, tagsOf } from './saved-prompts.ts';
import { ChangeButton } from './SessionOrganiser.tsx';

/** What the library needs of the composer: what is typed (and the selected part of it) to save as a prompt, and how to put a prompt in the box. */
export interface PromptsAccess {
  current(): { text: string; selected: string };
  insert(text: string): void;
}

const words = (error: unknown) => (error instanceof Error ? error.message : String(error));

function PromptEditor({ profile, prompt, initialText, onDone }: { profile: string; prompt: SavedPrompt | undefined; initialText: string; onDone(): void }) {
  const ids = { name: useId(), text: useId(), tags: useId(), scope: useId() };
  const [name, setName] = useState(prompt?.name ?? '');
  const [text, setText] = useState(prompt?.text ?? initialText);
  const [tags, setTags] = useState(prompt?.tags.join(', ') ?? '');
  const [scope, setScope] = useState<'all' | 'profile'>(prompt?.profile ? 'profile' : 'all');
  const [problem, setProblem] = useState<string>();
  const [saving, setSaving] = useState(false);
  const input: SavedPromptInput = { name: name.trim(), text, tags: parseTags(tags), profile: scope === 'profile' ? profile : null };
  const tooManyTags = input.tags.length > MAX_PROMPT_TAGS;
  const ready = input.name !== '' && text.trim() !== '' && !tooManyTags && !saving;
  const save = async () => {
    setSaving(true);
    setProblem(undefined);
    try {
      await savePrompt(input, prompt?.id);
      toast(prompt ? `Saved “${input.name}”` : `Saved the prompt “${input.name}”`, { tone: 'success' });
      onDone();
    } catch (error) {
      setProblem(words(error));
    } finally {
      setSaving(false);
    }
  };
  // The library may sit inside the message box's form: Enter in a field must never send the message.
  const noSubmit = (event: KeyboardEvent<HTMLInputElement>) => event.key === 'Enter' && event.preventDefault();
  return (
    <div className="field prompts__edit" role="group" aria-label={prompt ? `Edit ${prompt.name}` : 'New saved prompt'}>
      <label className="field__label" htmlFor={ids.name}>
        Name
      </label>
      <input id={ids.name} className="input" value={name} maxLength={MAX_PROMPT_NAME} autoFocus={!prompt} onKeyDown={noSubmit} onChange={(event) => setName(event.target.value)} />
      <label className="field__label" htmlFor={ids.text}>
        Prompt
      </label>
      <textarea id={ids.text} className="input prompts__text" rows={5} value={text} aria-describedby={`${ids.text}-help`} onChange={(event) => setText(event.target.value)} />
      <p id={`${ids.text}-help`} className="field__help">
        Up to {MAX_PROMPT_TEXT_BYTES / 1000} KB. Never put a password, a key or a token in a prompt: Caduceus does not save one that looks like it.
      </p>
      <label className="field__label" htmlFor={ids.tags}>
        Tags
      </label>
      <input id={ids.tags} className="input" value={tags} aria-describedby={`${ids.tags}-help`} aria-invalid={tooManyTags ? true : undefined} onKeyDown={noSubmit} onChange={(event) => setTags(event.target.value)} />
      <p id={`${ids.tags}-help`} className="field__help">
        Separate tags with commas (up to {MAX_PROMPT_TAGS}). They help you find the prompt.
      </p>
      <p id={ids.scope} className="field__label">
        Shown in
      </p>
      <RadioGroup
        labelledBy={ids.scope}
        className="seg cfg-seg"
        value={scope}
        options={[
          { value: 'all', label: 'Every profile' },
          { value: 'profile', label: `Only ${profile}` },
        ]}
        onChange={setScope}
      />
      {problem && (
        <p className="field__error" role="alert">
          {problem}
        </p>
      )}
      <div className="sl-sheet__actions">
        <button type="button" className="btn btn--secondary" onClick={onDone}>
          Cancel
        </button>
        <ChangeButton type="button" className="btn btn--primary" disabled={!ready} onClick={() => void save()}>
          Save prompt
        </ChangeButton>
      </div>
    </div>
  );
}

type View = { kind: 'list' } | { kind: 'edit'; prompt: SavedPrompt | undefined; text: string };

/** The library's contents: search, tags, the prompts, and the editor. */
export function PromptLibrary({ profile, access, onClose }: { profile: string; access: PromptsAccess; onClose(): void }) {
  const all = usePrompts();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string>();
  const [view, setView] = useState<View>({ kind: 'list' });
  const searchId = useId();
  const mine = useMemo(() => forProfile(all ?? [], profile), [all, profile]);
  const tags = useMemo(() => tagsOf(mine), [mine]);
  const shown = useMemo(() => filterPrompts(mine, { query, tag }), [mine, query, tag]);
  // A tag nobody carries any more (its prompt was deleted) is no filter.
  useEffect(() => {
    if (tag !== undefined && !tags.some((entry) => entry.tag === tag)) setTag(undefined);
  }, [tags, tag]);

  const remove = async (prompt: SavedPrompt) => {
    try {
      await deletePrompt(prompt.id);
    } catch (error) {
      toast('The prompt was not deleted', { tone: 'danger', detail: words(error) });
      return;
    }
    const again: SavedPromptInput = { name: prompt.name, text: prompt.text, tags: prompt.tags, profile: prompt.profile };
    toast(`Deleted “${prompt.name}”`, { tone: 'info', undo: () => void savePrompt(again).catch((error) => toast('The prompt could not be brought back', { tone: 'danger', detail: words(error) })) });
  };

  if (view.kind === 'edit') return <PromptEditor profile={profile} prompt={view.prompt} initialText={view.text} onDone={() => setView({ kind: 'list' })} />;
  const { text: typed, selected } = access.current();
  const toSave = selected.trim() === '' ? typed : selected;
  return (
    <div className="prompts">
      <p className="subtle prompts__help">
        Your <Term id="saved-prompt">saved prompts</Term> are kept by Caduceus and shown on every device. Choosing one puts it in the message box at the cursor; it is sent only when you press Send.
      </p>
      <div className="prompts__bar">
        <label className="sr-only" htmlFor={searchId}>
          Search saved prompts
        </label>
        <input id={searchId} type="search" className="input prompts__search" placeholder="Search prompts" value={query} onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()} onChange={(event) => setQuery(event.target.value)} />
        <ChangeButton type="button" className="btn btn--secondary" disabled={toSave.trim() === ''} title={toSave.trim() === '' ? 'Write something in the message box first' : undefined} onClick={() => setView({ kind: 'edit', prompt: undefined, text: toSave })}>
          <Icon name="plus" small />
          Save {selected.trim() === '' ? 'message' : 'selection'}
        </ChangeButton>
      </div>
      {tags.length > 0 && (
        <div className="prompts__tags" role="group" aria-label="Filter by tag">
          {tags.map((entry) => (
            <button key={entry.tag} type="button" className="chip" aria-pressed={tag === entry.tag} onClick={() => setTag((now) => (now === entry.tag ? undefined : entry.tag))}>
              {entry.tag}
              <span className="subtle"> {entry.count}</span>
            </button>
          ))}
        </div>
      )}
      {all === undefined ? (
        <p className="subtle">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="subtle prompts__empty">{mine.length === 0 ? 'No saved prompts yet. Write a message, then choose Save message to keep it.' : 'No prompt matches.'}</p>
      ) : (
        <ul className="prompts__list" aria-label="Saved prompts">
          {shown.map((prompt) => (
            <li key={prompt.id} className="prompt">
              <button type="button" className="prompt__use" onClick={() => (access.insert(prompt.text), onClose())}>
                <span className="prompt__name">
                  <span className="sr-only">Insert </span>
                  {prompt.name}
                </span>
                <span className="prompt__text">{prompt.text.trim().split('\n')[0]}</span>
                {(prompt.tags.length > 0 || prompt.profile !== null) && (
                  <span className="prompt__tags">
                    {prompt.profile !== null && <span className="tag">{prompt.profile}</span>}
                    {prompt.tags.map((entry) => (
                      <span key={entry} className="tag">
                        {entry}
                      </span>
                    ))}
                  </span>
                )}
              </button>
              <ChangeButton type="button" className="btn btn--ghost btn--icon" aria-label={`Edit ${prompt.name}`} onClick={() => setView({ kind: 'edit', prompt, text: prompt.text })}>
                <Icon name="draft" />
              </ChangeButton>
              <ChangeButton type="button" className="btn btn--ghost btn--icon" aria-label={`Delete ${prompt.name}`} onClick={() => void remove(prompt)}>
                <Icon name="trash" />
              </ChangeButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The library where the size of the window says: a bottom sheet on a phone, a popover above the message box elsewhere. */
export function PromptLibraryHost({ profile, access, onClose }: { profile: string; access: PromptsAccess; onClose(): void }) {
  const compact = useSizeClass() === 'compact';
  const root = useRef<HTMLDivElement>(null);
  const closing = useRef(onClose);
  closing.current = onClose;
  useEffect(() => {
    if (compact) return;
    root.current?.querySelector<HTMLElement>('input[type="search"]')?.focus();
    // A press on what opened the popover is that control's own to answer (it closes the popover), so it is not "away" too.
    const away = (event: PointerEvent) => event.target instanceof Element && !root.current?.contains(event.target) && !event.target.closest('[data-prompts-trigger]') && closing.current();
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [compact]);
  if (compact) {
    return (
      <Sheet title="Saved prompts" detents={['half', 'full']} className="cfg-sheet" initialFocus='input[type="search"]' onClose={onClose}>
        <PromptLibrary profile={profile} access={access} onClose={onClose} />
      </Sheet>
    );
  }
  return (
    <div
      ref={root}
      className="prompts__pop"
      role="dialog"
      aria-label="Saved prompts"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="prompts__pop-head">
        <h2 className="prompts__pop-title">Saved prompts</h2>
        <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Close saved prompts" onClick={onClose}>
          <Icon name="x" small />
        </button>
      </div>
      <PromptLibrary profile={profile} access={access} onClose={onClose} />
    </div>
  );
}
