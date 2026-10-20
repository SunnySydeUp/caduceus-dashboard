import type { ModuleHelp } from '../../help.ts';

export const filesHelp: ModuleHelp = {
  pages: [
    {
      id: 'workspace-files',
      title: 'Files',
      summary: 'Browse the folders Hermes exposes, preview and edit text and Office files, upload, make folders, rename, move, download and delete.',
      route: '/workspace/files',
      keywords: 'files folder browse preview edit save upload download delete new folder rename move word excel powerpoint office docx xlsx pptx spreadsheet markdown csv pdf image audio video html code snapshot protected area managed root workspace guarded file operation drag drop',
      body: [
        { p: 'Files shows the [[managed-root|managed root]]: the folders [[hermes]] itself lets you reach. Hermes keeps the files; Caduceus never copies them. A path outside the managed root, a link that leads out of it, and Hermes’s key files (.env and auth.json) are refused.' },
        { h: 'Browsing and previews' },
        {
          ul: [
            'Open a folder to list it with each name, size and time. On a phone the list is cards, and a file opens full screen. On a wide screen the folder and the preview sit side by side.',
            'Code is highlighted and Markdown is drawn. A CSV is a table: press a heading to sort by it. Images, audio, video and PDFs play in the page.',
            'An HTML file is shown in a sandboxed frame with no scripts and no access to Caduceus: it cannot read your cookies or call Caduceus. Show source reads the file as text.',
            'A text file over 1 MiB, or a file that is not text, shows its size and a Download action instead.',
          ],
        },
        { h: 'Editing a text file' },
        {
          ul: [
            'Edit opens the text. The page warns you before you leave with unsaved changes.',
            'Before every save, Caduceus keeps the text it replaces as a [[snapshot|snapshot]]. If the file changed on disk after you opened it, the save is refused and you are asked to reload.',
            'A file inside one of your workspaces (Work › Projects) saves after one confirmation ([[risk-tiers|Tier 1]]). A file elsewhere in the managed root, such as a profile’s home or a behaviour file, is in a [[protected-area|protected area]]: it needs your passkey and the file’s name typed ([[risk-tiers|Tier 3]]).',
            'Read-only mode and being offline stop every save, upload, new folder and delete.',
          ],
        },
        { h: 'Upload, new folder, download and delete' },
        {
          ul: [
            'Upload takes the files you pick, or drop them anywhere on the folder. A file with the same name is not replaced.',
            'New folder makes an empty folder. Download saves the file as it is.',
            'Delete names the path and the profile before it asks you to confirm. Inside one of your workspaces, upload, new folder and delete ask for one confirmation ([[risk-tiers|Tier 1]]); anywhere else they need your passkey and the name typed ([[risk-tiers|Tier 3]]), and so does a folder with files in it, in a workspace or not. Every change is recorded in the audit log.',
            'Some places are never written through Caduceus, whatever the tier: the files a shell reads when it starts (.zshrc, .bash_profile…), ~/.ssh, launch agents, a repository’s .git/hooks and .git/config, ~/.config, and Hermes’s own hooks, scripts, skills and plugins. They run code later.',
          ],
        },
        { h: 'Rename and move' },
        {
          ul: [
            'Rename and Move to… are in a file’s ⋮ menu. They are [[guarded-file-operation|guarded file operations]]: Caduceus does them on disk itself, inside the managed root only.',
            'In a workspace, Rename keeps the file in its folder and happens at once ([[risk-tiers|Tier 0]]); the message that follows has an Undo that renames it back. Move to… opens a folder picker, then names the file, the destination and the profile before it asks you to confirm ([[risk-tiers|Tier 1]]). Outside your workspaces both need your passkey and the name typed ([[risk-tiers|Tier 3]]).',
            'A name that is already taken is refused, never overwritten. A folder cannot go into itself. Hermes’s key files, Caduceus’s own folder, anything outside the managed root and links are refused with the reason. Read-only mode stops both.',
          ],
        },
        { h: 'Word, Excel and PowerPoint documents' },
        {
          ul: [
            'A .docx, .xlsx or .pptx opens in an editor in the page. A Word or PowerPoint document is its paragraphs of text; an Excel workbook is the cells of its sheets, where a formula shows as =… and an empty cell past the data can be filled in.',
            'The editor changes text and values and leaves everything else in the file as it was: layout, pictures, charts and the formatting of the text you edit. Excel calculates the formulas when it next opens the workbook.',
            'Save puts your version over the original, after keeping the old bytes as a [[snapshot|snapshot]] that Earlier versions lists, so you can open one in the editor and save it back. If the file changed on disk after you opened it, the save is refused. A document in a workspace saves after one confirmation ([[risk-tiers|Tier 1]]); one in a [[protected-area|protected area]] needs your passkey and its name typed ([[risk-tiers|Tier 3]]). Saving is a [[guarded-file-operation|guarded file operation]] written through Hermes’s own upload.',
            'On a phone the document opens as a read-only preview of its text. Edit anyway opens the editor, which is made for a larger screen.',
          ],
        },
      ],
      related: ['risk-tiers', 'read-only-mode'],
    },
    {
      id: 'workspace-files-open',
      title: 'A folder or a file in Files',
      summary: 'What the address of a folder or a file in Files holds, and how to share a place.',
      route: '/workspace/files/*path',
      keywords: 'files address url path link folder file open share bookmark preview',
      body: [
        { p: 'The address of a folder or a file in Files holds its path, so a link or a bookmark opens the same place again. A folder lists its files; a file is previewed beside its folder, or full screen on a phone. Close the preview to go back to the folder. Everything said on the Files page applies here.' },
        { p: 'A path outside the [[managed-root|managed root]] is refused, and so is anything that no longer exists: the page says which, and leads back to the top.' },
      ],
      related: ['workspace-files'],
    },
  ],
  glossary: [
    {
      id: 'managed-root',
      term: 'Managed root',
      definition: 'The folders Hermes’s own file feature exposes: its managed files root, or the profile’s workspace. Files browses these and nothing else.',
      page: 'workspace-files',
    },
    {
      id: 'protected-area',
      term: 'Protected area',
      definition: 'A part of the managed root that holds Hermes’s own settings and behaviour files (a profile’s home, config and instructions). Saving a text file there needs your passkey and the file’s name typed.',
      page: 'workspace-files',
    },
    {
      id: 'guarded-file-operation',
      term: 'Guarded file operation',
      definition: 'A change to a file that Hermes has no feature for, so Caduceus makes it on disk itself: renaming, moving and saving an Office document. It stays inside the managed root, never touches Hermes’s key files or Caduceus’s own data, asks for the confirmation its tier needs, and is written to the audit log.',
      page: 'workspace-files',
    },
  ],
};
