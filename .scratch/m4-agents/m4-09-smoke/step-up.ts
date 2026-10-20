// Gives the smoke browser's session a step-up grant (about 5 minutes) with a software passkey, since a headless browser cannot answer a passkey prompt.
import fs from 'node:fs';
import { addPasskey, stepUp } from '../../../server/test/fixtures/step-up.ts';

const url = process.env.URL ?? 'http://127.0.0.1:9250';
const cookie = fs.readFileSync('/tmp/caduceus-m4-09-cookie', 'utf8').trim();
const authenticator = await addPasskey(url, cookie, 'smoke');
await stepUp(url, cookie, authenticator);
console.log('stepped up');
