// The one way into the Brief editor from the board and the task list: the primary "New task" action.
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';

/** Opens the Brief editor for a new task on `board` (the current board when none is named). */
export function NewTaskLink({ board }: { board?: string }) {
  return (
    <AppLink className="btn btn--primary" to={`/work/tasks/new${board ? `?board=${encodeURIComponent(board)}` : ''}`}>
      <Icon name="plus" />
      New task
    </AppLink>
  );
}
