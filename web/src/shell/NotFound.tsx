import { useLocation } from '@tanstack/react-router';
import { Icon } from '../icons.tsx';
import { AppLink } from './navigation.tsx';
import { PageHeader } from './PageHeader.tsx';

/** What the router shows inside the shell when no registered route matches the address. */
export function NotFound() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <div className="module-page">
      <PageHeader title="Page not found" subtitle="No Caduceus route matches this address." />
      <div className="panel panel--pad">
        <dl className="kv">
          <dt>path</dt>
          <dd className="mono">{pathname}</dd>
        </dl>
      </div>
      <div className="toolbar">
        <AppLink className="btn btn--primary" to="/">
          <Icon name="home" />
          Go home
        </AppLink>
        <AppLink className="btn btn--secondary" to="/control">
          Control
        </AppLink>
      </div>
    </div>
  );
}
