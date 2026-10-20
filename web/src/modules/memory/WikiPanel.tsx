import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Rich } from '../chat/Rich.tsx';
import { Term } from '../../shell/Term.tsx';
import { parentFolder } from '../work/workspace-model.ts';
import { useTextFile, useWikiFolder, useWikiListing } from './memory-data.ts';
import '../chat/chat.css';
import './memory.css';

function Page({ path }: { path: string }) {
  const file = useTextFile(path);
  const name = path.slice(path.lastIndexOf('/') + 1);
  return (
    <article className="mm-page" aria-label={name}>
      {file === undefined && <p role="status">Reading {name}…</p>}
      {file === null && <p className="mm-note">Hermes did not give this page’s text.</p>}
      {file && file.binary && <p className="mm-note">This file is not text.</p>}
      {file && !file.binary && (file.text.trim() === '' ? <p className="subtle">The page is empty.</p> : <Rich text={file.text} anchor={`wiki-${path}`} />)}
      {file?.truncated && <p className="mm-note">Hermes sent only the start of this large page.</p>}
    </article>
  );
}

/** The profile's <Term id="llm-wiki">LLM Wiki</Term>: a folder of Markdown pages read through Hermes's file listing, shown read-only. */
export function WikiPanel({ profile }: { profile: string }) {
  const configured = useWikiFolder(profile);
  const [typed, setTyped] = useState<string>();
  const [page, setPage] = useState<string>();
  const folder = typed ?? configured;
  const listing = useWikiListing(folder);
  const pathId = useId();
  const up = folder === undefined || (configured !== undefined && folder === configured) ? undefined : parentFolder(folder);

  const go = (next: string) => {
    setTyped(next);
    setPage(undefined);
  };

  return (
    <div className="mm-panel">
      <p className="help-text">
        The <Term id="llm-wiki">LLM Wiki</Term> is a folder of linked Markdown pages the agent keeps about what it learns. This is a read-only view of it, read through Hermes. The folder is the profile’s <code>skills.config.wiki.path</code>, or <code>~/wiki</code> when that is not set.
      </p>
      <div className="mm-path">
        <div className="field">
          <label className="field__label" htmlFor={pathId}>
            Wiki folder
          </label>
          <input id={pathId} className="input input--mono" value={folder ?? ''} onChange={(event) => go(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </div>
      </div>
      {listing === undefined && <p role="status">Reading the wiki…</p>}
      {listing && listing.kind !== 'folder' && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="book" />
          </span>
          <p>
            {listing.kind === 'missing'
              ? 'There is no wiki at this folder yet. Ask the agent to start one with the llm-wiki skill (“create a wiki about …”), or type the folder where your wiki is.'
              : listing.kind === 'not-a-folder'
                ? 'This path is a file, not a folder.'
                : `Hermes cannot read this folder (${listing.error}).`}
          </p>
        </div>
      )}
      {listing?.kind === 'folder' && (
        <>
          {listing.folders.length + listing.pages.length === 0 && (
            <div className="empty">
              <span className="empty__icon">
                <Icon name="book" />
              </span>
              <p>This folder has no Markdown pages. A wiki starts with an index.md and a SCHEMA.md; ask the agent to start one with the llm-wiki skill.</p>
            </div>
          )}
          {listing.folders.length + listing.pages.length > 0 && (
            <ul className="mm-tree" aria-label={`Pages in ${folder}`}>
              {up !== undefined && (
                <li>
                  <button type="button" className="mm-row" onClick={() => go(up)}>
                    <span className="mm-row__label">
                      <Icon name="arrow-up" small /> Up to {up}
                    </span>
                  </button>
                </li>
              )}
              {listing.folders.map((entry) => (
                <li key={entry.path}>
                  <button type="button" className="mm-row" onClick={() => go(entry.path)}>
                    <span className="mm-row__label">
                      <Icon name="folder" small /> {entry.name}
                    </span>
                  </button>
                </li>
              ))}
              {listing.pages.map((entry) => (
                <li key={entry.path}>
                  <button type="button" className="mm-row" aria-pressed={page === entry.path} onClick={() => setPage(entry.path)}>
                    <span className="mm-row__label">
                      <Icon name="file" small /> {entry.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {page && <Page key={page} path={page} />}
    </div>
  );
}
