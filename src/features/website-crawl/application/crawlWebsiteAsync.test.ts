import { describe, expect, test } from 'bun:test';

import type { CrawlViewport } from '../../../types/public.js';
import { crawlWebsiteAsync } from './crawlWebsiteAsync.js';

describe('crawlWebsiteAsync', () => {
  test(
    'keeps a bounded same-origin page inventory and records robots exclusions',
    testRobotsExclusionAsync,
  );
  test('applies the request limit while retaining every configured viewport', testPageLimitAsync);
  test(
    'bounds redirect aliases by requested URL even when they share one canonical page',
    testRedirectRequestLimitAsync,
  );
  test(
    'deduplicates aliases by final URL while retaining redirect evidence and source-linked observations',
    testCanonicalCaptureIdentityAsync,
  );
  test(
    'reports materially conflicting alias captures instead of merging them',
    testConflictingCanonicalCaptureAsync,
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

const testCanonicalCaptureIdentityAsync = async (): Promise<void> => {
  const result = await crawlWebsiteAsync(
    {
      maxDepth: 1,
      maxPages: 3,
      url: 'https://example.test/',
      viewports: [
        { height: 900, id: 'desktop', width: 1440 },
        { height: 844, id: 'mobile', width: 390 },
      ],
    },
    {
      capturePage: {
        capturePageAsync: canonicalCaptureAsync,
        closeAsync: () => Promise.resolve(),
      },
      robots: { isAllowedAsync: () => Promise.resolve(true) },
    },
  );

  const contact = result.document.pages.find(
    (page) => page.url === 'https://example.test/kontakt/',
  );
  const node = contact?.nodes.find((candidate) => candidate.sourceRef === 'html:0/body:1/a:0');
  expect(result.document.pages).toHaveLength(2);
  expect(contact?.viewports.map((viewport) => viewport.id)).toEqual(['desktop', 'mobile']);
  expect(
    node?.observations.map((observation) => [observation.viewportId, observation.stateId]),
  ).toEqual([
    ['desktop', 'default'],
    ['mobile', 'default'],
  ]);
  expect(result.diagnostics).toContainEqual({
    code: 'redirect',
    finalUrl: 'https://example.test/kontakt/',
    message: 'The requested URL redirected to the canonical final URL.',
    sourceUrl: 'https://example.test/',
    url: 'https://example.test/kontakt',
  });
  expect(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'duplicate' &&
        diagnostic.finalUrl === 'https://example.test/kontakt/' &&
        diagnostic.sourceUrl === 'https://example.test/' &&
        diagnostic.url === 'https://example.test/kontakt/' &&
        diagnostic.viewportId === 'desktop',
    ),
  ).toBe(true);
};

const testRedirectRequestLimitAsync = async (): Promise<void> => {
  const captured = [] as string[];
  const result = await crawlWebsiteAsync(
    { maxDepth: 1, maxPages: 2, url: 'https://example.test/aliases' },
    {
      capturePage: {
        capturePageAsync: ({ url, viewport }) => {
          captured.push(url);
          return Promise.resolve({
            assets: [],
            elements: [],
            links:
              url === 'https://example.test/aliases'
                ? [
                    'https://example.test/alias-1',
                    'https://example.test/alias-2',
                    'https://example.test/alias-3',
                  ]
                : [],
            statusCode: 200,
            title: 'Canonical page',
            url: url === 'https://example.test/aliases' ? url : 'https://example.test/canonical',
            viewport,
          });
        },
        closeAsync: () => Promise.resolve(),
      },
      robots: { isAllowedAsync: () => Promise.resolve(true) },
    },
  );

  expect(captured).toEqual(['https://example.test/aliases', 'https://example.test/alias-1']);
  expect(result.diagnostics).toContainEqual({
    code: 'limit',
    message: 'The configured requested URL limit was reached.',
    sourceUrl: 'https://example.test/aliases',
    url: 'https://example.test/alias-2',
  });
};

const canonicalCaptureAsync = ({
  title,
  url,
  viewport,
}: {
  readonly title?: string;
  readonly url: string;
  readonly viewport: CrawlViewport;
}) =>
  Promise.resolve({
    assets: ['https://example.test/asset.png'],
    elements: [
      {
        attributes: { href: 'https://example.test/kontakt/' },
        css: emptyCss,
        id: 'html:0/body:1/a:0',
        parentId: 'html:0/body:1',
        rect: { height: 20, width: 100, x: 0, y: 0 },
        tagName: 'a',
        text: 'Kontakt',
        visible: true,
      },
    ],
    links:
      url.endsWith('/') && url !== 'https://example.test/kontakt/'
        ? ['https://example.test/kontakt', 'https://example.test/kontakt/']
        : [],
    statusCode: 200,
    title: title ?? 'Kontakt',
    url: url === 'https://example.test/kontakt' ? 'https://example.test/kontakt/' : url,
    viewport,
  });

const testConflictingCanonicalCaptureAsync = async (): Promise<void> => {
  const result = await crawlWebsiteAsync(
    { maxDepth: 1, maxPages: 3, url: 'https://example.test/' },
    {
      capturePage: {
        capturePageAsync: ({ url, viewport }) =>
          canonicalCaptureAsync({ title: url, url, viewport }),
        closeAsync: () => Promise.resolve(),
      },
      robots: { isAllowedAsync: () => Promise.resolve(true) },
    },
  );
  const contact = result.document.pages.find(
    (page) => page.url === 'https://example.test/kontakt/',
  );
  const conflict = result.diagnostics.find((diagnostic) => diagnostic.code === 'conflict');
  expect(contact?.viewports.map((viewport) => viewport.id)).toEqual(['desktop']);
  expect(conflict?.finalUrl).toBe('https://example.test/kontakt/');
  expect(conflict?.captureFingerprint).not.toBe(conflict?.existingCaptureFingerprint);
};

const emptyCss = {
  alignContent: 'normal',
  alignItems: 'normal',
  alignSelf: 'auto',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  backgroundPosition: '0% 0%',
  backgroundRepeat: 'repeat',
  backgroundSize: 'auto',
  borderColor: 'rgb(0, 0, 0)',
  borderRadius: '0px',
  borderWidth: '0px',
  boxShadow: 'none',
  color: 'rgb(0, 0, 0)',
  display: 'block',
  flexBasis: 'auto',
  flexDirection: 'row',
  flexGrow: '0',
  flexShrink: '1',
  flexWrap: 'nowrap',
  fontFamily: 'Arial',
  fontSize: '16px',
  fontStyle: 'normal',
  fontWeight: '400',
  gap: 'normal',
  gridAutoColumns: 'auto',
  gridAutoFlow: 'row',
  gridAutoRows: 'auto',
  gridColumn: 'auto',
  gridColumnEnd: 'auto',
  gridColumnStart: 'auto',
  gridRow: 'auto',
  gridRowEnd: 'auto',
  gridRowStart: 'auto',
  gridTemplateColumns: 'none',
  gridTemplateRows: 'none',
  justifyContent: 'normal',
  justifyItems: 'normal',
  justifySelf: 'auto',
  letterSpacing: 'normal',
  lineHeight: 'normal',
  margin: { bottom: '0px', left: '0px', right: '0px', top: '0px' },
  opacity: '1',
  order: '0',
  overflow: 'visible',
  overflowX: 'visible',
  overflowY: 'visible',
  padding: { bottom: '0px', left: '0px', right: '0px', top: '0px' },
  placeContent: 'normal',
  placeItems: 'normal',
  placeSelf: 'auto',
  position: 'static',
  textAlign: 'start',
  textDecoration: 'none',
  visibility: 'visible',
} as const;
