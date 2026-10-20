// The form that starts a playbook run (M6 #02): one question for each input of the playbook, in a full-screen sheet, and a summary of what will
// run. Pressing Run asks the owner to confirm (Tier 1: the dialog names the playbook and the profiles); declining sends nothing. A run that
// started opens its page; answers the server refused are listed in the sheet.
import { useId, useState } from 'react';
import type { Playbook } from '@caduceus/contracts/playbooks';
import { useAppNavigate } from '../../shell/navigation.tsx';
import { toast } from '../../shell/toasts.ts';
import { useProfiles } from './brief-data.ts';
import { startRun } from './playbook-run-data.ts';
import { runPath, stageProfiles } from './playbook-model.ts';
import { InputsSheet } from './TemplateParts.tsx';

export function RunSheet({ playbook, onClose }: { playbook: Playbook; onClose(): void }) {
  const navigate = useAppNavigate();
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const stages = playbook.stages.length === 1 ? '1 stage' : `${playbook.stages.length} stages`;
  const [runAs, setRunAs] = useState('');
  const profiles = stageProfiles(playbook, runAs === '' ? undefined : runAs);
  const choice = useId();
  const known = useProfiles().value?.names ?? [];
  // Hermes's dispatcher leaves a task with nobody assigned for the owner, so a stage that names no profile needs one chosen here to run by itself.
  const unnamed = playbook.stages.some((stage) => stage.assignee === undefined);

  const start = async (answers: Record<string, string>) => {
    setBusy(true);
    setProblems([]);
    try {
      const outcome = await startRun(playbook, answers, runAs === '' ? undefined : runAs);
      if (outcome.kind === 'cancelled') return;
      if (outcome.kind === 'problems') return setProblems(outcome.problems);
      toast('Started', { tone: 'success' });
      onClose();
      void navigate(runPath(playbook.id, outcome.root, outcome.board));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Caduceus did not start the run.', { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <InputsSheet
      playbook={playbook}
      confirm="Run"
      detents={['full']}
      busy={busy}
      problems={problems}
      help="Pressing Run asks you to confirm. The first stage becomes a Kanban task at once; each next stage is made when the one before it ends."
      summary={
        <div className="pb__runs-plan">
          <p>
            <strong>{stages}</strong> of version {playbook.version} will run.
          </p>
          <p className="subtle">Profiles that will get tasks: {profiles.join(', ')}.</p>
          {unnamed && known.length > 0 && (
            <div className="field">
              <label className="field__label" htmlFor={choice}>
                Run the stages that name no profile as
              </label>
              <select id={choice} className="input" value={runAs} onChange={(event) => setRunAs(event.target.value)}>
                <option value="">Nobody: leave those tasks unassigned</option>
                {known.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <p className="field__help">A task nobody is assigned to waits on the Board until you give it to a profile.</p>
            </div>
          )}
        </div>
      }
      onAnswers={(answers) => void start(answers)}
      onClose={onClose}
    />
  );
}
