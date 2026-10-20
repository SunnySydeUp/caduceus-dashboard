import { Icon } from '../../icons.tsx';
import { useRemoteWorkspace } from './terminal-data.ts';
import type { RemoteWorkspace } from './terminal-model.ts';

/** The words a remote workspace is labelled with: the backend the agent works on. */
export const remoteTitle = (remote: RemoteWorkspace): string => `Remote workspace: the agent works on ${remote.label}, not on the Mac that runs Hermes.`;

/** A small label for a workspace path that is on another machine (the profile's terminal backend is not local); nothing under the local backend. The glossary term sits in the sentence next to it. */
export function RemoteBadge({ remote, inLabel }: { remote: RemoteWorkspace | undefined; /** The badge sits in something whose own accessible name already says the workspace is remote (a chip): it adds no words of its own. */ inLabel?: boolean }) {
  if (!remote) return null;
  return (
    <span className="tag" data-tone="info" title={inLabel ? undefined : remoteTitle(remote)} aria-hidden={inLabel ? true : undefined}>
      <Icon name="server" small />
      Remote
      {!inLabel && <span className="sr-only"> workspace on {remote.label}</span>}
    </span>
  );
}

/** The badge for the workspace of `profile`'s agent, asked of Hermes. */
export function ProfileRemoteBadge({ profile }: { profile: string | undefined }) {
  return <RemoteBadge remote={useRemoteWorkspace(profile)} />;
}
