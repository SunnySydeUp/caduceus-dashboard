import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { useAppNavigate } from '../../shell/navigation.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Term } from '../../shell/Term.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { requestLearn } from '../chat/learn-handoff.ts';
import { SkillsFrame } from './SkillsFrame.tsx';
import './skills.css';

const EXAMPLES = ['The release process in docs/release.md: focus on rollback, skip the history', 'https://example.com/guide: the auth flow only', 'What we just did in this project, as steps I can repeat'];

function LearnForm({ profile }: { profile: string }) {
  const navigate = useAppNavigate();
  const [topic, setTopic] = useState('');
  const empty = topic.trim() === '';
  const start = () => {
    if (empty) return;
    // The topic goes to the chat in memory, not in the address; the chat asks for the passkey when it runs /learn.
    requestLearn(profile, topic.trim());
    void navigate('/chat/new');
  };
  return (
    <form
      className="sk-learn"
      onSubmit={(event) => {
        event.preventDefault();
        start();
      }}
    >
      <div className="field">
        <label className="field__label" htmlFor="sk-learn-topic">
          What should {profile} learn?
        </label>
        <textarea id="sk-learn-topic" className="input sk-area sk-learn__topic" rows={5} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Folders, files, links, pasted notes, and what to focus on" />
        <p className="subtle sk-note">Anything goes in one box: where to read from, and what you want from it. Hermes treats every part as a requirement.</p>
      </div>
      <p className="subtle sk-note">For example:</p>
      <ul className="sk-examples">
        {EXAMPLES.map((example) => (
          <li key={example}>
            <button type="button" className="btn btn--secondary btn--sm sk-example" onClick={() => setTopic(example)}>
              {example}
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <WriteButton type="submit" className="btn btn--primary" disabled={empty}>
          <Icon name="chat" />
          Start learning in a new chat
        </WriteButton>
      </div>
      <p className="subtle sk-note">
        This opens a new chat in {profile} and runs Hermes’s /learn command there, so you watch the agent read, write and save the skill. /learn needs your passkey, because the agent then reads files and links on its own.
      </p>
    </form>
  );
}

/** Agents › Skills › Learn a skill. */
export function Learn() {
  const { effective } = useProfileScope();
  return (
    <SkillsFrame title="Learn a skill">
      <p className="help-text">
        <Term id="learn-a-skill">Learn a skill</Term> asks the agent to study something you name and write what it learns as a new skill. The work happens in Chat.
      </p>
      {effective ? <LearnForm key={effective.name} profile={effective.name} /> : <p role="status">Loading…</p>}
    </SkillsFrame>
  );
}
