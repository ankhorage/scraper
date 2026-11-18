import { createHash } from 'node:crypto';

import type { UiNode } from '@ankhorage/contracts';
import type {
  WebsiteObservationDocument,
  WebsitePageRecognition,
  WebsiteRecognitionDocument,
  WebsiteRecognizedNode,
} from '@ankhorage/contracts/website';

type Page = WebsiteObservationDocument['pages'][number];
type ObservedNode = Page['nodes'][number];

/*** Derive an inspectable, source-linked module tree from portable browser observations. */
export const recognizeWebsite = (
  observation: WebsiteObservationDocument,
): WebsiteRecognitionDocument => {
  const recognizedAt = new Date().toISOString();
  return {
    designTokens: [],
    documentId: `recognition:${hash(observation.documentId)}`,
    media: [],
    navigation: observation.pages.flatMap((page) => page.navigation),
    observedDocumentId: observation.documentId,
    pages: observation.pages.map(recognizePage),
    recognizedAt,
    schemaVersion: 1,
    site: observation.site,
    source: {
      ...observation.source,
      crawlId: hash(`${observation.source.crawlId}:${recognizedAt}`),
    },
  };
};

/*** Classify one page without deriving cross-page templates. */
const recognizePage = (page: Page): WebsitePageRecognition => {
  const index = indexPage(page);
  const regions = pageRegions(page, index);
  const root: UiNode = {
    children: regions.map((region) => regionNode(region, index)),
    id: `page:${page.id}`,
    type: 'Page',
  };
  return { id: page.id, nodes: recognizedNodes(root, page), path: page.path, root, url: page.url };
};

/*** Build immutable lookup data once for a page. */
const indexPage = (page: Page) => ({
  byParent: page.nodes.reduce<ReadonlyMap<string | null, readonly ObservedNode[]>>(
    (result, node) =>
      new Map(result).set(node.parentSourceRef, [
        ...(result.get(node.parentSourceRef) ?? []),
        node,
      ]),
    new Map(),
  ),
  bySource: new Map(page.nodes.map((node) => [node.sourceRef, node])),
  nodes: page.nodes,
});

/*** Select only site-level chrome and exactly one main analysis region. */
const pageRegions = (page: Page, index: ReturnType<typeof indexPage>) => {
  const chrome = page.nodes.filter((node) => visible(node) && isSiteChrome(node, index));
  const header = chrome.find((node) => node.dom.tagName === 'header');
  const footer = chrome.find((node) => node.dom.tagName === 'footer');
  const main = page.nodes.find((node) => visible(node) && node.dom.tagName === 'main');
  const excluded = new Set(
    [header?.sourceRef, footer?.sourceRef].filter((value): value is string => Boolean(value)),
  );
  return [
    ...(header ? [{ id: 'header', source: header.sourceRef, type: 'Header' }] : []),
    { id: 'main', source: main?.sourceRef ?? null, type: 'Main', excluded },
    ...(footer ? [{ id: 'footer', source: footer.sourceRef, type: 'Footer' }] : []),
  ];
};

/*** Reject article-local header and footer elements as site chrome. */
const isSiteChrome = (node: ObservedNode, index: ReturnType<typeof indexPage>): boolean =>
  (node.dom.tagName === 'header' || node.dom.tagName === 'footer') &&
  !node.ancestorSourceRefs.some(
    (sourceRef) => index.bySource.get(sourceRef)?.dom.tagName === 'article',
  );

/*** Turn a region's visible DOM roots into its recursively classified children. */
const regionNode = (
  region: {
    readonly id: string;
    readonly source: string | null;
    readonly type: string;
    readonly excluded?: ReadonlySet<string>;
  },
  index: ReturnType<typeof indexPage>,
): UiNode => ({
  children: visibleChildren(region.source, index)
    .filter((node) => !region.excluded?.has(node.sourceRef))
    .flatMap((node) => classifyNode(node, index)),
  id: region.id,
  type: region.type,
});

/*** Fold neutral wrappers while preserving every recognized visible descendant. */
const classifyNode = (node: ObservedNode, index: ReturnType<typeof indexPage>): UiNode[] => {
  const children = visibleChildren(node.sourceRef, index).flatMap((child) =>
    classifyNode(child, index),
  );
  const type = moduleType(node);
  const style = moduleStyle(node);
  return type
    ? [
        {
          ...(children.length ? { children } : {}),
          ...(style ? { style } : {}),
          id: `node:${hash(node.sourceRef)}`,
          props: moduleProps(node),
          type,
        },
      ]
    : children;
};

/*** Read only rendered default-state nodes. */
const visibleChildren = (
  source: string | null,
  index: ReturnType<typeof indexPage>,
): readonly ObservedNode[] => (index.byParent.get(source) ?? []).filter(visible);

