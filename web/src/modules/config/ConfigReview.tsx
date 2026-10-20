import { Icon } from '../../icons.tsx';
import type { ChangeRow, YamlProblem } from './config-yaml.ts';

const KIND_WORDS: Record<ChangeRow['kind'], string> = { added: 'Added', removed: 'Removed', changed: 'Changed' };

/** What a text would change in the profile: each key with what it is now and what it becomes. A credential is never a value here. */
export function ChangeReview({ rows }: { rows: readonly ChangeRow[] }) {
  if (rows.length === 0) return <p>Nothing would change.</p>;
  return (
    <ul className="cf-review">
      {rows.map((row) => (
        <li key={row.key} className="cf-review__row">
          <div className="cf-review__name">
            <strong>{row.label}</strong>
            {row.label !== row.key && <code>{row.key}</code>}
            <span className="tag" data-tone={row.kind === 'removed' ? 'warning' : 'neutral'}>
              {KIND_WORDS[row.kind]}
            </span>
            {row.restartRequired && (
              <span className="tag" data-tone="warning">
                <Icon name="refresh" small />
                Restart
              </span>
            )}
          </div>
          <div className="cf-review__change">
            <span className="cf-review__old">
              <span className="sr-only">Was </span>
              {row.before}
            </span>
            <Icon name="arrow-r" small />
            <span className="cf-review__new">
              <span className="sr-only">Becomes </span>
              {row.after}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** What is wrong with a text, each problem with its line. `onGo` makes a problem a button that takes the editor to its line. */
export function ProblemList({ problems, onGo }: { problems: readonly YamlProblem[]; onGo?: (problem: YamlProblem) => void }) {
  return (
    <ul className="cf-problems" aria-label="Problems">
      {problems.map((problem) => (
        <li key={`${problem.line}:${problem.column}:${problem.message}`} className="cf-problems__row">
          <Icon name="alert" small />
          {onGo ? (
            <button type="button" className="cf-problems__go" onClick={() => onGo(problem)}>
              <strong>Line {problem.line}</strong>
              <span>{problem.message}</span>
            </button>
          ) : (
            <span className="cf-problems__go">
              <strong>Line {problem.line}</strong>
              <span>{problem.message}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
