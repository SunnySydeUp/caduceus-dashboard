## What and why

<!-- What changes, and the problem it solves. Link the issue. -->

## How it was tested

<!-- The test that failed before and passes now. For UI: the widths you checked (390, 320, 820, 1440). -->

## Checklist

- [ ] Typecheck passes (`npx tsc -p server --noEmit && npx tsc -p web --noEmit`)
- [ ] `npm test` passes (or: which files you ran, and why not all)
- [ ] `npm run lint:ui` passes (UI changes)
- [ ] New Hermes operations have a tier in `contracts/policy/`
- [ ] No security rule in `AGENTS.md` is weakened
- [ ] Every new route has help in its module's `help.ts`
