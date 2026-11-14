import puppeteer, { type Browser, type HTTPRequest, type Page } from 'puppeteer';

import type {
  CssObservation,
  ElementObservation,
  PageObservation,
} from '../../../../types/public.js';
import type { CapturePageInput, CapturePagePort } from '../../ports/CapturePagePort.js';
import { assertPublicUrlAsync as assertPublicNetworkUrlAsync } from '../network/assertPublicUrlAsync.js';
import type { LayoutCss, VisualCss } from './browserExtractionTypes.js';
import { captureDynamicElementsAsync } from './captureDynamicElementsAsync.js';
import { discoverBreakpointsAsync } from './discoverBreakpointsAsync.js';
import { extractDefaultElements } from './extractDefaultElements.js';
import { extractPageObservation } from './extractPageObservation.js';
import { installBrowserAnimationEvidence } from './installBrowserAnimationEvidence.js';
import { installBrowserRelevantState } from './installBrowserRelevantState.js';
import { probeResponsiveAsync } from './probeResponsiveAsync.js';
interface PuppeteerOptions {
  readonly allowPrivateHostsForTests?: boolean;
  readonly launchArguments?: readonly string[];
}
declare global {
  var __ankhorageScraperElementPath: (element: Element) => string;
  var __ankhorageScraperFindElement: (sourceRef: string) => Element | null;
  var __ankhorageScraperExtractLayoutCss: (style: CSSStyleDeclaration) => LayoutCss;
  var __ankhorageScraperExtractVisualCss: (style: CSSStyleDeclaration) => VisualCss;
  var __ankhorageScraperExtractCss: (style: CSSStyleDeclaration) => CssObservation;
  var __ankhorageScraperExtractElement: (element: Element) => ElementObservation;
}
/*** Create the Puppeteer edge adapter used to collect serializable browser evidence. */
export const createPuppeteerCapturePage = async (
  options: PuppeteerOptions = {},
): Promise<CapturePagePort> => {
  const browser = await puppeteer.launch({
    ...(options.launchArguments ? { args: [...options.launchArguments] } : {}),
    headless: true,
  });

  return {
    capturePageAsync: async (input) => capturePageAsync(browser, input, options),
    discoverBreakpointsAsync: async (input) =>
      discoverBreakpointsAsync({
        assertBoundedDocumentAsync,
        assertPublicUrlAsync,
        blockUnsafeRequestsAsync,
        browser,
        input,
        options,
      }),
    probeResponsiveAsync: async ({ conditions, widths, ...input }) =>
      probeResponsiveAsync({
        assertBoundedDocumentAsync,
        assertPublicUrlAsync,
        blockUnsafeRequestsAsync,
        browser,
        conditions,
        input,
        options,
        widths,
      }),
    closeAsync: async () => browser.close(),
  };
};
/*** Navigate one bounded viewport after installing only browser-context extraction functions. */
const capturePageAsync = async (
  browser: Browser,
  input: CapturePageInput,
  options: PuppeteerOptions,
): Promise<PageObservation> => {
  await assertPublicUrlAsync(input.url, options);
  const page = await browser.newPage();
  try {
    await page.setViewport({ height: input.viewport.height, width: input.viewport.width });
    await installBrowserExtractionAsync(page);
    await blockUnsafeRequestsAsync(page, options);
    const response = await page.goto(input.url, {
      timeout: input.timeoutMs,
      waitUntil: 'networkidle2',
    });
    await assertPublicUrlAsync(page.url(), options);
    await assertBoundedDocumentAsync(page, input.maxBytes);
    const elements = await page.evaluate(extractDefaultElements);
    const dynamicElements = await captureDynamicElementsAsync(
      page,
      input.timeoutMs,
      input.dynamicCapture,
    );
    return page.evaluate(extractPageObservation, {
      dynamicElements,
      elements,
      statusCode: response?.status() ?? 0,
      viewport: input.viewport,
    });
  } finally {
    await page.close();
  }
};
/*** Install the browser-only helper functions before every navigation or redirect can replace them. */
const installBrowserExtractionAsync = async (page: Page): Promise<void> => {
  await page.evaluateOnNewDocument(installBrowserPath);
  await page.evaluateOnNewDocument(installBrowserLayoutCss);
  await page.evaluateOnNewDocument(installBrowserVisualCss);
  await page.evaluateOnNewDocument(installBrowserCss);
  await page.evaluateOnNewDocument(installBrowserAnimationEvidence);
  await page.evaluateOnNewDocument(installBrowserRelevantState);
  await page.evaluateOnNewDocument(installBrowserElement);
};
/*** Reject browser requests and redirects that resolve to non-public network targets. */
const blockUnsafeRequestsAsync = async (page: Page, options: PuppeteerOptions): Promise<void> => {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    void continuePublicRequestAsync(request, options);
  });
};

/*** Continue an individually DNS-validated browser request or abort it before network I/O. */
const continuePublicRequestAsync = async (
  request: HTTPRequest,
  options: PuppeteerOptions,
): Promise<void> => {
  try {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return request.continue();
    await assertPublicUrlAsync(url, options);
    return request.continue();
  } catch {
    return request.abort('blockedbyclient');
  }
};

/*** Keep private-host bypasses confined to deterministic local Chromium acceptance fixtures. */
const assertPublicUrlAsync = async (input: string, options: PuppeteerOptions): Promise<void> => {
  if (options.allowPrivateHostsForTests) return;
  await assertPublicNetworkUrlAsync(input);
};

