// Gives the smoke browser's session a step-up grant (about 5 minutes) with a software passkey.
import fs from 'node:fs';
import { addPasskey, stepUp } from '../../../server/test/fixtures/step-up.ts';

const url = process.env.URL ?? 'http://127.0.0.1:9210';
const cookie = fs.readFileSync('/tmp/caduceus-m4-10-cookie', 'utf8').trim();
await stepUp(url, cookie, await addPasskey(url, cookie, 'smoke'));
console.log('stepped up');
