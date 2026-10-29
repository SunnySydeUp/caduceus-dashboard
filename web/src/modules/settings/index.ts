import { indexSettings, searchSettings } from './settings-search.ts';
import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

export const settingsModule: AppModule = {
  id: 'settings',
  title: 'Settings',
  icon: 'settings',
  desk: 'control',
  group: 'settings',
  path: '/settings',
  key: ',',
  summary: 'Appearance, keyboard shortcuts, security, signed-in devices and installing the app',
  routes: [{ path: '/settings', screen: lazy(() => import('./Settings.tsx').then((m) => ({ default: m.Settings }))) }],
  // Security, the audit log and Repairs are reached from Settings, so the tidy Settings addresses a link or a bookmark may use go to where they live.
  redirects: [
    { from: '/settings/security', to: '/system/security' },
    { from: '/settings/audit', to: '/system/security/audit' },
    { from: '/settings/repairs', to: '/observe/health' },
  ],
  help: () => import('./help.ts').then((m) => m.settingsHelp),
  paletteSearch: async (query) => {
    // Imported when a search runs: the module list imports this module, so a static import would be a cycle.
    const { builtInModules } = await import('../index.ts');
    const panels = builtInModules.flatMap((module) =>
      (module.settings ?? []).map((panel) => ({ moduleId: module.id, id: panel.id, title: panel.title, path: panel.path ?? `/settings/${panel.id}`, icon: panel.icon, fields: panel.fields })),
    );
    const icons = new Map(panels.map((panel) => [`${panel.moduleId}:${panel.id}`, panel.icon]));
    return searchSettings(indexSettings(panels), query)
      .slice(0, 8)
      .map((result) => ({ id: `${result.panelId}/${result.fieldId}`, label: result.label, sub: `Settings › ${result.panelTitle}`, icon: icons.get(`${result.moduleId}:${result.panelId}`), group: 'Settings' as const, path: result.path }));
  },
  // Settings › Security keeps its address from information architecture §7 (`/system/security`).
  settings: [
    {
      id: 'appearance',
      title: 'Appearance',
      summary: 'Theme, skin, density and text size for this device',
      icon: 'sliders',
      screen: lazy(() => import('./Appearance.tsx').then((m) => ({ default: m.Appearance }))),
      fields: [
        { id: 'theme', label: 'Theme', description: 'Light, dark or follow the device setting', keywords: ['dark mode', 'light mode', 'night', 'colour', 'color'] },
        { id: 'skin', label: 'Skin', description: 'The accent colour and surfaces Caduceus uses', keywords: ['accent', 'colour', 'color', 'palette', 'desk', 'nous', 'hermes', 'gold', 'mono'] },
        { id: 'density', label: 'Density', description: 'How tightly lists and controls are spaced on this device', keywords: ['compact', 'comfortable', 'spacing', 'padding'] },
        { id: 'text-size', label: 'Text size', description: 'Make everything larger or smaller on this device', keywords: ['font', 'zoom', 'bigger', 'smaller', 'accessibility'] },
      ],
    },
    {
      id: 'security',
      title: 'Security',
      summary: 'Passkeys, the password and every signed-in device',
      icon: 'shield',
      path: '/system/security',
      screen: lazy(() => import('./Security.tsx').then((m) => ({ default: m.Security }))),
      fields: [
        { id: 'passkeys', label: 'Passkeys', description: 'Add, rename or remove the passkeys you sign in with', keywords: ['face id', 'touch id', 'security key', 'webauthn', 'sign in'] },
        { id: 'password', label: 'Password', description: 'Set, change or remove the password sign-in', keywords: ['login', 'credentials', 'sign in'] },
        { id: 'read-only', label: 'Read-only mode', description: 'Block every change so Caduceus can only be looked at', keywords: ['lock', 'freeze', 'view only', 'safe'] },
        { id: 'devices', label: 'Signed-in devices', description: 'Every browser signed in to Caduceus, and revoking one', keywords: ['sessions', 'sign out', 'revoke', 'browsers'] },
      ],
    },
    {
      id: 'notifications',
      title: 'Notifications',
      summary: 'Push notifications for this device: what to be told of, quiet hours and a digest',
      icon: 'bolt',
      screen: lazy(() => import('./Notifications.tsx').then((m) => ({ default: m.Notifications }))),
      fields: [
        { id: 'device', label: 'Push notifications on this device', description: 'Turn push notifications on or off for this browser', keywords: ['push', 'notify', 'alerts', 'subscribe', 'permission', 'browser'] },
        { id: 'categories', label: 'What to be told of', description: 'Which kinds of event send a notification', keywords: ['categories', 'approvals', 'failures', 'jobs', 'events', 'alerts'] },
        { id: 'quiet-hours', label: 'Quiet hours', description: 'Hours when notifications are held back', keywords: ['quiet', 'night', 'do not disturb', 'silence', 'schedule', 'sleep'] },
        { id: 'digest', label: 'Digest', description: 'A single summary instead of one notification per event', keywords: ['summary', 'batch', 'daily', 'group'] },
        { id: 'scheduled-jobs', label: 'Scheduled jobs', description: 'Which scheduled jobs may notify you', keywords: ['cron', 'schedules', 'jobs', 'sources'] },
      ],
    },
    {
      id: 'audit',
      title: 'Audit log',
      summary: 'Everything Caduceus recorded, with filters and export',
      icon: 'log',
      path: '/system/security/audit',
      screen: lazy(() => import('./AuditLog.tsx').then((m) => ({ default: m.AuditLog }))),
      fields: [{ id: 'log', label: 'Audit log', description: 'Everything Caduceus recorded: sign-ins, changes and refusals, with filters and export', keywords: ['history', 'events', 'export', 'who did', 'sign-ins', 'refusals'] }],
    },
    {
      id: 'voice',
      title: 'Voice',
      summary: 'Dictation engine and language, reading replies aloud, and the voice Hermes speaks with',
      icon: 'mic',
      screen: lazy(() => import('./VoiceSettings.tsx').then((m) => ({ default: m.VoiceSettings }))),
      fields: [
        { id: 'engine', label: 'Dictation engine', description: 'Whether Hermes or this browser turns your voice into text', keywords: ['microphone', 'mic', 'speech to text', 'transcribe', 'whisper', 'web speech'] },
        { id: 'language', label: 'Dictation language', description: 'The language the browser’s engine listens for', keywords: ['locale', 'speech', 'recognition'] },
        { id: 'hold-sends', label: 'Letting go of the mic sends the message', description: 'On a phone, hold to talk sends instead of waiting in the message box', keywords: ['hold to talk', 'push to talk', 'phone'] },
        { id: 'auto-read', label: 'Read each reply aloud', description: 'Speak every reply when Hermes finishes it', keywords: ['read aloud', 'tts', 'text to speech', 'speak', 'auto'] },
        { id: 'hermes-voice', label: 'Hermes’s voice', description: 'The text to speech engine and voice Hermes speaks with', keywords: ['tts', 'elevenlabs', 'openai', 'edge', 'speaker', 'voice'] },
      ],
    },
    {
      id: 'keyboard',
      title: 'Keyboard',
      summary: 'Shortcuts, remapping, and turning single-key shortcuts off',
      icon: 'keyboard',
      screen: lazy(() => import('./Keyboard.tsx').then((m) => ({ default: m.Keyboard }))),
      fields: [
        { id: 'single-key', label: 'Single-key shortcuts', description: 'Turn shortcuts that are one plain key on or off for this device', keywords: ['keys', 'hotkeys', 'typing', 'switch'] },
        { id: 'shortcuts', label: 'Shortcuts', description: 'Every keyboard shortcut, with remapping and reset', keywords: ['remap', 'rebind', 'keybinding', 'keys', 'change', 'reset'] },
      ],
    },
    {
      id: 'install',
      title: 'Install app',
      summary: 'Add Caduceus to your Home Screen or dock, and run it like an app',
      icon: 'download',
      screen: lazy(() => import('./Install.tsx').then((m) => ({ default: m.Install }))),
      fields: [
        { id: 'install', label: 'Install Caduceus', description: 'Add Caduceus to your Home Screen or dock and run it like an app', keywords: ['app', 'pwa', 'home screen', 'dock', 'add'] },
      ],
    },
  ],
};
