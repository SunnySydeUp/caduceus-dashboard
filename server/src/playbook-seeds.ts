// The multi-stage playbooks Caduceus ships (M6 #01; work model §2.3): Software Delivery (16 stages, after PatterStage's delivery pipeline), Research →
// summarise and Draft → review. Unlike the task templates (`template-seeds.ts`, written to files once and the owner's from then on) these are kept
// in code: they are read-only, the library lists them next to the owner's files, and the owner changes one by duplicating it. A run is tagged with
// the seed's `<id>@<version>`, so a seed that changes later gets a new version and runs of the old one keep their text.
import type { Playbook, PlaybookEdge, PlaybookInput, PlaybookStage } from '@caduceus/contracts/playbooks';

type StageOptions = Omit<PlaybookStage, 'key' | 'title' | 'brief'> & { goal: string; context?: string; constraints?: string; expected?: string; scope?: string };

function stage(key: string, title: string, { goal, context, constraints, expected, scope, ...settings }: StageOptions): PlaybookStage {
  return { key, title, brief: { goal, ...(context === undefined ? {} : { context }), ...(constraints === undefined ? {} : { constraints }), ...(expected === undefined ? {} : { expected }), ...(scope === undefined ? {} : { scope }) }, ...settings };
}

const next = (from: string, to: string, when: PlaybookEdge['when'] = 'on_done'): PlaybookEdge => ({ from, to, when });

const REQUEST: PlaybookInput = { key: 'request', label: 'What should be delivered?', multiline: true, required: true };
const REPO: PlaybookInput = { key: 'repo', label: 'Repository or folder', required: true };

