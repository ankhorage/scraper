import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, expect, test } from 'bun:test';

import { createWebsiteCrawler } from '../../../index.js';

let externalOrigin = '';
let externalRequests = 0;
let externalServer: Server;
let origin = '';
let server: Server;

beforeAll(async () => {
  externalServer = createServer((_request, response) => {
    externalRequests += 1;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><html><body>external</body></html>');
  });
  externalOrigin = await listenAsync(externalServer);
  server = createServer((_request, response) => {
    response.writeHead(302, { location: `${externalOrigin}/private` });
    response.end();
  });
  origin = await listenAsync(server);
});

afterAll(async () => {
  await closeAsync(server);
  await closeAsync(externalServer);
});

test('blocks a cross-origin redirect before Chromium requests its target', async () => {
  const crawler = createWebsiteCrawler({
    allowPrivateHostsForTests: true,
    launchArguments: chromiumLaunchArguments,
  });
  const result = await crawler.crawlWebsiteAsync({
    maxDepth: 0,
    maxPages: 1,
    navigationTimeoutMs: 10_000,
    url: origin,
    viewports: [{ height: 900, id: 'desktop', width: 1440 }],
  });
  expect(externalRequests).toBe(0);
  expect(result.document.pages).toEqual([]);
  expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'unreachable')).toBe(true);
}, 30_000);

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
