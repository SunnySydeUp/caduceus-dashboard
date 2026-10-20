// The twelve task templates Caduceus ships (M3 #08), ported from PatterStage's mission templates, and the eight categories they sit in. They
// are written to `caduceus/playbooks/*.yaml` once, on first run (`playbooks.ts`), and are the owner's files from then on: edited, duplicated
// or deleted like any other, and never written back.
import type { Playbook, PlaybookInput, PlaybookStage, TemplateCategory } from '@caduceus/contracts/playbooks';

export const SEED_CATEGORIES: readonly TemplateCategory[] = [
  { id: 'general', name: 'General' },
  { id: 'engineering', name: 'Engineering' },
  { id: 'operations', name: 'Operations' },
  { id: 'data', name: 'Data' },
  { id: 'research', name: 'Research' },
  { id: 'content', name: 'Content' },
  { id: 'support', name: 'Support' },
  { id: 'maintenance', name: 'Maintenance' },
];

function seed(id: string, name: string, category: string, description: string, inputs: PlaybookInput[], stage: Omit<PlaybookStage, 'key'>): Playbook {
  return { id, version: 1, name, description, category, inputs, stages: [{ key: 'main', ...stage }], edges: [] };
}

const REPO: PlaybookInput = { key: 'repo', label: 'Repository or folder' };