const SOFTWARE_DELIVERY: Playbook = {
  id: 'software-delivery',
  version: 1,
  name: 'Software delivery',
  description: 'From a request to a released change: understand it, design it, build it test-first, review it three ways, and ship it after your approval.',
  category: 'engineering',
  inputs: [REQUEST, REPO, { key: 'branch', label: 'Branch to work on', default: 'main' }],
  stages: [
    stage('intake', 'Understand: {{request}}', {
      goal: 'Restate this request in your own words, list what is in and out of scope, and say how we will know it is done:\n\n{{request}}',
      context: 'Project: {{repo}}',
      expected: 'A short written understanding with acceptance criteria.',
      scope: 'Read only.',
    }),
    stage('explore', 'Explore the code for: {{request}}', {
      goal: 'Find the parts of the project this request touches, and how they work today.',
      context: 'Project: {{repo}}. Branch: {{branch}}.',
      expected: 'The files and functions involved, the conventions they follow, and the risks you see.',
      scope: 'Read only.',
    }),
    stage('clarify', 'Questions before design: {{request}}', {
      goal: 'Ask the owner what is still unclear. If nothing is, say so.',
      expected: 'The owner’s answers, in the comments of this task.',
      gate: 'clarify',
    }),
    stage('design', 'Design: {{request}}', {
      goal: 'Design the change: what is added or changed, where, and why this way.',
      context: 'Project: {{repo}}',
      constraints: 'Follow the project’s conventions. Prefer the smallest design that meets the acceptance criteria.',
      expected: 'A design note the owner can approve in a few minutes.',
      scope: 'Write the design note only.',
      max_attempts: 3,
    }),
    stage('design_review', 'Approve the design: {{request}}', {
      goal: 'Read the design and approve it, or reject it with a note saying what to change.',
      gate: 'approval',
    }),
    stage('plan', 'Plan the work: {{request}}', {
      goal: 'Break the approved design into small steps, each one testable on its own.',
      expected: 'An ordered list of steps, each with the test that shows it works.',
      scope: 'Write the plan only.',
    }),
    stage('tests', 'Write the failing tests: {{request}}', {
      goal: 'Write the tests for the first steps of the plan, and see them fail for the right reason.',
      context: 'Project: {{repo}}. Branch: {{branch}}.',
      constraints: 'One behaviour per test. No code outside the tests yet.',
      expected: 'The tests, and the output showing each fails as expected.',
      scope: 'Edit tests only.',
    }),
    stage('implement', 'Implement: {{request}}', {
      goal: 'Make the tests pass with the smallest change, one step at a time.',
      context: 'Project: {{repo}}. Branch: {{branch}}.',
      constraints: 'Follow the plan. If a later stage sent this back, its note says what to fix: fix that first.',
      expected: 'The change, with all tests passing.',
      scope: 'Edit the project. Ask before changing a public interface or a dependency.',
      goal_mode: true,
      max_attempts: 5,
    }),
    stage('check', 'Run the checks: {{request}}', {
      goal: 'Run the full test suite, the type check and the linter, and report the results.',
      constraints: 'Do not edit code. End with “VERDICT: FAIL” if anything fails, with the failures listed.',
      expected: 'The commands run and their output.',
      scope: 'Run commands; change nothing.',
    }),
    stage('code_review', 'Review the code: {{request}}', {
      goal: 'Review the change as a careful colleague: correctness, clarity, tests, and fit with the project.',
      constraints: 'End with “VERDICT: FAIL” if something must change, and list what.',
      expected: 'A review with findings by severity.',
      scope: 'Read only.',
    }),
    stage('security', 'Security review: {{request}}', {
      goal: 'Check the change for security problems: input handling, secrets, permissions and new dependencies.',
      constraints: 'End with “VERDICT: FAIL” if you find a problem that must be fixed first.',
      expected: 'Findings, or a clear statement that there are none.',
      scope: 'Read only.',
    }),
    stage('docs', 'Update the docs: {{request}}', {
      goal: 'Update the documentation, the changelog and any help text the change affects.',
      expected: 'The edited docs.',
      scope: 'Edit documentation only.',
    }),
    stage('verify', 'Verify end to end: {{request}}', {
      goal: 'Check the change the way a user would meet it, against the acceptance criteria from the first stage.',
      constraints: 'End with “VERDICT: FAIL” if a criterion is not met.',
      expected: 'Each criterion, with how it was checked and the result.',
      scope: 'Run and observe; change nothing.',
    }),
    stage('release_approval', 'Approve the release: {{request}}', {
      goal: 'Read the summary of the change and its checks, and approve the release, or reject it with a note.',
      gate: 'approval',
    }),
    stage('deploy', 'Release: {{request}}', {
      goal: 'Merge the change and release it the way the project does, then check that it is live.',
      context: 'Project: {{repo}}. Branch: {{branch}}.',
      expected: 'What was released, where, and the check that it works.',
      scope: 'Release only the approved change.',
    }),
    stage('retro', 'Write up: {{request}}', {
      goal: 'Write a short note on what was delivered, what was learned, and what to do next time.',
      expected: 'A summary of one page or less.',
      scope: 'Write the note only.',
    }),
  ],
  edges: [
    next('intake', 'explore'),
    next('explore', 'clarify'),
    next('clarify', 'design'),
    next('design', 'design_review'),
    next('design_review', 'plan', 'on_approve'),
    next('design_review', 'design', 'on_reject'),
    next('plan', 'tests'),
    next('tests', 'implement'),
    next('implement', 'check'),
    next('check', 'code_review'),
    next('check', 'implement', 'on_fail'),
    next('code_review', 'security'),
    next('code_review', 'implement', 'on_fail'),
    next('security', 'docs'),
    next('security', 'implement', 'on_fail'),
    next('docs', 'verify'),
    next('verify', 'release_approval'),
    next('verify', 'implement', 'on_fail'),
    next('release_approval', 'deploy', 'on_approve'),
    next('release_approval', 'implement', 'on_reject'),
    next('deploy', 'retro'),
  ],
};

const RESEARCH_SUMMARISE: Playbook = {
  id: 'research-summarise',
  version: 1,
  name: 'Research → summarise',
  description: 'Plan the questions, research them with sources, then write a short summary for a reader.',
  category: 'research',
  inputs: [
    { key: 'topic', label: 'What do you want to know?', multiline: true, required: true },
    { key: 'audience', label: 'Who is the summary for?' },
  ],
  stages: [
    stage('plan', 'Plan the research: {{topic}}', {
      goal: 'List the questions that must be answered to understand this topic, in order of importance:\n\n{{topic}}',
      expected: 'Three to seven questions, each with where you will look.',
      scope: 'Write the plan only.',
    }),
    stage('research', 'Research: {{topic}}', {
      goal: 'Answer each question of the plan from sources you can link to.',
      constraints: 'Prefer primary sources. Mark what is fact, what is opinion and what you could not confirm.',
      expected: 'For each question: the answer, the evidence and the links.',
      scope: 'Read the web and the project’s notes; change nothing.',
    }),
    stage('summarise', 'Summarise: {{topic}}', {
      goal: 'Write a one-page summary of what the research found.',
      context: 'Readers: {{audience}}',
      constraints: 'Plain words. Every claim keeps its source. Say what is still open.',
      expected: 'A summary of one page, with a list of sources.',
      scope: 'Write the summary only.',
    }),
  ],
  edges: [next('plan', 'research'), next('research', 'summarise')],
};

