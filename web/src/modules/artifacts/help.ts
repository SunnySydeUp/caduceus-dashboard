import type { ModuleHelp } from '../../help.ts';

export const artifactsHelp: ModuleHelp = {
  pages: [
    {
      id: 'workspace-artifacts',
      title: 'Artifacts',
      summary: 'Reports and files that playbook runs, tasks and chats handed in: filter, open, download, pin and delete them.',
      route: '/workspace/artifacts',
      keywords: 'artifacts artifact report deliverable deep research download delete undo pin keep size limit storage retention markdown pdf image html citations source run task session',
      body: [
        { p: 'An [[artifact]] is a file that came out of work: a research report, or a file a playbook stage handed in. Caduceus keeps it in its own folder and writes down where it came from. The task, run or chat it came from stays in [[hermes]] and is not copied.' },
        { h: 'How a file becomes an artifact' },
        {
          ul: [
            'A playbook stage marked as a deliverable ends with a file attached to its task. When the task is done, Caduceus keeps that file. The [[deep-research]] playbook works this way: its last stage writes the report and attaches it.',
            'On a task’s Attachments tab, Keep in Artifacts keeps one of its files on purpose.',
            'In a chat, the Artifacts tab of the side panel lists the files the chat changed. Keep in Artifacts keeps one of them.',
            'Something you delete is not captured again, and neither is something the size limit removed.',
          ],
        },
        { h: 'Finding and opening' },
        {
          ul: [
            'Filter by source (chat session, task or playbook run) and by kind. Every artifact links back to its source.',
            'Markdown is drawn with its numbered citations. Images and PDFs open in the page. Text is shown as text.',
            'An HTML page is shown in a sandboxed frame that cannot run scripts or reach Caduceus.',
            'A file of a kind Caduceus does not know is offered as a download only.',
            'An artifact has no share link of its own. Sharing is per chat: open the chat it came from (the Open the chat link under the file) and use Share there, or download the file and send it.',
          ],
        },
        { h: 'Delete, pin and the size limit' },
        {
          ul: [
            'Delete asks you to confirm ([[risk-tiers|Tier 1]]) and a toast offers Undo for a minute. After that the file is gone.',
            'Pin keeps an artifact out of the clean-up. When Artifacts grows past its size limit, the oldest artifacts that are not pinned are removed first. Change the limit under Storage.',
            'Read-only mode and being offline stop delete, pin and the size limit.',
          ],
        },
      ],
      related: ['work-playbooks', 'chat', 'risk-tiers', 'workspace-files'],
    },
  ],
  glossary: [
    { id: 'artifact', term: 'Artifact', definition: 'A file that came out of work, such as a research report, kept by Caduceus with a note of the chat, task or playbook run it came from. The source itself stays in Hermes.', page: 'workspace-artifacts' },
    { id: 'deep-research', term: 'Deep Research', definition: 'A seeded playbook that plans sub-questions, searches and reads for each with the agent’s own web tools, and writes one report with numbered citations, which is kept in Artifacts. Depth is the rounds of reading for each sub-question; breadth is how many sub-questions.', page: 'workspace-artifacts' },
  ],
};
