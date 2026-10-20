import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

/** Observe › Insights (M5 #05): Hermes's usage analytics as charts, the provider quota card, and Caduceus-owned budgets with alerts. */
export const insightsModule: AppModule = {
  id: 'insights',
  title: 'Insights',
  icon: 'chart',
  desk: 'control',
  group: 'observe',
  path: '/observe/insights',
  order: 1,
  summary: 'Tokens, cost and activity, provider quota and budgets',
  // Spend is across profiles unless one is chosen (information architecture §6).
  crossProfile: true,
  routes: [{ path: '/observe/insights', screen: lazy(() => import('./Insights.tsx').then((m) => ({ default: m.Insights }))) }],
  help: () => import('./help.ts').then((m) => m.insightsHelp),
};
