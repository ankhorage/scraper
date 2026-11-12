import { expect, test } from 'bun:test';

import type { CrawlViewport, PageObservation } from '../../../types/public.js';
import { crawlWebsiteAsync } from './crawlWebsiteAsync.js';

test('skips responsive work for a verified redirect alias after canonical capture', async () => {
  const calls = { captures: 0, discoveries: 0, probes: 0, resolutions: 0 };
  const result = await crawlWebsiteAsync(
    { maxDepth: 1, url: 'https://example.test/', viewports: [desktop] },
    {
      capturePage: {
        capturePageAsync: ({ url, viewport }) => {
          calls.captures += 1;
          return Promise.resolve(
            observation(canonical(url), viewport, url === 'https://example.test/' ? aliases : []),
          );
        },
        closeAsync: () => Promise.resolve(),
        discoverBreakpointsAsync: () => {
          calls.discoveries += 1;
          return Promise.resolve([]);
        },
        probeResponsiveAsync: () => {
          calls.probes += 1;
          return Promise.resolve([]);
        },
        resolvePageAsync: ({ url }) => {
          calls.resolutions += 1;
          return Promise.resolve({ url: canonical(url) });
        },
      },
      robots: { isAllowedAsync: () => Promise.resolve(true) },
    },
  );

  expect(calls.captures).toBe(2);
  expect(calls.discoveries).toBe(0);
  expect(calls.probes).toBe(0);
  expect(calls.resolutions).toBe(3);
  const duplicate = result.diagnostics.find(
    (diagnostic) =>
      diagnostic.code === 'duplicate' && diagnostic.url === 'https://example.test/about/',
  );
  expect(duplicate?.message).toBe(
    'A verified redirect alias was skipped before responsive discovery and capture.',
  );
  expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'redirect')).toHaveLength(1);
});

test('does not infer equivalence for distinct slash-sensitive 200 resources', async () => {
  const captured: string[] = [];
  await crawlWebsiteAsync(
    { maxDepth: 1, url: 'https://example.test/', viewports: [desktop] },
    {
      capturePage: {
        capturePageAsync: ({ url, viewport }) => {
          captured.push(url);
          return Promise.resolve(
            observation(url, viewport, url === 'https://example.test/' ? slashResources : []),
          );
        },
        closeAsync: () => Promise.resolve(),
        resolvePageAsync: ({ url }) => Promise.resolve({ url }),
      },
      robots: { isAllowedAsync: () => Promise.resolve(true) },
    },
  );

  expect(captured).toEqual([
    'https://example.test/',
    'https://example.test/test',
    'https://example.test/test/',
  ]);
});

const desktop: CrawlViewport = { height: 900, id: 'desktop', width: 1440 };
const aliases = ['https://example.test/about', 'https://example.test/about/'];
const slashResources = ['https://example.test/test', 'https://example.test/test/'];

/*** Model only server-proven redirects; no path normalization is used as identity. */
const canonical = (url: string): string =>
  url === 'https://example.test/about' ? 'https://example.test/about/' : url;

/*** Return the minimum complete browser observation required by crawler orchestration tests. */
const observation = (
  url: string,
  viewport: CrawlViewport,
  links: readonly string[],
): PageObservation => ({
  assets: [],
  elements: [],
  links,
  statusCode: 200,
  title: url,
  url,
  viewport,
});
