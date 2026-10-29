import { useLocation } from '@tanstack/react-router';
import { Icon } from '../icons.tsx';
import { AppLink } from './navigation.tsx';
import { PageHeader } from './PageHeader.tsx';

/** What the router shows inside the shell when no registered route matches the address. */
export function NotFound() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <div className="module-page">
      <PageHeader title="Page not found" subtitle="This address does not lead anywhere in Caduceus. It may have moved, or the link may be mistyped." />
      <div className="panel panel--pad">
        <dl className="kv">
          <dt>address</dt>
          <dd className="mono">{pathname}</dd>
        </dl>
      </div>
      <div className="toolbar">
        <AppLink className="btn btn--primary" to="/today">
          <Icon name="home" />
          Go to Today
        </AppLink>
        <AppLink className="btn btn--secondary" to="/control">
          Open Control
        </AppLink>
      </div>
    </div>
  );
}
