import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Term } from '../../shell/Term.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { Rich } from '../chat/Rich.tsx';
import { provenanceWords, useSkillCommands } from './SkillCommands.tsx';
import { splitSkill } from './skill-document.ts';
import { wrapProse } from './prose.ts';
import { fetchFileText, fetchLinkedFiles, fetchSkillContent } from './skills-data.ts';
import { useLoaded } from './use-loaded.ts';
import { removalOf, type FileText, type LinkedFile, type SkillRow } from './skills-model.ts';
import '../chat/chat.css';
import './skills.css';

const sizeWords = (bytes: number) => (bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`);

/** A linked file, opened read-only: its text, or why there is none. Nothing here writes. */
function FileView({ file, onBack }: { file: LinkedFile; onBack(): void }) {
  const { loaded, retry } = useLoaded<FileText>(() => fetchFileText(file.path), file.path);
  return (
    <section className="sk-file" aria-label={`File ${file.name}`}>
      <div className="sk-file__bar">
        <button type="button" className="btn btn--secondary btn--sm" onClick={onBack}>
          <Icon name="chev-l" small />
          SKILL.md
        </button>
        <span className="mono sk-file__name">{file.name}</span>
      </div>
      {loaded.state === 'loading' && <p role="status">Loading…</p>}
      {loaded.state === 'failed' && (
        <p role="alert" className="sk-error">
          Hermes did not send this file.{' '}
          <button type="button" className="btn btn--secondary btn--sm" onClick={retry}>
            Retry
          </button>
        </p>
      )}
      {loaded.state === 'ready' && loaded.value.binary && <p className="muted">Hermes cannot show this file as text ({sizeWords(loaded.value.size)}).</p>}
      {loaded.state === 'ready' && !loaded.value.binary && (
        <>
          {loaded.value.truncated && <p className="muted sk-note">Hermes sent only the first part of this file ({sizeWords(loaded.value.size)} in all).</p>}
          {file.name.endsWith('.md') ? <Rich text={loaded.value.text} anchor={`skill-file-${file.name}`} /> : <pre className="sk-pre" tabIndex={0}>{loaded.value.text}</pre>}
        </>
      )}
      <p className="subtle sk-note">Read-only. Change linked files from Hermes’s command line or let the agent write them; Caduceus edits SKILL.md only.</p>
    </section>
  );
}

/** A SKILL.md as it reads: its frontmatter kept apart, folded away, and its Markdown drawn. The detail and the editor's Preview both show it. */
export function SkillDocument({ text, name }: { text: string; name: string }) {
  const parts = splitSkill(text);
  return (
    <>
      {parts && (
        <details className="sk-front">
          <summary>
            <Icon name="chev-r" className="chev" small />
            Frontmatter
          </summary>
          <p className="subtle sk-note">
            The YAML at the top of SKILL.md. What is <Term id="frontmatter">frontmatter</Term>?
          </p>
          <pre className="sk-pre" tabIndex={0}>
            {parts.frontmatter}
          </pre>
        </details>
      )}
      <Rich text={wrapProse(parts ? parts.body : text)} anchor={`skill-${name}`} />
    </>
  );
}

/** A skill's detail: its description, Hermes's usage count, the rendered SKILL.md and the files linked from it, read-only. The actions are Hermes's, through the same commands as the row's ⋮ menu. */
export function SkillDetail({ skill, name, onClose }: { skill: SkillRow | undefined; name: string; onClose(): void }) {
  const commands = useSkillCommands();
  const { profile } = commands;
  const content = useLoaded(async () => (await fetchSkillContent(profile, name)) ?? 'missing', `${profile}/${name}`);
  const folder = content.loaded.state === 'ready' && content.loaded.value !== 'missing' ? content.loaded.value.folder : undefined;
  const files = useLoaded(async () => (folder ? fetchLinkedFiles(folder) : []), folder ?? '');
  const [opened, setOpened] = useState<LinkedFile>();
  const removal = skill ? removalOf(skill) : 'none';
  const busy = commands.busy.has(name);

  return (
    <Sheet
      title={name}
      detents={['half', 'full']}
      className="sk-sheet"
      onClose={onClose}
      footer={
        skill && (
          <>
            <WriteButton type="button" className="btn btn--secondary" disabled={busy} onClick={() => void commands.toggle(skill)}>
              <Icon name="sliders" />
              {skill.enabled ? 'Switch off' : 'Switch on'}
            </WriteButton>
            <WriteButton type="button" className="btn btn--secondary" onClick={() => commands.edit(skill)}>
              <Icon name="type" />
              Edit SKILL.md
            </WriteButton>
            {removal !== 'none' && (
              <WriteButton type="button" className="btn btn--danger-quiet" disabled={busy} onClick={() => void commands.remove(skill)}>
                <Icon name="trash" />
                {removal === 'uninstall' ? 'Uninstall…' : 'Delete…'}
              </WriteButton>
            )}
          </>
        )
      }
    >
      {skill && (
        <div className="sk-facts">
          <p>{skill.description || <span className="subtle">This skill has no description.</span>}</p>
          <ul className="sk-tags" aria-label="About this skill">
            <li className="tag" data-tone={skill.enabled ? 'success' : 'neutral'}>
              {skill.enabled ? 'On' : 'Off'} for {profile}
            </li>
            <li className="tag">{provenanceWords(skill)}</li>
            {skill.category && <li className="tag">{skill.category}</li>}
          </ul>
          <p className="sk-usage">
            Usage count from Hermes: <strong className="mono">{skill.usage}</strong>
            <span className="subtle"> · Hermes counts only this; Caduceus shows no other usage numbers.</span>
          </p>
        </div>
      )}
      {opened ? (
        <FileView file={opened} onBack={() => setOpened(undefined)} />
      ) : (
        <>
          {content.loaded.state === 'loading' && <p role="status">Loading SKILL.md…</p>}
          {content.loaded.state === 'failed' && (
            <p role="alert" className="sk-error">
              Hermes did not answer, so SKILL.md could not be read.{' '}
              <button type="button" className="btn btn--secondary btn--sm" onClick={content.retry}>
                Retry
              </button>
            </p>
          )}
          {content.loaded.state === 'ready' && content.loaded.value === 'missing' && <p className="muted">Hermes has no skill called “{name}” in {profile}. It may have been deleted or renamed.</p>}
          {content.loaded.state === 'ready' && content.loaded.value !== 'missing' && <SkillDocument text={content.loaded.value.content} name={name} />}
          {folder && (
            <section aria-labelledby="sk-files-title" className="sk-files">
              <h3 id="sk-files-title">Linked files</h3>
              {files.loaded.state === 'loading' && <p role="status">Looking for linked files…</p>}
              {files.loaded.state === 'failed' && <p className="muted">Hermes did not list this skill’s folder.</p>}
              {files.loaded.state === 'ready' && files.loaded.value.length === 0 && <p className="muted">No files are linked from this skill: it is its SKILL.md alone.</p>}
              {files.loaded.state === 'ready' && files.loaded.value.length > 0 && (
                <ul className="list sk-filelist">
                  {files.loaded.value.map((file) => (
                    <li key={file.path}>
                      <button type="button" className="list-row sk-filerow" onClick={() => setOpened(file)}>
                        <Icon name="file" />
                        <span className="mono sk-filerow__name">{file.name}</span>
                        <Icon name="chev-r" small />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </Sheet>
  );
}
