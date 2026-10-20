// Draws the app's icons: `web/public/icons/*.png` and `icon.svg`. Tooling, run by hand when the artwork changes:
//
//   node web/pwa/render-icons.mjs
//
// The artwork is a caduceus (staff, two snakes, wings) in white on the Nous accent. `any` icons are a rounded square on a
// transparent ground; the maskable and Apple icons are full bleed (the launcher or iOS applies its own shape), with the mark kept
// inside the maskable safe zone (a circle of 80% of the icon's width).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/icons/', import.meta.url));
const ACCENT = '#0053fd';

/** The mark, drawn on a 512 grid and centred on it. */
const MARK = `
  <g fill="#fff" stroke="none">
    <circle cx="256" cy="116" r="22"/>
    <path id="wing" d="M240 176C206 146 156 132 104 138c28 8 50 22 64 40-26-6-48-4-66 6 26 6 46 18 60 34-20-2-36 2-48 12 40 8 84 4 126-14z"/>
    <path d="M272 176c34-30 84-44 136-38-28 8-50 22-64 40 26-6 48-4 66 6-26 6-46 18-60 34 20-2 36 2 48 12-40 8-84 4-126-14z"/>
  </g>
  <g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
    <path d="M256 130V410" stroke-width="20"/>
    <path d="M256 214c82 12 82 74 0 88s-82 76 0 90" stroke-width="22"/>
    <path d="M256 214c-82 12-82 74 0 88s82 76 0 90" stroke-width="22"/>
  </g>`;

/** The whole icon: a rounded square (`any`) or the full canvas (`bleed`), with the mark scaled about the centre. */
function artwork({ bleed, scale }) {
  const ground = bleed ? `<rect width="512" height="512" fill="${ACCENT}"/>` : `<rect width="512" height="512" rx="112" fill="${ACCENT}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${ground}<g transform="translate(256 256) scale(${scale}) translate(-256 -270)">${MARK}</g></svg>`;
}

/** How big the mark is: 1 fills most of a rounded square; a maskable icon's mark must stay inside the central 80% circle. */
const ANY = artwork({ bleed: false, scale: 1 });
const BLEED = artwork({ bleed: true, scale: 0.78 });

const files = [
  { name: 'icon-192.png', size: 192, svg: ANY, transparent: true },
  { name: 'icon-512.png', size: 512, svg: ANY, transparent: true },
  { name: 'icon-maskable-192.png', size: 192, svg: BLEED },
  { name: 'icon-maskable-512.png', size: 512, svg: BLEED },
  { name: 'apple-touch-icon.png', size: 180, svg: BLEED },
];

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}icon.svg`, `${ANY}\n`);
const browser = await chromium.launch();
try {
  for (const { name, size, svg, transparent } of files) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    fs.writeFileSync(`${OUT}${name}`, await page.screenshot({ omitBackground: transparent === true, type: 'png' }));
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`wrote ${files.length + 1} icons to ${OUT}`);