export const SEED_TEMPLATES: readonly Playbook[] = [
  seed('general-task', 'General task', 'general', 'A plain task: say what you want done and what you expect back.', [{ key: 'goal', label: 'What should be done?', multiline: true, required: true }], {
    title: '{{goal}}',
    brief: {
      goal: '{{goal}}',
      expected: 'A short summary of what was done and where to find the result.',
      scope: 'Ask before deleting anything or changing something outside what the goal names.',
    },
  }),
  seed('bug-hunt', 'Bug hunt', 'engineering', 'Reproduce, isolate, fix and verify a defect.', [
    { key: 'bug', label: 'What is broken?', multiline: true, required: true },
    { key: 'where', label: 'Where does it happen? (file, page, command)' },
  ], {
    title: 'Fix: {{bug}}',
    brief: {
      goal: 'Find the cause of this bug and fix it:\n\n{{bug}}',
      context: 'Where it shows up: {{where}}',
      constraints: 'Reproduce it first, with a test that fails. Change as little as the fix needs. Do not fix unrelated problems; list them instead.',
      expected: 'The fix with its test, and a note of the cause, how it was found and how it was checked.',
      scope: 'Edit code and tests in the project only. Ask before changing a public interface or a dependency.',
    },
  }),
  seed('feature-build', 'Feature build', 'engineering', 'Build a feature in small steps, with tests, from a short description.', [
    { key: 'feature', label: 'What should it do?', multiline: true, required: true },
    { key: 'done', label: 'How will you know it works?', multiline: true },
  ], {
    title: 'Build: {{feature}}',
    brief: {
      goal: 'Build this feature:\n\n{{feature}}',
      context: 'It is done when: {{done}}',
      constraints: 'Follow the conventions already in the project. Write the tests first, one behaviour at a time. No new dependency without a reason given in the summary.',
      expected: 'The feature, its tests passing, and a summary of the changes and anything left out.',
      scope: 'Edit the project only. Ask before changing a public interface, a data format or the build.',
    },
  }),
  seed('code-review', 'Code review', 'engineering', 'Review a pull request or a change against the project’s own rules.', [
    { key: 'change', label: 'Pull request URL, branch or commit range', required: true },
    { key: 'focus', label: 'What to look at closely', multiline: true },
  ], {
    title: 'Review: {{change}}',
    brief: {
      goal: 'Review this change: {{change}}',
      context: 'Look closely at: {{focus}}',
      constraints: 'Read the change; do not edit it. Check it against the rules in the project’s own documentation.',
      expected: 'A list of findings, worst first: what is wrong, where, and what would fix it. Say plainly when there is nothing to fix.',
      scope: 'Read only. Comments may be posted on the pull request when asked to.',
    },
  }),
  seed('deploy-and-verify', 'Deploy & verify', 'operations', 'Deploy a release and check that it works.', [
    { key: 'release', label: 'What is being deployed?', required: true },
    { key: 'target', label: 'Where to? (environment or host)', required: true },
    { key: 'check', label: 'How to check it works', multiline: true },
  ], {
    title: 'Deploy {{release}} to {{target}}',
    brief: {
      goal: 'Deploy {{release}} to {{target}} and confirm that it works.',
      context: 'How to check it works: {{check}}',
      constraints: 'Follow the project’s deploy steps. Stop at the first failure and say what failed; do not retry blindly or work around it.',
      expected: 'What was deployed, the output of each check, and how to roll back.',
      scope: 'Only the named target. Ask before touching anything else, and before any step that cannot be undone.',
    },
    max_runtime: '2h',
  }),
  seed('infrastructure-audit', 'Infrastructure audit', 'operations', 'Look over servers, services and settings and report what is out of line.', [
    { key: 'area', label: 'What to audit', required: true },
    { key: 'standard', label: 'What good looks like', multiline: true },
  ], {
    title: 'Audit: {{area}}',
    brief: {
      goal: 'Audit {{area}} and report what is out of line.',
      context: 'What good looks like: {{standard}}',
      constraints: 'Read and report only. Do not change any setting, restart any service or install anything.',
      expected: 'A report with the findings by severity: what, where, why it matters and the fix.',
      scope: 'Read-only commands only.',
    },
    max_runtime: '1h',
  }),
  seed('data-analysis', 'Data analysis', 'data', 'Answer a question from a dataset and show the working.', [
    { key: 'question', label: 'What do you want to know?', multiline: true, required: true },
    { key: 'data', label: 'Where is the data?', required: true },
  ], {
    title: 'Analyse: {{question}}',
    brief: {
      goal: 'Answer this question from the data:\n\n{{question}}',
      context: 'The data is at: {{data}}',
      constraints: 'Say how the data was cleaned and what was left out. Show the numbers behind every claim. Do not change the source data.',
      expected: 'The answer first, then the method, the key figures and the caveats. Charts as files when they help.',
      scope: 'Read the data; write results into the task’s own workspace only.',
    },
  }),
  seed('research-brief', 'Research brief', 'research', 'Find out about a topic and write a short, sourced brief.', [
    { key: 'topic', label: 'Topic or question', multiline: true, required: true },
    { key: 'audience', label: 'Who is it for?' },
  ], {
    title: 'Research: {{topic}}',
    brief: {
      goal: 'Research this and write a brief:\n\n{{topic}}',
      context: 'It is for: {{audience}}',
      constraints: 'Use sources you can link to. Mark what is fact, what is opinion and what you could not confirm. Prefer primary sources.',
      expected: 'A one-page brief: the answer, the evidence, the open questions, and a list of sources with links.',
      scope: 'Read the web and the project’s notes; change nothing.',
    },
  }),
  seed('content-draft', 'Content draft', 'content', 'Write a first draft of an article, post or message.', [
    { key: 'subject', label: 'What is it about?', multiline: true, required: true },
    { key: 'audience', label: 'Who will read it?' },
    { key: 'length', label: 'How long?' },
  ], {
    title: 'Draft: {{subject}}',
    brief: {
      goal: 'Write a first draft about:\n\n{{subject}}',
      context: 'Readers: {{audience}}\nLength: {{length}}',
      constraints: 'Plain words and short sentences. No claim you cannot support. Match the voice of the examples in References, if there are any.',
      expected: 'One draft in Markdown, with a title, and a list of the facts that should be checked before it is published.',
      scope: 'Write the draft only. Do not publish or send it.',
    },
  }),
  seed('regression-suite', 'Regression suite', 'engineering', 'Run the tests, find what broke, and report or fix it.', [
    { key: 'suite', label: 'Which tests? (command or folder)', required: true },
    REPO,
  ], {
    title: 'Regression run: {{suite}}',
    brief: {
      goal: 'Run {{suite}}, work out why anything fails, and report it.',
      context: 'Project: {{repo}}',
      constraints: 'Run the whole suite before judging it. For each failure say whether the code or the test is wrong. Do not edit a test to make it pass.',
      expected: 'The result of the run, then each failure with its cause. A fix for each failure only if it is small and clear.',
      scope: 'Run tests and read code. Edit only to fix a failure you have explained.',
    },
    max_runtime: '1h',
  }),
  seed('support-triage', 'Support triage', 'support', 'Sort a batch of support requests by urgency and draft the replies.', [
    { key: 'source', label: 'Where are the requests?', required: true },
    { key: 'policy', label: 'Rules to apply (tone, refunds, escalation)', multiline: true },
  ], {
    title: 'Triage: {{source}}',
    brief: {
      goal: 'Read the support requests in {{source}}. Sort them by urgency and draft a reply for each.',
      context: 'Rules to apply: {{policy}}',
      constraints: 'Be kind and exact. Never promise what the rules above do not allow. Flag anything that looks like a security or legal matter.',
      expected: 'A table of the requests (who, what, urgency, why) and a draft reply for each, ready for you to approve.',
      scope: 'Read and draft only. Do not send any reply.',
    },
  }),
  seed('maintenance-sweep', 'Maintenance sweep', 'maintenance', 'Tidy up: stale branches, unused files, outdated dependencies and old logs.', [
    { key: 'target', label: 'What to sweep', required: true },
    { key: 'keep', label: 'What must not be touched', multiline: true },
  ], {
    title: 'Sweep: {{target}}',
    brief: {
      goal: 'Sweep {{target}} and list what can be cleaned up.',
      context: 'Do not touch: {{keep}}',
      constraints: 'List first. Remove nothing in this task unless the list says it is safe and the owner has agreed.',
      expected: 'A list of what is stale, why it is safe to remove, and the exact commands to do it.',
      scope: 'Read only. Removing anything is a later task.',
    },
    max_runtime: '1h',
  }),
];
