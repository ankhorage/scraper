import { expect, test } from 'bun:test';

import { crawlWebsiteAsync } from './crawlWebsiteAsync.js';

test('requests only the start page at an explicit zero depth', async () => {
  const requestedUrls: string[] = [];
  await crawlWebsiteAsync(
    { maxDepth: 0, maxPages: 5, url: 'https://example.test/' },
    {
      capturePage: {
        capturePageAsync: ({ url, viewport }) => {
          requestedUrls.push(url);
          return Promise.resolve({
            assets: [],
            elements: [],
            links: ['https://example.test/about'],
            statusCode: 200,
            title: 'Home',
            url,
            viewport,
          });
        },
        closeAsync: () => Promise.resolve(),
      },
      robots: { isAllowedAsync: () => Promise.resolve(true) },
    },
  );

  expect(requestedUrls).toEqual(['https://example.test/']);
});
