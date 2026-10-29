// New task › Start from a template: the category pills and the template cards. Choosing a card asks for its inputs (when it has any) and gives the
// Brief editor the filled fields; nothing reaches Hermes until the owner chooses how the task starts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { isTemplate, type Playbook } from '@caduceus/contracts/playbooks';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Term } from '../../shell/Term.tsx';
import type { BriefFields } from './brief-task.ts';
import { InputsSheet, CategoryPills } from './TemplateParts.tsx';
import { usePlaybookLibrary } from './template-data.ts';
import { groupTemplates, startFields, type Answers } from './template-model.ts';
import './templates.css';

export interface TemplatePickerProps {
  /** The template to open at once, from `?template=`. */
  preselect?: string;
  onStart(fields: BriefFields, template: Playbook): void;
}

export function TemplatePicker({ preselect, onStart }: TemplatePickerProps) {
  const { library, error, reload } = usePlaybookLibrary();
  const [category, setCategory] = useState<string>();
  const [asking, setAsking] = useState<Playbook>();
  // Only one-stage templates start a task from a brief: a playbook with several stages is run from its own page.
  const templates = useMemo(() => library?.templates.filter(isTemplate) ?? [], [library]);
  const groups = useMemo(() => (library ? groupTemplates({ categories: library.categories, templates }) : []), [library, templates]);
  const preselected = useRef(false);

  const choose = (playbook: Playbook) => {
    if (playbook.inputs.length === 0) onStart(startFields(playbook, {}), playbook);
    else setAsking(playbook);
  };

  // A link from the Playbooks library names the template: open it once, when the library has arrived.
  useEffect(() => {
    if (preselected.current || preselect === undefined || library === undefined) return;
    preselected.current = true;
    const playbook = templates.find((template) => template.id === preselect);
    if (playbook) choose(playbook);
    // `choose` only reads `onStart`, which the editor keeps stable for the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, preselect]);

  const shown = category === undefined ? groups.flatMap((group) => group.templates) : (groups.find((group) => group.id === category)?.templates ?? []);
  const total = templates.length;

  return (
    <section className="tp" aria-label="Start from a template">
      <div className="tp__head">
        <AppLink className="btn btn--ghost btn--sm" to="/work/playbooks">
          Manage templates
        </AppLink>
      </div>
      <p className="subtle tp__intro">
        A <Term id="template">template</Term> fills in the brief for you. Nothing is sent to Hermes until you choose how the task starts.
      </p>
      {error && (
        <div className="banner" data-tone="warning" role="status">
          <Icon name="alert" />
          <span className="banner__content">The templates could not be read: {error}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={reload}>
            Try again
          </button>
        </div>
      )}
      {!error && library === undefined && <p role="status">Loading the templates…</p>}
      {library && total === 0 && (
        <p className="subtle">
          There are no templates yet. Write a task and use Save as template on it, or make one under <AppLink to="/work/playbooks">Playbooks</AppLink>.
        </p>
      )}
      {library && total > 0 && (
        <>
          <CategoryPills groups={groups} selected={category} onSelect={setCategory} total={total} />
          <ul className="tp__grid">
            {shown.map((template) => (
              <li key={template.id}>
                <button type="button" className="tp__card" onClick={() => choose(template)}>
                  <span className="tp__name">{template.name}</span>
                  {template.description && <span className="tp__desc">{template.description}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {asking && (
        <InputsSheet
          playbook={asking}
          confirm="Fill in the brief"
          onClose={() => setAsking(undefined)}
          onAnswers={(answers: Answers) => {
            const playbook = asking;
            setAsking(undefined);
            onStart(startFields(playbook, answers), playbook);
          }}
        />
      )}
    </section>
  );
}
