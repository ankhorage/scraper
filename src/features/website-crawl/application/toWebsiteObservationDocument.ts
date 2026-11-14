import { createHash } from 'node:crypto';

import type {
  WebsiteNodeObservation,
  WebsiteObservationDocument,
  WebsiteObservedNode,
  WebsitePageObservation,
  WebsiteSemanticAttributeName,
} from '@ankhorage/contracts/website';

import type { PageObservation } from '../../../types/public.js';

/*** Convert browser facts into the published portable website observation document. */
export const toWebsiteObservationDocument = (
  sourceUrl: string,
  pages: readonly PageObservation[],
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
      revision: null,
    },
  };
};

/*** Group one capture per viewport into a single canonical page record. */
const groupPages = (
  pages: readonly PageObservation[],
  collectedAt: string,
): WebsitePageObservation[] =>
  [...groupCapturesByUrl(pages).entries()].map(([url, captures]) => ({
    assets: collectAssets(captures),
    id: hash(url),
    navigation: collectNavigation(captures),
    nodes: collectNodes(captures, collectedAt),
    path: new URL(url).pathname,
    states: collectStates(captures),
    url,
    viewports: captures
      .map(({ viewport }) => ({ ...viewport, devicePixelRatio: 1 }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  }));

/*** Group captures by canonical URL without allowing viewport order to duplicate page records. */
const groupCapturesByUrl = (pages: readonly PageObservation[]): Map<string, PageObservation[]> => {
  const capturesByUrl = new Map<string, PageObservation[]>();
  for (const page of pages) {
    const captures = capturesByUrl.get(page.url) ?? [];
    captures.push(page);
    capturesByUrl.set(page.url, captures);
  }
  return new Map([...capturesByUrl.entries()].sort(([left], [right]) => left.localeCompare(right)));
};

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
      observations: collectElementObservations(elements, element.id, collectedAt),
      parentSourceRef: element.parentId ?? null,
      sourceRef: element.id,
      textRuns: element.text
        ? [{ end: element.text.length, sourceRef: element.id, start: 0, text: element.text }]
        : [],
    }),
  );
};

/*** Map one stable DOM node across default and retained dynamic browser states. */
const collectElementObservations = (
  elements: readonly {
    readonly element: PageObservation['elements'][number];
    readonly page: PageObservation;
  }[],
  sourceRef: string,
  collectedAt: string,
) =>
  elements
    .filter((candidate) => candidate.element.id === sourceRef)
    .flatMap(({ element, page }) => [
      defaultNodeObservation(page, element, collectedAt),
      ...dynamicNodeObservations(page, sourceRef),
    ])
    .sort(
      (left, right) =>
        left.viewportId.localeCompare(right.viewportId) ||
        left.stateId.localeCompare(right.stateId),
    );

/*** Map the ordinary page extraction into the canonical default state. */
const defaultNodeObservation = (
  page: PageObservation,
  element: PageObservation['elements'][number],
  collectedAt: string,
) => ({
  availability: { missing: null, status: 'available' as const },
  css: element.css,
  provenance: { capturedAt: collectedAt, method: 'browser' as const, sourceUrl: page.url },
  rect: element.rect,
  semanticAttributes: observeSemanticAttributes(element),
  stateId: 'default',
  viewportId: page.viewport.id,
});

/*** Retain the dynamic browser evidence as canonical state-specific node observations. */
const dynamicNodeObservations = (page: PageObservation, sourceRef: string) =>
  (page.dynamicElements ?? [])
    .filter((evidence) => evidence.sourceRef === sourceRef)
    .flatMap((evidence) => [
      dynamicObservation(page, evidence.initial, 'initial'),
      dynamicObservation(page, evidence.triggered, 'triggered'),
      ...(evidence.settled
        ? [dynamicObservation(page, evidence.settled, 'settled')]
        : [
            {
              availability: {
                missing: {
                  code: 'animation-incomplete',
                  message: evidence.reason ?? 'Unknown reason.',
                },
                status: 'missing' as const,
              },
              css: null,
              provenance: {
                capturedAt: evidence.triggered.capturedAt,
                method: 'browser' as const,
                sourceUrl: page.url,
              },
              rect: null,
              semanticAttributes: {},
              stateId: 'incomplete',
              viewportId: page.viewport.id,
            },
          ]),
    ]);

/*** Convert one timestamped browser snapshot into a portable node observation. */
const dynamicObservation = (
  page: PageObservation,
  snapshot: NonNullable<PageObservation['dynamicElements']>[number]['initial'],
  stateId: 'initial' | 'triggered' | 'settled',
) => ({
  availability: { missing: null, status: 'available' as const },
  animationEvidence: snapshot.animationEvidence,
  css: snapshot.element.css,
  provenance: { capturedAt: snapshot.capturedAt, method: 'browser' as const, sourceUrl: page.url },
  rect: snapshot.element.rect,
  semanticAttributes: observeSemanticAttributes(snapshot.element),
  stateId,
  viewportId: page.viewport.id,
});

/*** Only publish state-specific semantic values directly observed on this browser element. */
const observeSemanticAttributes = (
  element: PageObservation['elements'][number],
): NonNullable<WebsiteNodeObservation['semanticAttributes']> =>
  Object.fromEntries(
    Object.entries(element.attributes).filter(([name]) => semanticAttributeNames.has(name)),
  );

const semanticAttributeNames: ReadonlySet<string> = new Set<WebsiteSemanticAttributeName>([
  'aria-label',
  'aria-valuemax',
  'aria-valuemin',
  'aria-valuenow',
  'aria-valuetext',
  'role',
  'value',
]);

/*** Declare only the browser states actually retained across the page's viewport captures. */
const collectStates = (pages: readonly PageObservation[]) => {
  const hasDynamicEvidence = pages.some((page) => (page.dynamicElements?.length ?? 0) > 0);
  const hasSettledEvidence = pages.some((page) =>
    page.dynamicElements?.some((evidence) => evidence.outcome === 'settled'),
  );
  const hasIncompleteEvidence = pages.some((page) =>
    page.dynamicElements?.some((evidence) => evidence.outcome === 'incomplete'),
  );
  return [
    { id: 'default', name: 'default' },
    ...(hasDynamicEvidence
      ? [
          { id: 'initial', name: 'initial before viewport activation' },
          { id: 'triggered', name: 'after viewport activation' },
          ...(hasSettledEvidence
            ? [{ id: 'settled', name: 'settled after viewport activation' }]
            : []),
        ]
      : []),
    ...(hasIncompleteEvidence
      ? [{ id: 'incomplete', name: 'viewport activation incomplete' }]
      : []),
  ];
};

/*** Deduplicate source-linked navigation observations while preserving DOM order. */
const collectNavigation = (pages: readonly PageObservation[]) => {
  const links = pages.flatMap((page) => page.elements.filter((element) => element.attributes.href));
  return links.reduce<WebsitePageObservation['navigation']>((navigation, element) => {
    const url = element.attributes.href;
    if (!url || navigation.some((item) => item.url === url)) return navigation;
    return [...navigation, { id: hash(url), label: element.text, sourceRef: element.id, url }];
  }, []);
};

/*** Deduplicate media assets while retaining the exact observed source references. */
const collectAssets = (pages: readonly PageObservation[]) =>
  [...new Set(pages.flatMap((page) => page.assets))].sort().map((url) => ({
    contentType: null,
    id: hash(url),
    kind: 'image' as const,
    sourceRefs: pages
      .flatMap((page) => page.elements)
      .filter((element) => element.attributes.src === url)
      .map((element) => element.id),
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
