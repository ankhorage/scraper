import { describe, expect, test } from 'bun:test';

import { crawlWebsiteAsync } from './crawlWebsiteAsync.js';

describe('crawlWebsiteAsync', () => {
  test(
    'keeps a bounded same-origin page inventory and records robots exclusions',
    testRobotsExclusionAsync,
  );
  test(
    'applies the page limit to distinct URLs while retaining every configured viewport',
    testPageLimitAsync,
  );
});

const testRobotsExclusionAsync = async (): Promise<void> => {
  const result = await crawlWebsiteAsync(
    { maxDepth: 1, maxPages: 5, url: 'https://example.test/' },
    {
      capturePage: {
        capturePageAsync: ({ url, viewport }) =>
          Promise.resolve({
            assets: [],
            elements: [],
            links: url.endsWith('/') ? ['https://example.test/about', 'https://other.test/'] : [],
            statusCode: 200,
            title: url,
            url,
            viewport,
          }),
        closeAsync: () => Promise.resolve(),
      },
      robots: { isAllowedAsync: (url) => Promise.resolve(!url.endsWith('/about')) },
    },
  );

  expect(result.document.pages).toHaveLength(1);
  expect(result.document.pages[0]?.url).toBe('https://example.test/');
  expect(result.diagnostics).toEqual([
    {
      code: 'robots',
      message: 'robots.txt disallowed this URL.',
      sourceUrl: 'https://example.test/',
      url: 'https://example.test/about',
    },
  ]);
};

const testPageLimitAsync = async (): Promise<void> => {
  const captured = [] as { url: string; viewportId: string }[];
  const result = await crawlWebsiteAsync(
    {
      maxDepth: 1,
      maxPages: 2,
      url: 'https://example.test/',
      viewports: [
        { height: 900, id: 'desktop', width: 1440 },
        { height: 800, id: 'tablet', width: 768 },
      ],
    },
    {
      capturePage: {
        capturePageAsync: ({ url, viewport }) => {
          captured.push({ url, viewportId: viewport.id });
          return Promise.resolve({
            assets: [],
            elements: [],
            links: url.endsWith('/') ? ['https://example.test/about'] : [],
            statusCode: 200,
            title: url,
            url,
            viewport,
          });
        },
        closeAsync: () => Promise.resolve(),
      },
      robots: { isAllowedAsync: () => Promise.resolve(true) },
    },
  );

  expect(result.document.pages).toHaveLength(2);
  expect(captured).toEqual([
    { url: 'https://example.test/', viewportId: 'desktop' },
    { url: 'https://example.test/', viewportId: 'tablet' },
    { url: 'https://example.test/about', viewportId: 'desktop' },
    { url: 'https://example.test/about', viewportId: 'tablet' },
  ]);
};
