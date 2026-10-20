// Throwaway: the states of M1 #10 for the gates (steps run after the route has loaded). Test files are in /tmp/m110.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const upload = async (page, ...files) => {
  await page.waitForSelector('#chat-message');
  await sleep(1200);
  const input = await page.$('input[data-attach="files"]');
  await input.uploadFile(...files);
  await page.waitForSelector('.attach-chips');
  await sleep(600);
};
const base = ['/tmp/m110/dot.png', '/tmp/m110/report.pdf', '/tmp/m110/notes.txt', '/tmp/m110/bundle.zip'];

export const STATES = {
  chips: { route: '/chat/new', steps: (page) => upload(page, ...base) },
  menu: {
    route: '/chat/new',
    steps: async (page) => {
      await upload(page, ...base);
      await page.click('button[aria-label="Attach"]');
      await page.waitForSelector('.attach__menu');
      await sleep(300);
    },
  },
  many: {
    route: '/chat/new',
    steps: async (page) => {
      await upload(page, ...Array.from({ length: 22 }, (_, n) => `/tmp/m110/many/f${n + 1}.txt`));
      await page.waitForSelector('.attach-notes');
    },
  },
  paste: {
    route: '/chat/new',
    steps: async (page) => {
      await page.waitForSelector('#chat-message');
      await sleep(1200);
      await page.evaluate(() => {
        const data = new DataTransfer();
        data.setData('text/plain', 'a long paste. '.repeat(400));
        document.querySelector('#chat-message').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      });
      await page.waitForSelector('.attach-chip');
      await sleep(500);
    },
  },
  dropping: {
    route: '/chat/new',
    steps: async (page) => {
      await page.waitForSelector('#chat-message');
      await sleep(1200);
      await page.evaluate(() => {
        const data = new DataTransfer();
        data.items.add(new File(['x'], 'dragged.txt'));
        document.querySelector('.chat__composer').dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
      });
      await page.waitForSelector('.composer__drop');
      await sleep(300);
    },
  },
  sent: {
    route: '/chat/new',
    steps: async (page) => {
      await upload(page, ...base);
      await page.type('#chat-message', 'Look at these');
      await page.click('button[type=submit]');
      await page.waitForSelector('.msg-atts img', { timeout: 20000 });
      await sleep(3000);
    },
  },
};