/*** Enforce the configured HTML-byte limit in the rendered browser document. */
const assertBoundedDocumentAsync = async (page: Page, maxBytes: number): Promise<void> => {
  const bytes = await page.evaluate(
    () => new TextEncoder().encode(document.documentElement.outerHTML).byteLength,
  );
  if (bytes > maxBytes) throw new Error('Page exceeds configured byte limit');
};

/*** Install stable DOM-path extraction in the browser context. */
const installBrowserPath = (): void => {
  globalThis.__ankhorageScraperElementPath = (element) => {
    const parts = [] as string[];
    for (let current: Element | null = element; current; current = current.parentElement) {
      const index = current.parentElement
        ? [...current.parentElement.children].indexOf(current)
        : 0;
      parts.unshift(`${current.tagName.toLowerCase()}:${index}`);
    }
    return parts.join('/');
  };
  globalThis.__ankhorageScraperFindElement = (sourceRef) =>
    sourceRef.split('/').reduce<Element | null>((parent, segment, index) => {
      if (!parent) return null;
      return index === 0
        ? document.documentElement
        : parent.children.item(Number(segment.split(':').at(-1)));
    }, document.documentElement);
};

/*** Install layout-specific computed CSS extraction in the browser context. */
const installBrowserLayoutCss = (): void => {
  globalThis.__ankhorageScraperExtractLayoutCss = (style) => ({
    alignContent: style.alignContent,
    alignItems: style.alignItems,
    alignSelf: style.alignSelf,
    display: style.display,
    flexBasis: style.flexBasis,
    flexDirection: style.flexDirection,
    flexGrow: style.flexGrow,
    flexShrink: style.flexShrink,
    flexWrap: style.flexWrap,
    gap: style.gap,
    gridAutoColumns: style.gridAutoColumns,
    gridAutoFlow: style.gridAutoFlow,
    gridAutoRows: style.gridAutoRows,
    gridColumn: style.gridColumn,
    gridColumnEnd: style.gridColumnEnd,
    gridColumnStart: style.gridColumnStart,
    gridRow: style.gridRow,
    gridRowEnd: style.gridRowEnd,
    gridRowStart: style.gridRowStart,
    gridTemplateColumns: style.gridTemplateColumns,
    gridTemplateRows: style.gridTemplateRows,
    justifyContent: style.justifyContent,
    justifyItems: style.justifyItems,
    justifySelf: style.justifySelf,
    order: style.order,
    overflow: style.overflow,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    placeContent: style.placeContent,
    placeItems: style.placeItems,
    placeSelf: style.placeSelf,
    position: style.position,
  });
};

/*** Install visual and typography CSS extraction in the browser context. */
const installBrowserVisualCss = (): void => {
  globalThis.__ankhorageScraperExtractVisualCss = (style) => ({
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    backgroundPosition: style.backgroundPosition,
    backgroundRepeat: style.backgroundRepeat,
    backgroundSize: style.backgroundSize,
    borderColor: style.borderColor,
    borderRadius: style.borderRadius,
    borderWidth: style.borderWidth,
    boxShadow: style.boxShadow,
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    opacity: style.opacity,
    animation: style.animation,
    textAlign: style.textAlign,
    textDecoration: style.textDecoration,
    transform: style.transform,
    transition: style.transition,
    visibility: style.visibility,
  });
};

/*** Combine complete computed CSS from browser-local layout and visual readers. */
const installBrowserCss = (): void => {
  globalThis.__ankhorageScraperExtractCss = (style) => ({
    ...globalThis.__ankhorageScraperExtractLayoutCss(style),
    ...globalThis.__ankhorageScraperExtractVisualCss(style),
    margin: {
      bottom: style.marginBottom,
      left: style.marginLeft,
      right: style.marginRight,
      top: style.marginTop,
    },
    padding: {
      bottom: style.paddingBottom,
      left: style.paddingLeft,
      right: style.paddingRight,
      top: style.paddingTop,
    },
  });
};

/*** Install element extraction that retains direct text nodes and styled inline descendants. */
const installBrowserElement = (): void => {
  globalThis.__ankhorageScraperExtractElement = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const observedNames =
      'alt aria-label aria-valuemax aria-valuemin aria-valuenow aria-valuetext class href id role src target type value'.split(
        ' ',
      );
    const attributes = [...observedNames, ...element.getAttributeNames()]
      .filter((name, index, names) => names.indexOf(name) === index)
      .filter(
        (name) =>
          observedNames.includes(name) ||
          /^data-(animation|count|progress|state|value)$/i.test(name),
      )
      .reduce(
        (result, name) => {
          const value = element.getAttribute(name);
          if (value === null) return result;
          const normalized =
            name === 'href' || name === 'src' ? new URL(value, location.href).href : value;
          return { ...result, [name]: normalized.slice(0, 256) };
        },
        {} as Record<string, string>,
      );
    return {
      attributes,
      css: globalThis.__ankhorageScraperExtractCss(style),
      id: globalThis.__ankhorageScraperElementPath(element),
      ...(element.parentElement
        ? { parentId: globalThis.__ankhorageScraperElementPath(element.parentElement) }
        : {}),
      rect: { height: rect.height, width: rect.width, x: rect.x, y: rect.y },
      tagName: element.tagName.toLowerCase(),
      text: [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join(''),
      visible:
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 0 &&
        rect.height > 0,
    };
  };
};