const DRAFT_REVIEW: Playbook = {
  id: 'draft-review',
  version: 1,
  name: 'Draft → review',
  description: 'Write a draft, wait for your review, and rework it with your note until you approve.',
  category: 'content',
  inputs: [
    { key: 'topic', label: 'What is it about?', multiline: true, required: true },
    { key: 'audience', label: 'Who will read it?' },
  ],
  stages: [
    stage('draft', 'Draft: {{topic}}', {
      goal: 'Write a first draft about:\n\n{{topic}}',
      context: 'Readers: {{audience}}',
      constraints: 'Plain words and short sentences. No claim you cannot support. If a note from the review is below, change the draft to answer it.',
      expected: 'One draft in Markdown, with a title.',
      scope: 'Write the draft only. Do not publish or send it.',
      max_attempts: 3,
    }),
    stage('review', 'Review the draft: {{topic}}', {
      goal: 'Read the draft and approve it, or reject it with a note saying what to change.',
      gate: 'approval',
    }),
    stage('finalise', 'Finalise: {{topic}}', {
      goal: 'Make the approved draft ready to use: fix typos, check the links and format it.',
      expected: 'The final text.',
      scope: 'Do not change the meaning. Do not publish or send it.',
    }),
  ],
  edges: [next('draft', 'review'), next('review', 'finalise', 'on_approve'), next('review', 'draft', 'on_reject')],
};

const DEEP_RESEARCH: Playbook = {
  id: 'deep-research',
  version: 1,
  name: 'Deep Research',
  description: 'Plan the sub-questions, search and read for each with the agent’s own web tools, and write one cited report that is kept in Artifacts.',
  category: 'research',
  inputs: [
    { key: 'question', label: 'What do you want to find out?', multiline: true, required: true },
    { key: 'depth', label: 'Depth: rounds of follow-up reading for each sub-question', default: '2' },
    { key: 'breadth', label: 'Breadth: how many sub-questions to split it into', default: '4' },
  ],
  stages: [
    stage('plan', 'Plan the research: {{question}}', {
      goal: 'Break this question into {{breadth}} sub-questions that together answer it, in order of importance:\n\n{{question}}',
      constraints: 'Exactly {{breadth}} sub-questions, each answerable from public sources. For each, name the search terms you will try first and the kind of source you trust for it.',
      expected: 'A numbered list of {{breadth}} sub-questions, each with its search terms and trusted sources.',
      scope: 'Write the plan only. Do not search yet.',
    }),
    stage('search', 'Search and read: {{question}}', {
      goal: 'Answer each sub-question of the plan by searching the web and reading the pages. Do {{depth}} rounds for each: search, read what you found, then follow the leads that read left open.',
      context: 'Use your own web tools and any research skills you have (for example grounded-citations).',
      constraints: 'Keep a numbered source list as you go: one line each with the address, the page title and what you took from it. Prefer primary sources. Mark what is fact, what is opinion and what you could not confirm.',
      expected: 'For each sub-question: the answer, the evidence, and the numbers of the sources it rests on.',
      scope: 'Read the web; change nothing else.',
    }),
    stage('synthesise', 'Write the report: {{question}}', {
      goal: 'Write one report that answers the question, from the plan and the evidence you found.',
      constraints: 'Markdown with a title, a short summary first, then a section for each sub-question. Cite every claim with a number in square brackets, like [3], and end with a “Sources” list in the same numbers (address and title). Say plainly what is still open.',
      expected: 'The report as a Markdown file with numbered citations.',
      scope: 'Write the report only.',
      deliverable: true,
    }),
  ],
  edges: [next('plan', 'search'), next('search', 'synthesise')],
};

/** The seeded playbooks, in the order the library lists them. */
export const SEED_PLAYBOOKS: readonly Playbook[] = [SOFTWARE_DELIVERY, RESEARCH_SUMMARISE, DRAFT_REVIEW, DEEP_RESEARCH];
