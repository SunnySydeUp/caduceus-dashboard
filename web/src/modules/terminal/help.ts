import type { ModuleHelp } from '../../help.ts';

export const terminalHelp: ModuleHelp = {
  pages: [
    {
      id: 'workspace-terminal',
      title: 'Terminal',
      summary: 'A real shell on the Mac that runs Caduceus, in the folder you pick, behind your passkey.',
      route: '/workspace/terminal',
      keywords: 'terminal shell console pty command line bash zsh xterm restart copy paste step-up passkey resize idle',
      body: [
        { p: 'The [[terminal-shell|terminal shell]] is your own shell (the program in $SHELL, started as a login shell) on the Mac that runs Caduceus. Caduceus runs it itself: it is not [[hermes]]’s terminal. Anything you can type in a terminal on that Mac, you can type here.' },
        { h: 'Opening it' },
        {
          ul: [
            'Opening the shell needs your passkey every time the last confirmation has run out ([[step-up|step-up]]). Caduceus checks it on the connection itself, not only on this page. It never opens in [[read-only-mode|read-only mode]].',
            'The shell starts in the folder you pick: one of your workspaces, a repository of one of Hermes’s projects, or your home folder. It can only start inside the folders Caduceus lets Hermes work in.',
            'On a tablet or a computer it opens straight away. On a phone it tells you it is not designed for a small screen and waits for you to press Open anyway; it still needs your passkey.',
          ],
        },
        { h: 'Using it' },
        {
          ul: [
            'Every screen that opens the same folder watches the same shell and sees the same output. If you reload, or your connection drops, the shell goes on and you pick it up again with what it printed.',
            'The shell takes the size of the window that resized last.',
            'Copy selection and Paste work with the buttons, and with ⌘C and ⌘V on a Mac or Ctrl-Shift-C and Ctrl-Shift-V elsewhere. Ctrl-C is the shell’s own.',
            'The terminal keeps the keyboard while it is focused. Press Shift-Esc to leave it and use Caduceus’s own keys again (Escape, the command palette, ?). On a touch screen a row of extra keys (Esc, Tab, arrows, Ctrl-C) sits under it.',
            'The colours follow your theme and skin, and the cursor stops blinking when your device asks for reduced motion.',
          ],
        },
        { h: 'When it ends' },
        {
          ul: [
            'A shell nobody is watching ends after 10 minutes. A shell with nothing typed for 30 minutes ends, watched or not. Stopping Caduceus ends every shell. The screen tells you which of these happened.',
            'Restart stops the shell and starts a new one in the same folder, after one confirmation ([[risk-tiers|Tier 1]]). Anything running in it is stopped. It works only while the shell is connected; when the screen says Not connected, use Reconnect.',
          ],
        },
        { h: 'What Caduceus records' },
        { p: 'Caduceus records when a shell starts, ends or is restarted, with the folder, the device and the profile. It never records what you type or what the shell prints.' },
      ],
      related: ['risk-tiers', 'read-only-mode', 'workspace-files'],
    },
    {
      id: 'chat-terminal-mode',
      title: 'Terminal mode',
      summary: 'See the chat as Hermes’s own terminal, on the same session, on a tablet or a computer.',
      keywords: 'terminal mode tui hermes xterm chat session passkey step-up shortcuts copy last output reattach',
      body: [
        { p: 'On a tablet or a computer, Open in terminal, in the More menu (⋮) in the header of a chat, switches that chat to [[terminal-mode|terminal mode]]: Hermes’s own terminal program (the TUI, the same as “hermes --tui”) running on the chat’s session. The line is not there on a phone, and the address opens the chat view instead.' },
        { h: 'Opening it' },
        {
          ul: [
            'It needs your passkey ([[step-up|step-up]]), because the TUI can reach a shell. Caduceus checks it on the connection itself, and it never opens in [[read-only-mode|read-only mode]].',
            'The terminal is Hermes’s, and the session is Hermes’s: a message you send in the terminal is in the chat view after a refresh, and one you sent in the chat view is on the terminal’s screen.',
          ],
        },
        { h: 'Reload, leave and come back' },
        {
          ul: [
            'Caduceus keeps the terminal running for 10 minutes after the last screen left it. A reload, or a switch between tabs, finds the same terminal with what was on it.',
            'After that the terminal is closed. The next time you open terminal mode the screen says so and starts a new terminal on the same session; the conversation is not lost, it is Hermes’s.',
            'If you leave the terminal program (for example with /exit), the screen says the terminal ended, and Reconnect starts a new one.',
          ],
        },
        { h: 'Keys' },
        {
          ul: [
            'Copy and paste are ⌘C and ⌘V on a Mac, Ctrl-Shift-C and Ctrl-Shift-V elsewhere. ⇧⌘L (Ctrl-Shift-L) copies the last output, the text after the last message you sent. The buttons above the terminal do the same.',
            'The terminal keeps the keyboard while it is focused. Press Shift-Esc to leave it, and Escape, the command palette and ? work again. All of these are on the shortcut sheet (press ?).',
            'The colours follow your theme and skin, and the cursor stops blinking when your device asks for reduced motion.',
          ],
        },
        { p: 'Caduceus records when terminal mode is opened, closed or runs out. It never records what you type or what the terminal prints.' },
      ],
      related: ['chat-conversation', 'workspace-terminal', 'risk-tiers'],
    },
  ],
  glossary: [
    { id: 'terminal-shell', term: 'Terminal shell', definition: 'A real shell (your $SHELL) that the Caduceus server runs in a pseudo-terminal on the Mac, in a folder you pick. Opening it needs a passkey confirmation, and every screen that opens the same folder watches the same shell.', page: 'workspace-terminal' },
    { id: 'terminal-mode', term: 'Terminal mode', definition: 'The chat shown as Hermes’s own terminal program (the TUI) on the same session, on a tablet or a computer. Opening it needs a passkey confirmation, and Caduceus keeps it running for 10 minutes after the last screen left.', page: 'chat-terminal-mode' },
  ],
};
