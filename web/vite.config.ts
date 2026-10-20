import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { caduceusPwa } from './pwa/vite-plugin.ts';

export default defineConfig({
  plugins: [react(), caduceusPwa()],
  build: {
    rolldownOptions: {
      output: {
        // Screens share a few shell modules (the connection state, the profile scope, toasts). Left to the bundler each becomes a
        // chunk of its own, and every one is another request in front of the first paint: keep them together.
        advancedChunks: {
          groups: [
            { name: 'shell-state', test: /web\/src\/(shell\/(connection|profile-context|toasts|banners)|gateway|gateway-connection|policy-state)\.tsx?$/ },
            // The small modules the shell and Today share, and the small ones Today's blocks read (the crew, the schedule's jobs, the decision card, Today's
            // data and model). Left to the bundler each is a chunk of its own, shared by a handful of screens, and a first load fetches every one: a browser
            // keeps six requests going to a host, so a dozen small files are two waves of round trips in front of the first paint where one chunk is none
            // (`npm run perf`: Today's satellites as files of their own were 0.15 s of the first paint). Only what the first screen itself uses is listed: a module named here is in every first load, used or not, so what is shared with a lazy screen but not
            // needed at first (the policy tables, the channel model, the Inbox decision card, the palette) is left out, and loads when it is wanted.
            {
              name: 'landing',
              test: /web\/src\/(shell\/(PageHeader|heading-visibility|focus-heading|StatusBadge|WriteButton|SingleKeySwitch|keyboard-settings|keyboard-context|tier-confirmation)|shortcuts|profile-preferences|restart-to-apply|updates|health|health-view|plain-duration|tiered|tiered-fetch|modules\/profiles\/profile-actions|modules\/inbox\/inbox-actions|shell\/nav-order|shell\/use-now|modules\/crew\/use-crew|modules\/work\/(schedules-data|schedules-model|job-runs)|modules\/today\/(today-model|today-data|DecisionCard)|overlays\/Layer|modules\/logs\/logs-query|live-stream|modules\/inbox\/inbox-model)\.tsx?$|contracts\/policy\/(tiers|guards)\.ts$|@tanstack\/react-router\/dist\/esm\/use(Params|Location)\.js$/,
            },
          ],
        },
      },
    },
  },
});
