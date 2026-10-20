import { FileEditor } from './FileEditor.tsx';
import type { TabProps } from './ProfileDetail.tsx';

/** The profile's raw config.yaml, through Hermes's raw config route for this profile. */
export function ProfileFiles({ card }: TabProps) {
  return (
    <div className="stack">
      <p className="help-text">The profile’s settings as Hermes keeps them, one YAML file. It is checked as YAML before it is saved; a credential in it is shown hidden and a save keeps its real value. Most settings are easier to change on their own screens (Model, Skills, Tools &amp; MCP).</p>
      <FileEditor card={card} id="config" />
    </div>
  );
}
