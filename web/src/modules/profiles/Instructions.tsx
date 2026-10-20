import { Term } from '../../shell/Term.tsx';
import { FileEditor } from './FileEditor.tsx';
import type { TabProps } from './ProfileDetail.tsx';

/** AGENTS.md and HERMES.md: the standing instructions of a profile, as Hermes holds them. */
export function Instructions({ card }: TabProps) {
  return (
    <div className="stack">
      <p className="help-text">
        Instructions Hermes reads for this profile, besides its <Term id="soul">SOUL</Term>. Each file is Hermes’s own: Caduceus saves it back to the profile’s folder and keeps only a <Term id="snapshot">snapshot</Term> of the text each save replaces. A file that does not exist yet is created by the first save.
      </p>
      <FileEditor card={card} id="agents" />
      <FileEditor card={card} id="hermes" />
    </div>
  );
}
