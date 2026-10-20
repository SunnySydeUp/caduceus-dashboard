import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { REST_OPERATIONS } from '@caduceus/contracts/policy/rest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const filesBelow = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesBelow(path.join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [path.join(dir, entry.name)] : []));

// Make default is the only action that writes Hermes's sticky active profile (information architecture §6). Hermes has one
// route that does it, and the policy map makes it Tier 2; this holds the web app to that one route having one caller.
test('the only code in the web app that writes Hermes\'s active profile is Make default, and the route is Tier 2', () => {
  expect(Object.entries(REST_OPERATIONS).filter(([line]) => /^(POST|PUT|PATCH|DELETE) \/api\/profiles\/active$/.test(line)).map(([line, policy]) => [line, policy.tier])).toEqual([['POST /api/profiles/active', 'T2']]);

  const mentions = filesBelow(SRC)
    .filter((file) => fs.readFileSync(file, 'utf8').includes('/api/profiles/active'))
    .map((file) => path.relative(SRC, file))
    .sort();
  // The shell, the data module and the model only read it (GET, or a comment about it); `make-default.ts` is the one writer.
  expect(mentions).toEqual(['modules/profiles/make-default.ts', 'modules/profiles/profiles-data.ts', 'modules/profiles/profiles-model.ts', 'profile-scope.ts']);
  const writers = mentions.filter((file) => /method:\s*'(POST|PUT|PATCH|DELETE)'/.test(fs.readFileSync(path.join(SRC, file), 'utf8')));
  expect(writers).toEqual(['modules/profiles/make-default.ts']);
});
