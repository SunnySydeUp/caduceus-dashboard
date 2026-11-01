/** What was said before a failure was made plain (a status code, the browser's own words), behind a disclosure: the owner never has to read it, and can copy it. */
export function FailureDetails({ detail }: { detail: string | undefined }) {
  if (detail === undefined) return null;
  return (
    <details className="fail-details">
      <summary>Details</summary>
      <code>{detail}</code>
    </details>
  );
}
