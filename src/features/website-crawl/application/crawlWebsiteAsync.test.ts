import { describe, expect, test } from 'bun:test';

import { crawlWebsiteAsync } from './crawlWebsiteAsync.js';

describe('crawlWebsiteAsync', () => {
  test('keeps a bounded same-origin page inventory and records robots exclusions', async () => {
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

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.url).toBe('https://example.test/');
  });
});
