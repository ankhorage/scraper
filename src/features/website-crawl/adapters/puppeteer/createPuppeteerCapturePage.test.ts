import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createPuppeteerCapturePage } from './createPuppeteerCapturePage.js';

const fixtureBody = (url: string | undefined): string =>
  url === '/dynamic'
    ? `<style>body{margin:0}.spacer{height:1200px}.track{width:200px;height:20px}.progress-fill{width:0;height:20px;transition:width 80ms linear;background:green}</style><div class="spacer"></div><div class="track"><div class="progress-fill" role="progressbar" aria-valuenow="72"></div></div><script>new IntersectionObserver(([entry])=>{if(entry.isIntersecting)requestAnimationFrame(()=>document.querySelector('.progress-fill').style.width='144px')}).observe(document.querySelector('.progress-fill'))</script>`
    : url === '/about'
      ? '<title>About</title><main>About page</main>'
      : `<title>Fixture</title><nav><a href="/about">About</a></nav><section class="grid"><article>One <span style="color: red">red</span></article><article hidden>Hidden</article><article>Three</article></section>`;

const server = createServer((request, response) => {
  const body = fixtureBody(request.url);
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

const captureFixtureAsync = async (
  path: string,
  viewport: { height: number; id: string; width: number },
  timeoutMs = 10_000,
) => {
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
  try {
    return await capture.capturePageAsync({
      maxBytes: 100_000,
      timeoutMs,
      url: `${origin}${path}`,
      viewport,
    });
  } finally {
    await capture.closeAsync();
  }
};

describe('createPuppeteerCapturePage', () => {
  test('captures visible and hidden DOM state, computed CSS, and navigation', async () => {
    const page = await captureFixtureAsync('/', { height: 800, id: 'desktop', width: 1440 });

    expect(page.links).toEqual([`${origin}/about`]);
    expect(page.elements.find((element) => element.text === 'red')?.css.color).toContain('255');
    expect(page.elements.find((element) => element.text === 'One ')?.tagName).toBe('article');
    expect(page.elements.find((element) => element.text === 'Hidden')?.visible).toBe(false);
    expect(page.elements.some((element) => element.css.display === 'grid')).toBe(true);
  });

  test('retains initial zero-width and settled viewport-triggered progress evidence', async () => {
    const page = await captureFixtureAsync(
      '/dynamic',
      { height: 400, id: 'narrow', width: 320 },
      2_000,
    );

    const progress = page.dynamicElements?.find(
      (evidence) => evidence.initial.element.attributes['aria-valuenow'] === '72',
    );
    expect(progress?.initial.element.rect.width).toBe(0);
    expect(progress?.outcome).toBe('settled');
    expect(progress?.settled?.element.rect.width).toBe(144);
  });
});
