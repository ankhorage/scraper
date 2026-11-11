import { createHash } from 'node:crypto';

import type {
  WebsiteObservationDocument,
  WebsiteObservedNode,
  WebsitePageObservation,
} from '@ankhorage/contracts/website';

import type { CrawlDiagnostic, PageObservation } from '../../../types/public.js';

/*** Convert browser facts into the published portable website observation document. */
export const toWebsiteObservationDocument = (
  sourceUrl: string,
  pages: readonly PageObservation[],
  diagnostics: readonly CrawlDiagnostic[],
): WebsiteObservationDocument => {
  const collectedAt = new Date().toISOString();
  const siteId = hash(sourceUrl);
  return {
    collectedAt,
    documentId: `website:${siteId}`,
    pages: groupPages(pages, collectedAt),
    schemaVersion: 1,
    site: { id: siteId, url: sourceUrl },
    source: {
      crawlId: hash(`${sourceUrl}:${collectedAt}`),
      crawlerId: '@ankhorage/scraper',
      crawlerVersion: '0.1.0',
      revision: diagnostics.length === 0 ? null : `diagnostics:${diagnostics.length}`,
    },
  };
};

/*** Group one capture per viewport into a single canonical page record. */
const groupPages = (
  pages: readonly PageObservation[],
  collectedAt: string,
): WebsitePageObservation[] =>
  [
    ...new Map(
      pages.map((page) => [page.url, pages.filter((candidate) => candidate.url === page.url)]),
    ).entries(),
  ].map(([url, captures]) => ({
    assets: collectAssets(captures),
    id: hash(url),
    navigation: collectNavigation(captures[0]),
    nodes: collectNodes(captures, collectedAt),
    path: new URL(url).pathname,
    states: [{ id: 'default', name: 'default' }],
    url,
    viewports: captures.map(({ viewport }) => ({ ...viewport, devicePixelRatio: 1 })),
  }));

/*** Retain every stable DOM node once and append its viewport-specific observations. */
const collectNodes = (
  pages: readonly PageObservation[],
  collectedAt: string,
): WebsiteObservedNode[] => {
  const elements = pages.flatMap((page) => page.elements.map((element) => ({ element, page })));
  return [...new Map(elements.map(({ element }) => [element.id, element])).values()].map(
    (element) => ({
      ancestorSourceRefs: ancestors(element.id),
      dom: {
        attributes: element.attributes,
        childIndex: childIndex(element.id),
        tagName: element.tagName,
      },
      links: element.attributes.href
        ? [{ label: element.text || null, sourceRef: element.id, url: element.attributes.href }]
        : [],
      media: element.attributes.src
        ? [
            {
              alt: element.attributes.alt ?? null,
              assetId: hash(element.attributes.src),
              kind: mediaKind(element.tagName),
              sourceRef: element.id,
              url: element.attributes.src,
            },
          ]
        : [],
      observations: elements
        .filter((candidate) => candidate.element.id === element.id)
        .map(({ element: captured, page }) => ({
          availability: { missing: null, status: 'available' },
          css: captured.css,
          provenance: { capturedAt: collectedAt, method: 'browser', sourceUrl: page.url },
          rect: captured.rect,
          stateId: 'default',
          viewportId: page.viewport.id,
        })),
      parentSourceRef: element.parentId ?? null,
      sourceRef: element.id,
      textRuns: element.text
        ? [{ end: element.text.length, sourceRef: element.id, start: 0, text: element.text }]
        : [],
    }),
  );
};

/*** Deduplicate safe navigation observations in document order. */
const collectNavigation = (page: PageObservation | undefined) =>
  page
    ? [...new Set(page.links)].map((url) => ({
        id: hash(url),
        label: '',
        sourceRef: `navigation:${hash(url)}`,
        url,
      }))
    : [];

/*** Deduplicate media assets while retaining the exact observed source references. */
const collectAssets = (pages: readonly PageObservation[]) =>
  [...new Set(pages.flatMap((page) => page.assets))].map((url) => ({
    contentType: null,
    id: hash(url),
    kind: 'image' as const,
    sourceRefs: [],
    url,
  }));

/*** Derive a portable ancestry list from a stable DOM path. */
const ancestors = (sourceRef: string): string[] =>
  sourceRef
    .split('/')
    .slice(0, -1)
    .map((_, index, parts) => parts.slice(0, index + 1).join('/'));

/*** Read the child index from the final stable DOM path segment. */
const childIndex = (sourceRef: string): number => Number(sourceRef.split(':').at(-1));

/*** Preserve media kind without semantic component recognition. */
const mediaKind = (tagName: string): 'audio' | 'document' | 'embed' | 'image' | 'video' =>
  tagName === 'audio'
    ? 'audio'
    : tagName === 'video'
      ? 'video'
      : tagName === 'iframe'
        ? 'embed'
        : 'image';

/*** Create a stable short identifier without exporting raw source content. */
const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);
