import { useSyncExternalStore } from 'react';
import { diffFiles, splitRows } from './git-model.ts';

/** Where the diff turns from unified to split (mobile spec): 1024 px and wider. */
export const SPLIT_MIN_WIDTH = 1024;

const subscribe = (notify: () => void) => {
  window.addEventListener('resize', notify);
  return () => window.removeEventListener('resize', notify);
};

/** Whether the window is wide enough for the split diff; it re-renders only when that changes. */
export function useSplitDiff(): boolean {
  return useSyncExternalStore(subscribe, () => window.innerWidth >= SPLIT_MIN_WIDTH);
}

const MARK = { add: '+', delete: '−', context: ' ', hunk: '' } as const;

/** One file's diff: unified on a narrow window and split on a wide one. Text is always text, never markup. */
export function DiffView({ diff, split }: { diff: string; split: boolean }) {
  const files = diffFiles(diff);
  if (files.length === 0) return <p className="subtle">There is no diff for this file.</p>;
  return (
    <div className="gt-diff" data-mode={split ? 'split' : 'unified'}>
      {files.map((file) => (
        <div key={file.name} className="gt-diff__file">
          {files.length > 1 && <h4 className="gt-diff__name">{file.name}</h4>}
          {file.binary ? (
            <p className="subtle">This is a binary file, so there is no text to compare.</p>
          ) : split ? (
            <div className="gt-scroll" tabIndex={0} role="region" aria-label={`Split diff of ${file.name}`}>
              <table className="gt-split">
                <tbody>
                  {splitRows(file.rows).map((row, index) =>
                    row.kind === 'hunk' ? (
                      <tr key={index} className="gt-row" data-kind="hunk">
                        <td colSpan={4}>{row.text}</td>
                      </tr>
                    ) : (
                      <tr key={index} className="gt-row">
                        <td className="gt-no" data-kind={row.left?.changed ? 'delete' : undefined}>{row.left?.no}</td>
                        <td className="gt-text" data-kind={row.left?.changed ? 'delete' : undefined}>{row.left?.text}</td>
                        <td className="gt-no" data-kind={row.right?.changed ? 'add' : undefined}>{row.right?.no}</td>
                        <td className="gt-text" data-kind={row.right?.changed ? 'add' : undefined}>{row.right?.text}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="gt-scroll" tabIndex={0} role="region" aria-label={`Diff of ${file.name}`}>
              <table className="gt-unified">
                <tbody>
                  {file.rows.map((row, index) => (
                    <tr key={index} className="gt-row" data-kind={row.kind}>
                      {row.kind === 'hunk' ? (
                        <td colSpan={3}>{row.text}</td>
                      ) : (
                        <>
                          <td className="gt-no">{row.oldNo}</td>
                          <td className="gt-no">{row.newNo}</td>
                          <td className="gt-text">
                            <span aria-hidden="true">{MARK[row.kind]} </span>
                            <span className="sr-only">{row.kind === 'add' ? 'Added: ' : row.kind === 'delete' ? 'Removed: ' : ''}</span>
                            {row.text}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
