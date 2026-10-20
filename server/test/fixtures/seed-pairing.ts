// Puts a pairing request into a throwaway HERMES_HOME the way a messaging gateway would when a stranger writes to the bot: through
// Hermes's own `PairingStore`, which keeps only a salted hash of the code it would have sent them. Nothing in Caduceus knows it.
import { runProgram } from './run-program.ts';
import { hermesPython, hermesSourceRoot } from './seed-session.ts';

/** A stranger's first message to `platform`'s bot: Hermes records a pending request for `userId` (`profile` is a named profile; omitted, the home's own). */
export async function seedPairingRequest(home: string, platform: string, userId: string, userName: string, profile?: string): Promise<void> {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(hermesSourceRoot())})
from gateway.pairing import PairingStore
platform, user_id, user_name, profile = json.load(sys.stdin)
store = PairingStore(profile=profile) if profile else PairingStore()
if store.generate_code(platform, user_id, user_name) is None:
    raise SystemExit('Hermes would not issue a code (rate limit, lockout or three pending already)')
`;
  await runProgram(hermesPython(), ['-c', script], { input: JSON.stringify([platform, userId, userName, profile ?? null]), env: { ...process.env, HERMES_HOME: home } });
}

/** An approved user, as `hermes pairing approve` leaves them (the code is made and used in one step). */
export async function seedApprovedUser(home: string, platform: string, userId: string, userName: string): Promise<void> {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(hermesSourceRoot())})
from gateway.pairing import PairingStore
platform, user_id, user_name = json.load(sys.stdin)
store = PairingStore()
code = store.generate_code(platform, user_id, user_name)
if code is None or store.approve_code(platform, code) is None:
    raise SystemExit('Hermes would not approve the seeded user')
`;
  await runProgram(hermesPython(), ['-c', script], { input: JSON.stringify([platform, userId, userName]), env: { ...process.env, HERMES_HOME: home } });
}
