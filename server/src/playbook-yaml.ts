// A playbook definition as the owner writes it: YAML text in, the definition or line-level problems out (M6 #01). Pure. `readPlaybook` says what is
// wrong and where in the definition (`stages[2].brief.goal`); this finds that place in the text, so the YAML view can mark the line. A place that
// is not in the text (a missing key) is reported at the nearest thing around it that is.
import { isNode, LineCounter, parseDocument } from 'yaml';
import { readPlaybook, type Playbook, type PlaybookPath } from '@caduceus/contracts/playbooks';

export interface LocatedProblem {
  /** 1-based; missing when the text is empty. */
  line?: number;
  message: string;
}

/** The definition, with where in the text a place of it is (for warnings), or the problems. */
export type YamlReading = { playbook: Playbook; lineOf(path: PlaybookPath): number | undefined; errors?: undefined } | { playbook?: undefined; errors: LocatedProblem[] };

/** The first sentence of the YAML library's message, which goes on to quote the text and draw a caret. */
const firstLine = (message: string): string => message.split('\n')[0].trim();

export function readPlaybookYaml(source: string): YamlReading {
  const lines = new LineCounter();
  const document = parseDocument(source, { lineCounter: lines, prettyErrors: false });
  if (document.errors.length > 0) {
    return { errors: document.errors.map((error) => ({ line: lines.linePos(error.pos[0]).line, message: firstLine(error.message) })) };
  }
  const lineOf = (path: PlaybookPath): number | undefined => {
    for (let length = path.length; length >= 0; length -= 1) {
      const node = document.getIn(path.slice(0, length), true);
      if (isNode(node) && node.range) return lines.linePos(node.range[0]).line;
    }
    return undefined;
  };
  const reading = readPlaybook(document.toJS());
  if (reading.playbook !== undefined) return { playbook: reading.playbook, lineOf };
  return { errors: reading.problems.map((message, index) => ({ line: lineOf(reading.where[index]), message })) };
}

/** What Hermes has, as far as a definition's references go: its profiles, and the skills each one has. */
export interface KnownReferences {
  profiles: ReadonlySet<string>;
  /** The skills of a profile; a profile Hermes could not be asked about is not in the map, and its skills are not judged. */
  skills: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface ReferenceWarning {
  /** The stage that names it. */
  stage: string;
  path: PlaybookPath;
  message: string;
}

/** Profiles and skills a definition names that Hermes does not have. A warning, not an error: Hermes is the source of truth and may gain them later. */
export function referenceWarnings(playbook: Playbook, known: KnownReferences): ReferenceWarning[] {
  const warnings: ReferenceWarning[] = [];
  playbook.stages.forEach((stage, index) => {
    const profile = stage.assignee;
    if (profile !== undefined && !known.profiles.has(profile)) {
      warnings.push({ stage: stage.key, path: ['stages', index, 'assignee'], message: `stages[${index}].assignee: Hermes has no profile called “${profile}”.` });
    }
    const available = known.skills.get(profile ?? 'default');
    if (available === undefined) return;
    (stage.skills ?? []).forEach((skill, at) => {
      if (!available.has(skill)) warnings.push({ stage: stage.key, path: ['stages', index, 'skills', at], message: `stages[${index}].skills[${at}]: the profile “${profile ?? 'default'}” has no skill called “${skill}”.` });
    });
  });
  return warnings;
}
