import type { ModuleHelp } from '../help.ts';

/**
 * Help for what belongs to no module: the sign-in screen (which runs outside the shell), More, and how the shell itself works.
 * `createAppRegistry` registers it as the owner `shell`. Plain English, bundled with the app so it works offline.
 */
export const shellHelp: ModuleHelp = {
  pages: [
    {
      id: 'sign-in',
      title: 'Signing in',
      summary: 'How to sign in to Caduceus, and what to do when you cannot.',
      route: '/sign-in',
      keywords: 'login log in owner password',
      body: [
        { p: 'Caduceus is the dashboard for your [[hermes]] agent. It can only be reached from your own devices on your Tailscale network, and signing in is the second lock. You sign in with the owner password you set on the Mac that runs Caduceus, or with a [[passkey|passkey]].' },
        { h: 'Signing in' },
        {
          ul: [
            'Password: type the owner password and choose Sign in. Show reveals what you typed.',
            'Passkey: choose Sign in with a passkey and confirm with Face ID, Touch ID, a security key or your password manager. Some browsers also offer your passkeys when you tap the password field.',
          ],
        },
        { h: 'The first time' },
        { p: 'Until there is an owner, Caduceus asks you to set a password of at least 12 characters. That can only be done on the Mac that runs Caduceus, never from a phone. Add a passkey afterwards in Settings › Security.' },
        { h: 'How long you stay signed in' },
        { p: 'A device stays signed in until it has been idle for 7 days, or for 30 days in all, or until you sign it out in Settings › Security.' },
        { h: 'If you cannot sign in' },
        {
          ul: [
            'Five wrong passwords in a row lock sign-in for a minute. Each further wrong password doubles the wait, up to 15 minutes. A passkey is not affected by this.',
            'If password sign-in has been turned off, use a passkey.',
            'Passkeys need a secure address: https:// through Tailscale, or localhost on the Mac itself.',
            'If a device was signed out from another device, it has to sign in again.',
          ],
        },
      ],
      related: ['settings-security', 'step-up'],
    },
    {
      id: 'control',
      title: 'Control',
      summary: 'Every part of Caduceus that is not Today, Talk or Work.',
      route: '/control',
      body: [
        { p: 'Today, Talk and Work are the three places you use most. Control lists the rest, in groups: Agents, Connect, Workspace, Observe, System and Settings. On a phone the More tab opens it. On a wider screen it is the Control entry at the foot of the sidebar. A number on More (or on Control) is what needs a look in there, such as a failed run in Notices.' },
        { h: 'Searching' },
        { p: 'Type in the search box to filter by name, description or a word the module is known by (for example “telegram” finds Channels). A search looks through every part of Caduceus, Today, Talk and Work included. What you typed stays in the address, so a bookmark or a back step brings it back.' },
        { p: 'To search for actions and help as well, use the search button on a phone, or the Search field in the sidebar (the Search item in the rail).' },
        { h: 'This device' },
        { p: 'At the foot of Control, Help opens the help for the app, and Sign out ends the session on this device only. It asks you to confirm first. Your other devices stay signed in.' },
      ],
      related: ['getting-around', 'search-and-shortcuts'],
    },
    {
      id: 'getting-around',
      title: 'Finding your way around',
      summary: 'The tab bar, sidebar, crew and app bar, and what the banners and the connection ring mean.',
      keywords: 'navigation tab bar rail sidebar crew agents sigil today talk work control more banner toast connection offline',
      body: [
        { p: 'Caduceus rearranges itself to fit your screen, but it is the same app everywhere.' },
        { h: 'Moving between screens' },
        {
          ul: [
            'On a phone the tab bar at the bottom has Today, Talk and Work, and More opens Control, which lists everything else. The arrow at the left of the app bar goes back to where you came from; if you opened the page from a link, it goes up one level instead. The Today tab shows how many things need you.',
            'On a tablet a rail down the side has the profile, Search, the same three places, a sigil for each agent, then Help and Control. Its menu button opens the full sidebar.',
            'On a wide screen the sidebar has the profile and Search at the top, then Today, Talk and Work, then the crew, then Help and Control at the foot. It can be collapsed to the rail, and Caduceus remembers that on this device.',
          ],
        },
        { h: 'The crew' },
        {
          ul: [
            'The crew is one row for each agent (each [[profile-scope|profile]]): its sigil, its name, one line about what it is doing or asking, and since when. Choose a row to open that agent’s latest conversation in Talk. On a computer, pointing at a row (or tabbing to it) shows a + that starts a new chat with that agent instead.',
            'The ring and the small badge on a sigil show how the agent stands: waiting for you, working, finished something you have not opened, or blocked. The words are always written next to it as well.',
            'The agents that need you come first, so the top of the list is where to look.',
            'On a phone, Talk has a row of the same sigils under the app bar. Choose one to switch agent. New chat, first in the row, starts a new chat with the agent you are on.',
          ],
        },
        { h: 'The app bar (phone) and the top of the side card' },
        {
          ul: [
            'On a phone the app bar has the profile chip, the connection dot, Search and Help. On a tablet or a computer there is no app bar: the same things are in the side card.',
            'The top of the side card shows the [[profile-scope|profile]] this tab is working on: its sigil and name. Open it to switch. On Talk it shows the agent whose chat is open. On Today, which always shows every profile, it just says All profiles. In the narrow rail it is a sigil with its name under it.',
            'The ring round that sigil shows the live connection to Hermes: a thin green ring when connected, an amber ring while reconnecting, a dashed grey ring when offline. The same words are in the button’s name for a screen reader, and when the connection is not healthy a banner at the top of the page says so.',
            'Under it, the Search field (or the Search item in the rail) opens search and commands. ⌘K on a Mac, or Ctrl+K elsewhere, does the same.',
            'At the foot of the card, which never scrolls away, Help (or the ? key) opens this panel for the screen you are on, and Control opens the rest of Caduceus. Only the crew scrolls.',
            'On a page inside a module, such as a task or Health, links above the title (for example Observe) lead back up.',
          ],
        },
        { h: 'Banners and messages' },
        { p: 'Banners are about the whole app: that you are offline, that Caduceus cannot reach Hermes, that [[read-only-mode|read-only mode]] is on, or that an update is ready. On a phone they sit under the app bar; on a tablet or a computer they are at the top of the page. The most important one shows, with a +N button for the rest. While the connection to Hermes is not healthy, its banner stays at the top of the window as you scroll, so you can always read what is wrong. A notice that is only news, such as an update, waits and shows with the next page you open, so it never pushes down what you are reading. It stays away from the page it links to and from a conversation.' },
        { p: 'Short messages appear above the tab bar and go away by themselves. While a sheet is open they appear at the top of the window, and while search is open they stay at the bottom, so they never cover what you are typing. Errors stay until you dismiss them.' },
      ],
      related: ['search-and-shortcuts', 'profile-scope', 'control'],
    },
    {
      id: 'search-and-shortcuts',
      title: 'Search, commands and shortcuts',
      summary: 'Find any screen, action or help page, and jump there from the keyboard.',
      keywords: 'palette command k keys hotkeys jump',
      body: [
        { p: 'Press ⌘K (Ctrl+K on Windows and Linux) anywhere, or tap the search button, to open search and commands. On a phone it fills the screen.' },
        { h: 'What it finds' },
        {
          ul: [
            'This screen: actions of the screen you are on.',
            'Go to: Today, Talk, Work and Control come first, so the places you use most are one tap away.',
            'Actions: actions of other screens, plus Help, Keyboard shortcuts and Sign out.',
            'Sessions and Tasks: once you start typing, the chats whose messages have those words, and the tasks whose titles do. On Today, which shows every profile, they come from every profile; the line at the foot of the search says where it looked. Choose one to open it.',
            'Navigate: every other screen, and every panel of Settings.',
            'Help: help pages and glossary words. Help appears once you start typing.',
          ],
        },
        { h: 'Using it' },
        {
          ul: [
            'Type a few letters. Each word has to start where a word of the name starts, so “hlth” finds Health and “tel” finds Telegram, but “hello” does not find Shell hooks.',
            '↑ and ↓ move through the results, ↵ opens or runs the one marked, and Esc closes.',
            'An action with a [[risk-tiers|tier]] asks you to confirm first, the same as when you press its button.',
          ],
        },
        { h: 'Shortcuts' },
        {
          ul: [
            '? opens help for the screen you are on.',
            'g then a key jumps to a screen: for example g then h goes to Today.',
            'Single keys are ignored while you type in a field or while a sheet is open.',
          ],
        },
        { p: 'The Shortcuts tab of this panel lists every shortcut as it is set on this device. Change them, or turn the single-key ones off, in Settings › Keyboard.' },
      ],
      related: ['settings-keyboard', 'getting-around'],
    },
  ],
};
