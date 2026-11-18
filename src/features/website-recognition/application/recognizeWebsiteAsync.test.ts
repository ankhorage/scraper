import type { WebsiteComputedCss, WebsiteObservedNode } from '@ankhorage/contracts/website';
import { expect, test } from 'bun:test';

import { recognizeWebsite } from './recognizeWebsite.js';

test('recognizes semantic modules while folding neutral wrappers', () => {
  const result = recognizeWebsite({
    collectedAt: '2026-11-19T00:00:00.000Z',
    documentId: 'website:test',
    pages: [
      {
        assets: [],
        id: 'page',
        navigation: [],
        path: '/',
        states: [{ id: 'default', name: 'default' }],
        url: 'https://example.test/',
        viewports: [{ devicePixelRatio: 1, height: 900, id: 'desktop', width: 1440 }],
        nodes: [
          node('header', null, 'header'),
          node('layout', 'header', 'nav', 'flex'),
          node('link', 'layout', 'a', 'block', 'Home'),
          node('main', null, 'main'),
          node('wrapper', 'main', 'div'),
          node('grid', 'wrapper', 'section', 'grid'),
          node('card', 'grid', 'article', 'block', '', 'rgb(255, 255, 0)'),
          node('heading', 'card', 'h3', 'block', 'Product'),
          node('footer', null, 'footer'),
        ],
      },
    ],
    schemaVersion: 1,
    site: { id: 'site', url: 'https://example.test/' },
    source: { crawlId: 'crawl', crawlerId: 'test', crawlerVersion: '1', revision: null },
  });
  const types: readonly string[] = result.pages[0]?.nodes.map((node) => node.componentType) ?? [];
  for (const type of ['Header', 'Main', 'Footer', 'Layout', 'Card', 'Heading', 'Nav', 'Link'])
    expect(types).toContain(type);
  expect(types).not.toContain('Container');
});

/*** Build minimal rendered browser evidence for deterministic classifier coverage. */
const node = (
  sourceRef: string,
  parentSourceRef: string | null,
  tagName: string,
  display = 'block',
  text = '',
  backgroundColor = 'rgba(0, 0, 0, 0)',
): WebsiteObservedNode => ({
  ancestorSourceRefs: [],
  dom: { attributes: {}, childIndex: 0, tagName },
  links: tagName === 'a' ? [{ label: text, sourceRef, url: 'https://example.test/home' }] : [],
  media: [],
  observations: [fixtureObservation(display, backgroundColor)],
  parentSourceRef,
  sourceRef,
  textRuns: text ? [{ end: text.length, sourceRef, start: 0, text }] : [],
});

/*** Build one visible default-state observation for a fixture node. */
const fixtureObservation = (display: string, backgroundColor: string) => ({
  availability: { missing: null, status: 'available' as const },
  css: fixtureCss(display, backgroundColor),
  provenance: {
    capturedAt: '2026-11-19T00:00:00.000Z',
    method: 'browser' as const,
    sourceUrl: 'https://example.test/',
  },
  rect: { height: 20, width: 20, x: 0, y: 0 },
  stateId: 'default',
  viewportId: 'desktop',
});

/*** Create independent zero-valued box measurements for fixture CSS. */
const box = () => ({ bottom: '0px', left: '0px', right: '0px', top: '0px' });

/*** Supply a complete but intentionally neutral computed-CSS baseline. */
const fixtureCssBase: Omit<WebsiteComputedCss, 'backgroundColor' | 'display'> = {
  alignContent: 'normal',
  alignItems: 'normal',
  alignSelf: 'auto',
  backgroundImage: 'none',
  backgroundPosition: '0% 0%',
  backgroundRepeat: 'repeat',
  backgroundSize: 'auto',
  borderColor: 'rgb(0, 0, 0)',
  borderRadius: '0px',
  borderWidth: '0px',
  boxShadow: 'none',
  color: 'rgb(0, 0, 0)',
  flexBasis: 'auto',
  flexDirection: 'row',
  flexGrow: '0',
  flexShrink: '1',
  flexWrap: 'nowrap',
  fontFamily: 'serif',
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
  margin: box(),
  opacity: '1',
  order: '0',
  overflow: 'visible',
  overflowX: 'visible',
  overflowY: 'visible',
  padding: box(),
  placeContent: 'normal',
  placeItems: 'normal',
  placeSelf: 'auto',
  position: 'static',
  textAlign: 'start',
  textDecoration: 'none',
  visibility: 'visible',
};

/*** Add each fixture node's variable rendered styles to the neutral baseline. */
const fixtureCss = (display: string, backgroundColor: string): WebsiteComputedCss => ({
  ...fixtureCssBase,
  backgroundColor,
  display,
});
