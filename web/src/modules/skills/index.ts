import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Skills = lazy(() => import('./Skills.tsx').then((m) => ({ default: m.Skills })));
const Hub = lazy(() => import('./Hub.tsx').then((m) => ({ default: m.Hub })));
const Learn = lazy(() => import('./Learn.tsx').then((m) => ({ default: m.Learn })));
const Curator = lazy(() => import('./Curator.tsx').then((m) => ({ default: m.Curator })));
const SkillEditor = lazy(() => import('./SkillEditor.tsx').then((m) => ({ default: m.SkillEditor })));

/** Agents › Skills: the installed list and the SKILL.md editor, the hub, Learn-a-skill and the curator. */
export const skillsModule: AppModule = {
  id: 'skills',
  title: 'Skills',
  icon: 'stack',
  desk: 'control',
  group: 'agents',
  path: '/agents/skills',
  order: 3,
  summary: 'The skills of a profile: search, switch, read, edit and remove, find more in the hub, learn one, and the curator',
  profileScoped: true,
  routes: [
    { path: '/agents/skills', screen: Skills },
    { path: '/agents/skills/hub', screen: Hub, title: 'Skills hub', parent: '/agents/skills' },
    { path: '/agents/skills/learn', screen: Learn, title: 'Learn a skill', parent: '/agents/skills' },
    { path: '/agents/skills/curator', screen: Curator, title: 'Curator', parent: '/agents/skills' },
    { path: '/agents/skills/new', screen: SkillEditor, title: 'New skill', parent: '/agents/skills' },
    { path: '/agents/skills/:name', screen: SkillEditor, title: 'Edit skill', parent: '/agents/skills' },
  ],
  help: () => import('./help.ts').then((m) => m.skillsHelp),
};
