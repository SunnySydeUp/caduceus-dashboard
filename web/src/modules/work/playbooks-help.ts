import type { ModuleHelp } from '../../help.ts';

export const playbooksHelp: ModuleHelp = {
  pages: [
    {
      id: 'work-playbooks',
      title: 'Playbooks',
      summary: 'Templates and multi-stage playbooks, grouped in categories, with search.',
      route: '/work/playbooks',
      keywords: 'work playbooks playbook template templates category categories search seed seeds software delivery research summarise draft review duplicate delete undo reorder rename brief prepared start task bug hunt code review',
      body: [
        { p: 'This is the library of definitions Caduceus can start work from. A [[playbook]] is a plan of [[stage|stages]] joined by edges. A [[template]] is the one-stage kind: a [[brief]] with blanks that starts one task. Both are cards here, with a badge that says which: Seed, Template or Playbook.' },
        { h: 'Finding one' },
        {
          ul: [
            'Type in the search box. A card matches when every word is in its name, its description, the label of one of its questions or the title of one of its stages.',
            'Choose a category pill to see only that category. The number on a pill counts the cards in it, seeds too.',
          ],
        },
        { h: 'The cards' },
        {
          ul: [
            'A Template card has Use (it opens New task with that template; its questions come first), Edit, Duplicate and Delete.',
            'A Playbook card has Open, Duplicate and Delete. Open shows the stages, the inputs and the YAML.',
            'A Seed card has only Open and Duplicate. Seeds ship with Caduceus and are read-only: Software Delivery (16 stages), Research then summarise, Draft then review, and [[deep-research|Deep Research]], which ends with a cited report kept in Artifacts. Duplicate one to make a copy you can change.',
            'Delete removes a card after you confirm it, and a toast offers Undo for a few seconds. The versions it had stay readable.',
          ],
        },
        { h: 'Your own templates' },
        {
          ul: [
            'New template opens the editor. Write {{name}} in the title or the brief where an answer goes, and the template asks a question for it.',
            'Open any task and choose Save as template: its brief and settings become a new template. Its runs, comments and links to other tasks are not copied.',
            'A playbook with several stages is made by duplicating a seed (or another playbook) and editing its YAML on its detail page.',
          ],
        },
        { h: 'Categories' },
        {
          ul: [
            'Add category makes one. Rename changes its name and leaves what is in it.',
            'Drag a category, or use its up and down arrows, to change the order. The pills follow it.',
            'A category you have templates or playbooks in cannot be deleted: move or delete them first. Seeds do not keep a category from being deleted.',
            'A [[template-category|category]] only groups definitions here. It is never written to Hermes, and it is not the Kanban tenant.',
          ],
        },
        { h: 'Runs' },
        { p: 'Under Library, Runs lists every [[playbook-run|run]], grouped by playbook and version, with how many runs each has. Each row shows the run’s title, its state, how many stages are done and when it started, and opens the run page. With no runs the section says how to start one: open a playbook and press Run.' },
        { h: 'Where they are kept' },
        { p: 'Definitions are files in Caduceus’s own folder (caduceus/playbooks, one YAML file each), and categories are in Caduceus’s own store. Hermes does not hold them, and a Hermes backup carries them. A template saved before playbooks existed opens here unchanged, as a one-stage playbook.' },
      ],
      related: ['work-playbook', 'work-playbook-run', 'work-brief', 'work-template-editor', 'work-tasks'],
    },
    {
      id: 'work-playbook',
      title: 'A playbook',
      summary: 'Its inputs, its stages and what each does, its YAML, its versions and the seeds.',
      route: '/work/playbooks/:playbookId',
      keywords: 'playbook detail inputs stages stage inspector gate approval clarify attempts edges on_done on_fail on_approve on_reject always yaml versions version older seed read-only duplicate warning profile skill hermes does not have validate graph list view lane lanes parallel group fork join loop keyboard arrow',
      body: [
        { p: 'A [[playbook]] page shows what the definition holds. Under the name are its kind, its category and a Version menu. Stages shows the inputs and the stages; YAML shows the definition as text.' },
        { h: 'Inputs and stages' },
        {
          ul: [
            'Inputs are the questions a run asks first. Each answer replaces its {{key}} wherever the key is written in a stage.',
            'Stages are listed in order, each with its number, its title, its assignee, its [[gate]] if it has one, and how many attempts it may make. The first stage is where a run starts.',
            'Choose a stage to open the inspector: on a wide screen it is a panel beside the list, and on a phone it is a sheet. It shows the stage’s brief template, assignee, model, skills, goal mode, completion contract, gate and attempts, and the edges that leave it.',
            'An edge reads “when it is done → the next stage”. The conditions are done, fail, approve, reject and always. Choose an edge to jump to the stage it leads to.',
          ],
        },
        { h: 'Gates' },
        { p: 'A [[gate]] stops a stage until you answer. An approval gate makes the stage’s task wait in review for you to approve or reject it. A clarify gate blocks the task with a question until you answer it.' },
        { h: 'Parallel groups' },
        { p: 'When several edges leave one stage, the stages they lead to start together: that is a [[parallel-group|parallel group]]. A stage that several stages lead to is where they join: it starts only when every one of them is done, and Kanban shows the stages it waited for as its parents. If one branch fails, that branch follows its own “fail” edge and the others carry on.' },
        { h: 'The graph' },
        {
          ul: [
            'On a screen 1024 pixels wide or more, Graph (beside List, above the stages) draws the stages as boxes joined by arrows. It is not offered on a narrower screen, where the list is the only view.',
            'Stages are in columns, left to right, in the order a run reaches them. Stages of a parallel group sit side by side in rows. Each box shows the stage’s number, its title, its [[gate]] (Approval or Question) and, when the stage sets it, its attempts as “max 3”.',
            'Each arrow says when it is followed: done, fail, approve, reject or always. A dashed arc that goes back to an earlier stage is a loop; it also says how many attempts the stage it returns to allows, for example “fail × 5”.',
            'With the keyboard, Tab goes to the graph and the arrow keys move between stages: left and right follow the edges, up and down move between the stages of a parallel group. Enter opens the stage in the inspector. Home and End go to the first and last stage. The focused stage has a ring around it.',
            'View as list, always shown above the graph, goes back to the list of stages, which has the same stages.',
          ],
        },
        { h: 'Warnings' },
        { p: 'Caduceus asks Hermes live whether the profiles and skills a stage names exist, and keeps no copy. If one is missing, a banner says so and the stage is marked. It is a warning: the definition can still be saved.' },
        { h: 'The YAML view' },
        {
          ul: [
            'As you type, the server checks the text and shows its problems under the editor, each with its line. Line opens the editor there.',
            'An error is a definition that cannot be saved: an edge to a stage that does not exist, a stage no edge reaches, a loop without max_attempts, or a field the format does not know.',
            'Save writes a new version, after you confirm it. It is off, with the reason beside it, while the text has errors or has not changed.',
            'On a phone the YAML is read-only: edit it on a larger screen.',
          ],
        },
        { h: 'Versions' },
        {
          ul: [
            'Every save writes the next version and keeps the one it replaces. The Version menu opens any of them, exactly as it was written.',
            'An older version is read-only. A run started from a version keeps using that version, so editing a playbook never changes a run that is under way.',
          ],
        },
        { h: 'Running it' },
        {
          ul: [
            'Run starts a run of the version you are reading, when it is the newest. It opens a form with one question for each input, with the number of stages and the profiles that will get tasks.',
            'Pressing Run in the form asks you to confirm. The question names the playbook, its version and the profiles. If you cancel, nothing is sent.',
            'If Caduceus does not accept an answer, the form stays open and lists what it did not accept.',
            'Runs, at the bottom of the page, lists the runs of this playbook, newest first. Each opens its run page.',
          ],
        },
        { h: 'Seeds' },
        { p: 'Seeds are built in and cannot be edited or deleted. Their page shows Duplicate instead of Save: the copy is yours, starting at version 1.' },
      ],
      related: ['work-playbooks', 'work-playbook-run', 'work-template-editor'],
    },
    {
      id: 'work-template-new',
      title: 'New template',
      summary: 'Name a template, choose its category, write its brief and set its questions.',
      route: '/work/playbooks/new',
      keywords: 'template editor new save as template questions placeholder blank inputs default required long answer category name description brief settings',
      body: [
        { p: 'A [[template]] is written as the brief it starts with. This page is the Brief editor’s fields with a name, a category and a description on top, and no way to start a task: starting is done from New task.' },
        { h: 'Questions' },
        {
          ul: [
            'Write {{name}} (for example {{bug}}) in the title or in a section of the brief wherever an answer should go. A question appears under Questions for each name you use.',
            'A question can be marked Must be answered, can be a Long answer (a larger box), and can have a Starts as text.',
            'A name you stop using drops its question.',
          ],
        },
        { h: 'Save as template' },
        { p: 'Opened from a task, this page starts from that task’s brief and settings. A template keeps no task ids, no runs, no comments and no status. If the task’s text already has {{name}} in it, those become questions.' },
        { h: 'Saving' },
        { p: 'Save writes the template’s file in Caduceus’s folder at version 1. If you leave with changes that are not saved, you are asked first.' },
      ],
      related: ['work-playbooks', 'work-template-editor', 'work-brief'],
    },
    {
      id: 'work-template-editor',
      title: 'Edit a template',
      summary: 'Change a template’s brief and questions; saving writes the next version.',
      route: '/work/playbooks/:playbookId/edit',
      keywords: 'template editor edit version save confirm questions placeholder blank brief settings',
      body: [
        { p: 'This is the same page as New template, opened on a [[template]] that exists. Only a one-stage template is edited as a brief; a playbook with several stages is edited as YAML on its own page, and a seed is only duplicated.' },
        { h: 'Saving' },
        { p: 'Save asks you to confirm, then writes the next version of the template and keeps the one it replaces. If you leave with changes that are not saved, you are asked first.' },
      ],
      related: ['work-playbooks', 'work-template-new', 'work-playbook'],
    },
    {
      id: 'work-playbook-run',
      title: 'A playbook run',
      summary: 'Where one run stands: each stage as a task, in order, and the stages still to come.',
      route: '/work/playbooks/:playbookId/runs/:rootTaskId',
      keywords: 'playbook run timeline compact raw view tabs graph list lane parallel group fork join stage stages task status attempt attempts verdict passed failed approved rejected answered note rework loop max_attempts bounded gate approval clarify inbox re-run rerun stopped not started engine live reload inputs answers waiting failed done progress idempotency_key workflow_template_id current_step_key parents children links hermes kanban keyboard arrow',
      body: [
        { p: 'A [[playbook-run|run]] is a [[playbook]] being carried out. The [[playbook-engine|playbook engine]] makes one Kanban task for each [[stage]], and makes the next one when the one before it ends. This page shows the run as those tasks.' },
        { h: 'The top of the page' },
        {
          ul: [
            'The name of the playbook and its version, which opens that version of the playbook.',
            'The state of the run: Running, Waiting for you (a stage waits at a [[gate]]), Done, or Stopped (the run could not go on; a task for it is in Notices).',
            'How many stages are done, for example 2 of 5 stages.',
          ],
        },
        { h: 'The timeline' },
        {
          ul: [
            'Each stage that has a task is a row, oldest first: its title, its status on the Kanban board, the profile it is assigned to, when it began and when it ended.',
            'A stage that was tried again, for example after a reject, has one row for each try. A row after the first says which [[attempt]] it is.',
            'Beside its status, a row shows its [[verdict]] once it has one: Passed, Failed, Approved, Rejected or Answered. Under it comes the note that went with it: Owner’s note (what you wrote when you rejected), Why it failed, or Owner’s answer.',
            'A stage that waits at a gate shows Waiting for you. An approval gate waits for you to Approve or Reject; a clarify gate asks you a question. Decide it on Today, not from this page; the run goes on when you do.',
            'Open the task goes to the task itself, where you can read what the worker did.',
            'Re-run from this stage starts a new attempt of that stage. Stages that are done are not touched. It asks you to confirm first, then says which attempt began. A stage that has not started has no such button.',
            'Stages that have no task yet are listed after, as Not started, in the order of the playbook. You see the whole path, but a stage only starts when the one before it ends and an edge leads to it.',
          ],
        },
        { h: 'Timeline, Compact and Raw' },
        {
          ul: [
            'Timeline, Compact and Raw are three views of the same run. Timeline, the one described above, is the default.',
            'Compact shows one line for each stage attempt: the stage (it opens the task), which attempt, its status on the board and its [[verdict]] once it has one. Stages that have not started are listed after, as Not started.',
            'Raw shows the Kanban tasks the run is made of, as Hermes holds them: the task id, its title and status, its idempotency_key (the tag that says which playbook, version, run, stage and attempt it is), workflow_template_id, current_step_key (empty until Hermes fills it), and its parents and children. A stage that joins a [[parallel-group|parallel group]] has the stages it waited for as its parents. Nothing is changed from here.',
          ],
        },
        { h: 'The graph' },
        {
          ul: [
            'On a screen 1024 pixels wide or more, Graph (beside List) draws the stages above the views, as on the playbook’s page, with each stage’s live status: its colour and its words (Not started, Running, Waiting for you, Done, Failed, Rejected), and which attempt it is on, for example “Failed · attempt 2 of 5”. A stage waits for you when it is at a [[gate]]. It is not offered on a narrower screen.',
            'The arrow keys move between stages: left and right follow the edges, up and down move between the stages of a [[parallel-group|parallel group]]. Enter opens the stage’s task. View as list goes back to the views below.',
          ],
        },
        { h: 'Loops and limits' },
        { p: 'An edge can lead back to an earlier stage, for example when a review rejects or a check fails. The stage then gets another [[attempt]] and its worker is given the note. A stage can set max_attempts to bound this loop: when it has used them all, the run stops and a task in Notices says why. Re-run from this stage is how you go on after that, or try a stage again by choice.' },
        { h: 'Staying current' },
        { p: 'The page follows the board live: when any task on the run’s board changes, it reads the run again. Reload does the same on demand. Nothing is polled.' },
        { h: 'The answers' },
        { p: 'Answers this run was started with opens the list of the playbook’s questions and what you answered.' },
        { h: 'If the run is not found' },
        { p: 'A run is named by its first task. If that task is deleted, or is on another board than the address says, the page says the run was not found.' },
      ],
      related: ['work-playbook', 'work-playbooks', 'work-task', 'work-board'],
    },
  ],
  glossary: [
    {
      id: 'playbook',
      term: 'Playbook',
      definition: 'A saved plan of stages joined by edges, with the questions it asks first. Each stage makes one task. Playbooks are Caduceus’s own YAML files, versioned: every save keeps the version it replaces.',
      page: 'work-playbooks',
    },
    {
      id: 'template',
      term: 'Template',
      definition: 'A playbook with one stage and no edges: a prepared brief with blanks. It asks a few questions, fills the Brief editor from the answers, and starts nothing by itself.',
      page: 'work-playbooks',
    },
    {
      id: 'stage',
      term: 'Stage',
      definition: 'One step of a playbook. It holds the brief a task is made from, who does it, and the edges that say which stage comes next when it is done, fails, is approved or is rejected.',
      page: 'work-playbook',
    },
    {
      id: 'gate',
      term: 'Gate',
      definition: 'A stop in a stage until you answer. An approval gate waits for you to approve or reject the stage’s task; a clarify gate blocks it with a question.',
      page: 'work-playbook',
    },
    {
      id: 'template-category',
      term: 'Category',
      definition: 'A group of templates and playbooks that you name and order. It exists only in Caduceus: it is not a Hermes field and never the Kanban tenant.',
      page: 'work-playbooks',
    },
    {
      id: 'playbook-run',
      term: 'Playbook run',
      definition: 'One carrying-out of a playbook. Its stages become Kanban tasks one after another, and the run is those tasks: Caduceus keeps no record of it apart from the tasks on the board.',
      page: 'work-playbook-run',
    },
    {
      id: 'playbook-engine',
      term: 'Playbook engine',
      definition: 'Caduceus’s worker for runs. When a stage’s task ends, it makes the task for the next stage. It keeps no state of its own, so a restart of Caduceus loses nothing: it reads the tasks again and carries on.',
      page: 'work-playbook-run',
    },
    {
      id: 'attempt',
      term: 'Attempt',
      definition: 'One try at a stage, and one Kanban task. A stage that is tried again, after a reject or a failure or because you re-ran it, gets the next attempt number. A stage may be tried only as many times as its max_attempts allows; then the run stops.',
      page: 'work-playbook-run',
    },
    {
      id: 'verdict',
      term: 'Verdict',
      definition: 'How a stage attempt ended: Passed or Failed for a stage that does its work, Approved or Rejected for an approval gate, Answered for a clarify gate. The note that went with it (your note on a reject, why it failed, your answer) is shown under it.',
      page: 'work-playbook-run',
    },
    {
      id: 'parallel-group',
      term: 'Parallel group',
      definition: 'Several stages that start together, because several edges leave the same stage. The stage they lead to waits for all of them: it starts only when every one is done. Each branch that fails follows its own fail edge.',
      page: 'work-playbook',
    },
  ],
};
