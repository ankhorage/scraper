import { expect, test } from 'bun:test';

import { crawlWebsiteAsync } from './crawlWebsiteAsync.js';

test('discovers page-specific viewport regions before capture', async () => {
  const captured: string[] = [];
  const result = await crawlWebsiteAsync(
    { maxDepth: 1, maxPages: 2, url: 'https://example.test/' },
    automaticDependencies(captured),
  );
  expect(captured).toEqual([
    'https://example.test/:320',
    'https://example.test/:600',
    'https://example.test/about:320',
    'https://example.test/about:900',
  ]);
  expect(result.breakpointEvidence.map((item) => item.condition)).toEqual([
    '(min-width: 600px)',
    '(min-width: 900px)',
  ]);
});

test('preserves explicit viewports as a complete discovery override', async () => {
  const result = await crawlWebsiteAsync(
    { url: 'https://example.test/', viewports: [{ height: 800, id: 'manual', width: 777 }] },
    {
      capturePage: {
        capturePageAsync: ({ url, viewport }) =>
          Promise.resolve({
            assets: [],
            elements: [],
            links: [],
            statusCode: 200,
            title: url,
            url,
            viewport,
          }),
        closeAsync: () => Promise.resolve(),
        discoverBreakpointsAsync: () => Promise.reject(new Error('must not discover')),
      },
      robots: { isAllowedAsync: () => Promise.resolve(true) },
    },
  );
  expect(result.breakpointEvidence).toEqual([]);
  expect(result.document.pages[0]?.viewports[0]?.id).toBe('manual');
});

/*** Provide deterministic page-local stylesheet evidence without a browser dependency. */
const automaticDependencies = (captured: string[]) => ({
  capturePage: {
    capturePageAsync: capturePageAsync(captured),
    closeAsync: () => Promise.resolve(),
    discoverBreakpointsAsync: discoverBreakpointsAsync,
    probeResponsiveAsync: probeResponsiveAsync,
  },
  robots: { isAllowedAsync: () => Promise.resolve(true) },
});

/*** Record deterministic captures while reproducing one responsive page-local link. */
const capturePageAsync =
  (captured: string[]) =>
  ({ url, viewport }: { readonly url: string; readonly viewport: { readonly width: number } }) => {
    captured.push(`${url}:${viewport.width}`);
    return Promise.resolve({
      assets: [],
      elements: [],
      links: url.endsWith('/') ? ['https://example.test/about'] : [],
      statusCode: 200,
      title: url,
      url,
      viewport: { ...viewport, height: 900, id: `auto-${viewport.width}` },
    });
  };

/*** Return the responsive CSS condition associated with each deterministic fixture page. */
const discoverBreakpointsAsync = ({ url }: { readonly url: string }) =>
  Promise.resolve([
    {
      condition: url.endsWith('/') ? '(min-width: 600px)' : '(min-width: 900px)',
      kind: 'viewport' as const,
      source: url.endsWith('/') ? 'home' : 'about',
      sourceUrl: url,
    },
  ]);

/*** Model distinct browser layout signatures on either side of the page-local breakpoint. */
const probeResponsiveAsync = ({
  url,
  widths,
}: {
  readonly url: string;
  readonly widths: readonly number[];
}) =>
  Promise.resolve(
    widths.map((width) => {
      const breakpoint = url.endsWith('/') ? 600 : 900;
      return {
        conditionMatches: width >= breakpoint ? ['matched'] : [],
        hasHorizontalOverflow: false,
        layout: [width >= breakpoint ? 'desktop' : 'mobile'],
        navigation: [],
        width,
      };
    }),
  );
