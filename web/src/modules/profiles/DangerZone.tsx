import { Icon } from '../../icons.tsx';
import { Term } from '../../shell/Term.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { ExportProfile, ImportProfile } from './ProfileTransfer.tsx';
import { useProfileCommands } from './ProfileCommands.tsx';
import { deleteRefusal } from './profiles-model.ts';
import type { TabProps } from './ProfileDetail.tsx';

/** Rename, export, import and delete. Delete says plainly that it cannot be undone, and says why when it is refused. */
export function DangerZone({ card, view }: TabProps) {
  const commands = useProfileCommands();
  const refusal = deleteRefusal(card, view.cards ?? []);
  return (
    <div className="pf-danger pf-form">
      <section className="panel panel--pad pf-danger__row" aria-labelledby="pf-rename-title">
        <h3 id="pf-rename-title">Rename</h3>
        <p>{card.isRoot ? 'The root profile keeps its id (default). Renaming it sets a display name that Hermes stores beside it.' : 'Hermes renames the profile’s folder and everything that points at it. You can undo it for a few seconds.'}</p>
        <div className="row">
          <WriteButton type="button" className="btn btn--secondary" onClick={() => commands.openRename(card)}>
            <Icon name="type" />
            {card.isRoot ? 'Set display name…' : 'Rename…'}
          </WriteButton>
        </div>
      </section>
      <section className="panel panel--pad pf-danger__row" aria-labelledby="pf-export-title">
        <h3 id="pf-export-title">Export and import</h3>
        <p>
          Export packs this profile’s settings, SOUL, memory and skills into an archive that your browser downloads; Hermes leaves its credential files out. Import makes a new <Term id="profile-export">profile from an archive</Term>. Both ask for your passkey and the name you type, and neither works in read-only mode.
        </p>
        <div className="row">
          <ExportProfile card={card} />
          <ImportProfile cards={view.cards ?? []} reload={view.reload} />
        </div>
      </section>
      <section className="panel panel--pad pf-danger__row" aria-labelledby="pf-delete-title">
        <h3 id="pf-delete-title">Delete profile</h3>
        <p>Deletes the profile’s settings, memory, skills, sessions and keys, and stops its gateway. You will type its name to confirm. This cannot be undone from Caduceus; only a Hermes backup can bring it back.</p>
        {refusal && <p className="pf-danger__why">{refusal}</p>}
        <div className="row">
          <WriteButton type="button" className="btn btn--danger" disabled={refusal !== undefined} onClick={() => void commands.remove(card)}>
            <Icon name="trash" />
            Delete {card.name}…
          </WriteButton>
        </div>
      </section>
    </div>
  );
}
