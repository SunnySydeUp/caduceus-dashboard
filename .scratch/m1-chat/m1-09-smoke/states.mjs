// Throwaway: the states of M1 #09 for the gates (steps run after the route has loaded).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const type = async (page, text) => {
  await page.waitForSelector('#chat-message');
  await sleep(1500);
  await page.focus('#chat-message');
  await page.keyboard.type(text);
  await sleep(1400);
};
const select = async (page) => {
  await page.waitForSelector('.msg-agent');
  await sleep(1500);
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.msg-agent p')].at(-1);
    const range = document.createRange();
    range.selectNodeContents(p);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await sleep(900);
};

export const STATES = {
  slash: { route: '/chat/new', steps: (page) => type(page, '/s') },
  argument: { route: '/chat/new', steps: (page) => type(page, '/personality ') },
  path: { route: '/chat/new', steps: (page) => type(page, 'read @') },
  note: {
    route: '/chat/new',
    steps: async (page) => {
      await type(page, '/usage');
      await page.keyboard.press('Escape');
      await page.keyboard.down('Meta');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Meta');
      await page.waitForSelector('.cnote', { timeout: 20000 });
      await sleep(500);
    },
  },
  denied: {
    route: '/chat/new',
    steps: async (page) => {
      await type(page, '/update');
      await page.keyboard.press('Escape');
      await page.keyboard.down('Meta');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Meta');
      await page.waitForSelector('.cnote', { timeout: 20000 });
      await sleep(500);
    },
  },
  selection: { route: '/chat/smoke-code', steps: (page) => select(page) },
  'selection-menu': {
    route: '/chat/smoke-code',
    steps: async (page) => {
      await select(page);
      const bar = await page.$('.selbar button');
      if (bar) {
        await bar.evaluate((el) => el.click());
        await sleep(700);
      }
    },
  },
};
