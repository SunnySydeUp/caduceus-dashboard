// Runs the M0 #05 gates (`../m0-05-smoke/ui-gates.mjs`) for every route at the four sizes in each skin, light and dark, plus with
// the layers open (profile sheet, palette, `?` sheet, nav drawer). Throwaway, not part of `npm test`.
//
//   const summary = await tab.run(({ page }, cfg) => import(cfg.matrix).then((m) => m.runMatrix(page, cfg)),
//     { args: [{ matrix: '/…/m0-07-smoke/gates-matrix.mjs', gates: '/…/m0-05-smoke/ui-gates.mjs', url: 'http://127.0.0.1:9170',
//               shots: '/…/m0-07-smoke', skins: ['nous', 'hermes'], schemes: ['dark', 'light'] }], timeout: 280000 });
//
// `density` and `textSize` apply to every run (default auto and 100%). Screenshots are kept only for Settings › Appearance at
// the phone and desktop sizes, one per skin and scheme; the other runs are checked and not saved.
const ROUTES = [
  ['home', '/home'],
  ['health', '/observe/health'],
  ['settings', '/settings'],
  ['appearance', '/settings/appearance'],
  ['keyboard', '/settings/keyboard'],
  ['security', '/system/security'],
  ['more', '/more'],
  ['not-found', '/no/such/page'],
  ['sign-in', '/sign-in'],
];
const LAYER_ROUTES = [
  ['home', '/home'],
  ['appearance', '/settings/appearance'],
  ['health', '/observe/health'],
  ['security', '/system/security'],
  ['sign-in', '/sign-in'],
];
const LAYERS = ['profile', 'search', 'help', 'helpButton', 'term', 'helpTerm', 'signInHelp', 'drawer'];

export async function runMatrix(page, { gates, url, shots, skins, schemes, density = 'auto', textSize = 'md', layers = true, layerNames = LAYERS, baseRoutes = true, widths, cookie }) {
  const { checkRoute, WIDTHS: ALL_WIDTHS } = await import(gates);
  // A browser cell lasts at most five minutes: `widths` (e.g. [390, 320]) splits a run into cells.
  const WIDTHS = widths ? ALL_WIDTHS.filter((size) => widths.includes(size.width)) : ALL_WIDTHS;
  const summary = { runs: 0, skipped: 0, failures: [], axeMinor: new Set() };
  // The sign-in screen sends a signed-in browser away (to Home): it is measured signed out, with `cookie` ("caduceus_session=…") put back after.
  const [cookieName, ...cookieValue] = (cookie ?? '').split('=');
  for (const skin of skins) {
    for (const scheme of schemes) {
      const run = async (name, route, size, open) => {
        const saved = !open && name === 'appearance' && (size.width === 390 || size.width === 1440) ? shots : undefined;
        await page.bringToFront();
        const where = `${skin}/${scheme}/${size.width}${open ? '/' + open : ''} ${route}`;
        let result;
        const signedOut = name === 'sign-in' && cookie;
        if (signedOut) await page.deleteCookie({ name: cookieName, url });
        try {
          result = await checkRoute(page, { url, route, ...size, name: open ? `${name}-${open}` : name, shots: saved, open, scheme, skin, density, textSize });
        } catch (error) {
          // One run that cannot complete is a failure of that run, not the end of the matrix.
          summary.failures.push(`${where}: did not complete: ${String(error.message).slice(0, 160)}`);
          return;
        } finally {
          if (signedOut) await page.setCookie({ name: cookieName, value: cookieValue.join('='), url });
        }
        if (result.skipped) summary.skipped++;
        else summary.runs++;
        for (const minor of result.axeMinor ?? []) summary.axeMinor.add(minor);
        if (!result.ok) summary.failures.push(`${where}: ${result.problems.join(' | ')}`);
      };
      if (baseRoutes) for (const size of WIDTHS) for (const [name, route] of ROUTES) await run(name, route, size);
      if (layers) for (const size of WIDTHS) for (const [name, route] of LAYER_ROUTES) for (const open of layerNames) await run(name, route, size, open);
    }
  }
  return { runs: summary.runs, skipped: summary.skipped, failures: summary.failures, axeMinor: [...summary.axeMinor] };
}
