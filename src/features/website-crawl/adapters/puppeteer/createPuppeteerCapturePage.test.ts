import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createPuppeteerCapturePage } from './createPuppeteerCapturePage.js';

const server = createServer((request, response) => {
  const body =
    request.url === '/about'
      ? '<title>About</title><main>About page</main>'
      : `<title>Fixture</title><nav><a href="/about">About</a></nav><section class="grid"><article>One <span style="color: red">red</span></article><article hidden>Hidden</article><article>Three</article></section>`;
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(
    `<!doctype html><html><head><style>.grid{display:grid;grid-template-columns:repeat(3,1fr)}[hidden]{display:none}</style></head><body>${body}</body></html>`,
  );
});

let origin = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP fixture server');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(
  async () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

describe('createPuppeteerCapturePage', () => {
  test('captures visible and hidden DOM state, computed CSS, and navigation', async () => {
    const capture = await createPuppeteerCapturePage({
      allowPrivateHostsForTests: true,
      launchArguments: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-crash-reporter',
        '--single-process',
      ],
    });
    const page = await capture.capturePageAsync({
      maxBytes: 100_000,
      origin,
      timeoutMs: 10_000,
      url: `${origin}/`,
      viewport: { height: 800, id: 'desktop', width: 1440 },
    });
    await capture.closeAsync();

    expect(page.links).toEqual([`${origin}/about`]);
    expect(page.elements.find((element) => element.text === 'red')?.css.color).toContain('255');
    expect(page.elements.find((element) => element.text === 'One ')?.tagName).toBe('article');
    expect(page.elements.find((element) => element.text === 'Hidden')?.visible).toBe(false);
    expect(page.elements.some((element) => element.css.display === 'grid')).toBe(true);
  });
});