/*** Require visible geometry and available browser CSS before a module is emitted. */
const visible = (node: ObservedNode): boolean => {
  const observation = defaultObservation(node);
  return (
    observation?.availability.status === 'available' &&
    observation.rect !== null &&
    observation.rect.width > 0 &&
    observation.rect.height > 0 &&
    observation.css?.display !== 'none' &&
    observation.css?.visibility !== 'hidden' &&
    observation.css?.opacity !== '0'
  );
};

/*** Identify the narrow module vocabulary from semantic and computed-style evidence. */
const moduleType = (node: ObservedNode): string | null =>
  semanticType(node) ?? layoutType(node) ?? textType(node) ?? cardType(node);

/*** Prefer explicit DOM/ARIA semantics over visual classification. */
const semanticType = (node: ObservedNode): string | null => {
  const tag = node.dom.tagName;
  if (tag === 'nav' || node.dom.attributes.role === 'navigation') return 'Nav';
  if (tag === 'a' && node.links.length) return 'Link';
  if (tag === 'button' || node.dom.attributes.role === 'button') return 'Button';
  if (/^h[1-6]$/u.exec(tag)) return 'Heading';
  if (['img', 'svg', 'picture'].includes(tag)) return 'Image';
  return tag === 'hr' || node.dom.attributes.role === 'separator' ? 'Divider' : null;
};

/*** Map browser display evidence to the two supported layout modules. */
const layoutType = (node: ObservedNode): string | null => {
  const display = defaultObservation(node)?.css?.display;
  return display === 'grid' ||
    display === 'inline-grid' ||
    display === 'flex' ||
    display === 'inline-flex'
    ? 'Layout'
    : null;
};

/*** Classify direct rendered text without promoting spans into headings. */
const textType = (node: ObservedNode): string | null =>
  node.textRuns.some((run) => run.text.trim()) ? 'RichText' : null;

/*** Recognize objective surface evidence, including intentionally empty cards. */
const cardType = (node: ObservedNode): string | null => {
  const css = defaultObservation(node)?.css;
  return css &&
    (css.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
      css.borderWidth !== '0px' ||
      css.boxShadow !== 'none')
    ? 'Card'
    : null;
};

/*** Retain semantic props directly witnessed in the source observation. */
const moduleProps = (node: ObservedNode): Record<string, string> => {
  const display = defaultObservation(node)?.css?.display ?? '';
  const text = node.textRuns.map((run) => run.text).join('');
  return {
    ...(display.includes('grid') ? { layout: 'grid' } : {}),
    ...(display.includes('flex') ? { layout: 'flex' } : {}),
    ...(/^h[1-6]$/u.exec(node.dom.tagName) ? { level: node.dom.tagName, text } : {}),
    ...(node.links[0] ? { href: node.links[0].url, text: node.links[0].label ?? '' } : {}),
    ...(node.media[0] ? { src: node.media[0].url } : {}),
  };
};

/*** Preserve relevant visual evidence on each recognized UI node. */
const moduleStyle = (node: ObservedNode): Record<string, string> | undefined => {
  const css = defaultObservation(node)?.css;
  return css
    ? {
        backgroundColor: css.backgroundColor,
        borderColor: css.borderColor,
        borderRadius: css.borderRadius,
        boxShadow: css.boxShadow,
        display: css.display,
        flexDirection: css.flexDirection,
        gap: css.gap,
      }
    : undefined;
};

/*** Locate the canonical default browser observation for a DOM node. */
const defaultObservation = (node: ObservedNode) =>
  node.observations.find((item) => item.stateId === 'default');

/*** Emit the contract's parallel source mapping for the complete UI tree. */
const recognizedNodes = (root: UiNode, page: Page): WebsiteRecognizedNode[] =>
  flatten(root).map((node) => ({
    componentType: node.type,
    confidence: 1,
    id: node.id,
    props: Object.entries(node.props ?? {}).flatMap(([name, value]) =>
      serializable(value) ? [{ name, originalValues: [value], value }] : [],
    ),
    responsive: [],
    sourceRefs: page.nodes
      .filter((candidate) => node.id === `node:${hash(candidate.sourceRef)}`)
      .map((candidate) => candidate.sourceRef),
    status: 'recognized',
    unresolved: null,
  }));

/*** Traverse immutable UI nodes in display order. */
const flatten = (node: UiNode): UiNode[] => [node, ...(node.children ?? []).flatMap(flatten)];

/*** Narrow props before placing them in the serializable Contracts mapping. */
const serializable = (value: unknown): value is string | number | boolean | null =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

/*** Produce stable opaque ids without exposing DOM paths as public ids. */
const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 16);
