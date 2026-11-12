import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createWebsiteCrawler } from '../../../index.js';

let origin = '';
let server: Server;

beforeAll(async () => {
  server = createFixtureServer();
  origin = await listenAsync(server);
});

afterAll(async () => closeAsync(server));

describe('createWebsiteCrawler public acceptance', () => {
  test(
    'crawls two pages and viewports through the real Chromium-backed public endpoint',
    testCrawlerAsync,
    30_000,
  );
  test(
    'deduplicates redirected aliases through the real Chromium-backed public endpoint',
    testRedirectCanonicalizationAsync,
    30_000,
  );
});

const testCrawlerAsync = async (): Promise<void> => {
  const crawler = createWebsiteCrawler({
    allowPrivateHostsForTests: true,
    launchArguments: chromiumLaunchArguments,
  });
  const result = await crawler.crawlWebsiteAsync({
    maxDepth: 1,
    maxPages: 2,
    navigationTimeoutMs: 10_000,
    url: `${origin}/`,
    viewports: [
      { height: 900, id: 'desktop', width: 1440 },
      { height: 800, id: 'tablet', width: 768 },
    ],
  });
  const home = result.document.pages.find((page) => page.url === `${origin}/`);
  const about = result.document.pages.find((page) => page.url === `${origin}/about`);
  const red = home?.nodes.find((node) => node.textRuns.some((run) => run.text === 'red'));
  expect(result.diagnostics).toEqual([]);
  expect(result.document.pages).toHaveLength(2);
  expect(home?.viewports.map((viewport) => viewport.id)).toEqual(['desktop', 'tablet']);
  expect(about?.viewports.map((viewport) => viewport.id)).toEqual(['desktop', 'tablet']);
  expect(home?.nodes.filter((node) => node.dom.tagName === 'article')).toHaveLength(3);
  expect(red?.observations[0]?.css?.color).toContain('255');
  expect(
    home?.nodes.some(
      (node) =>
        node.textRuns.some((run) => run.text === 'Hidden') &&
        node.observations.every((observation) => observation.css?.display === 'none'),
    ),
  ).toBe(true);
  expect(home?.navigation).toHaveLength(1);
  expect(home?.navigation[0]?.url).toBe(`${origin}/about`);
  expect(typeof home?.navigation[0]?.sourceRef).toBe('string');
};

const testRedirectCanonicalizationAsync = async (): Promise<void> => {
  const crawler = createWebsiteCrawler({
    allowPrivateHostsForTests: true,
    launchArguments: chromiumLaunchArguments,
  });
  const result = await crawler.crawlWebsiteAsync({
    maxDepth: 1,
    maxPages: 3,
    navigationTimeoutMs: 10_000,
    url: `${origin}/aliases`,
    viewports: [
      { height: 900, id: 'desktop', width: 1440 },
      { height: 844, id: 'mobile', width: 390 },
    ],
  });
  const aliases = result.document.pages.find((page) => page.url === `${origin}/aliases`);
  const contact = result.document.pages.find((page) => page.url === `${origin}/kontakt/`);
  const contactMain = contact?.nodes.find((node) => node.dom.tagName === 'main');
  const sourceRefs = contact?.nodes.map((node) => node.sourceRef) ?? [];
  expect(result.document.pages).toHaveLength(2);
  expect(contact?.viewports.map((viewport) => viewport.id)).toEqual(['desktop', 'mobile']);
  expect(new Set(sourceRefs).size).toBe(sourceRefs.length);
  expect(aliases?.navigation.map((item) => item.url)).toEqual([
    `${origin}/kontakt`,
    `${origin}/kontakt/`,
  ]);
  expect(contact?.assets.map((asset) => asset.url)).toEqual([`${origin}/contact.png`]);
  expect(contactMain?.observations[0]?.css?.color).toBe('rgb(255, 0, 0)');
  expect(contactMain?.observations[0]?.provenance.sourceUrl).toBe(`${origin}/kontakt/`);
  expect(
    contact?.nodes.every(
      (node) =>
        new Set(
          node.observations.map(
            (observation) => `${observation.viewportId}:${observation.stateId}`,
          ),
        ).size === node.observations.length,
    ),
  ).toBe(true);
  expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'redirect')).toBe(true);
  expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'duplicate')).toBe(true);
};

const createFixtureServer = (): Server =>
  createServer((request, response) => {
    if (request.url === '/kontakt') {
      response.writeHead(302, { location: '/kontakt/' });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(
      request.url === '/about'
        ? aboutPage
        : request.url === '/aliases'
          ? aliasesPage
          : request.url === '/kontakt/'
            ? contactPage
            : homePage,
    );
  });

const listenAsync = async (fixture: Server): Promise<string> => {
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const address = fixture.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture server.');
  return `http://127.0.0.1:${address.port}`;
};

const closeAsync = async (fixture: Server): Promise<void> =>
  new Promise<void>((resolve, reject) =>
    fixture.close((error) => (error ? reject(error) : resolve())),
  );

const chromiumLaunchArguments = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-crash-reporter',
  '--single-process',
] as const;

const homePage = `<!doctype html>
<html><head><style>
.grid { display: grid; grid-template-columns: repeat(3, 1fr); }
.hidden { display: none; }
</style></head><body>
<nav><a href="/about">About</a></nav>
<section class="grid"><article>One <span style="color: red">red</span></article><article class="hidden">Hidden</article><article>Three</article></section>
</body></html>`;

const aboutPage = '<!doctype html><html><body><main>About page</main></body></html>';
const aliasesPage =
  '<!doctype html><html><body><a href="/kontakt">Contact</a><a href="/kontakt/">Contact canonical</a></body></html>';
const contactPage =
  '<!doctype html><html><body><main style="color:red">Contact page</main><img src="/contact.png" alt="Contact"></body></html>';
