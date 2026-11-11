import { lookup } from 'node:dns/promises';

import puppeteer, { type Browser, type Page } from 'puppeteer';

import type {
  CssObservation,
  ElementObservation,
  PageObservation,
} from '../../../../types/public.js';
import { isPrivateAddress } from '../../domain/isPrivateAddress.js';
import type { CapturePageInput, CapturePagePort } from '../../ports/CapturePagePort.js';

interface PuppeteerOptions {
  readonly allowPrivateHostsForTests?: boolean;
  readonly launchArguments?: readonly string[];
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
    closeAsync: async () => browser.close(),
  };
};

const capturePageAsync = async (
  browser: Browser,
  input: CapturePageInput,
  options: PuppeteerOptions,
): Promise<PageObservation> => {
  await assertPublicUrlAsync(input.url, options);
  const page = await browser.newPage();

  try {
    await page.setViewport({ height: input.viewport.height, width: input.viewport.width });
    await blockUnsafeRequestsAsync(page, options);
    const response = await page.goto(input.url, {
      timeout: input.timeoutMs,
      waitUntil: 'networkidle2',
    });
    const finalUrl = page.url();
    await assertPublicUrlAsync(finalUrl, options);
    await assertBoundedDocumentAsync(page, input.maxBytes);

    return page.evaluate(extractPage, {
      statusCode: response?.status() ?? 0,
      viewport: input.viewport,
    });
  } finally {
    await page.close();
  }
};

const blockUnsafeRequestsAsync = async (page: Page, options: PuppeteerOptions): Promise<void> => {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    void (async () => {
      try {
        const url = request.url();
        if (url.startsWith('data:') || url.startsWith('blob:')) return request.continue();
        await assertPublicUrlAsync(url, options);
        return request.continue();
      } catch {
        return request.abort('blockedbyclient');
      }
    })();
  });
};

const assertPublicUrlAsync = async (input: string, options: PuppeteerOptions): Promise<void> => {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsafe protocol');
  if (options.allowPrivateHostsForTests) return;
  if (url.hostname === 'localhost' || isPrivateAddress(url.hostname))
    throw new Error('Private host blocked');
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.some(({ address }) => isPrivateAddress(address)))
    throw new Error('Private address blocked');
};

const assertBoundedDocumentAsync = async (page: Page, maxBytes: number): Promise<void> => {
  const bytes = await page.evaluate(
    () => new TextEncoder().encode(document.documentElement.outerHTML).byteLength,
  );
  if (bytes > maxBytes) throw new Error('Page exceeds configured byte limit');
};

const extractPage = (input: {
  readonly statusCode: number;
  readonly viewport: { readonly height: number; readonly id: string; readonly width: number };
}): PageObservation => ({
  assets: [...document.querySelectorAll('img, video, audio, source')]
    .map((element) => element.getAttribute('src'))
    .filter((source): source is string => source !== null)
    .map((source) => new URL(source, location.href).href)
    .sort(),
  elements: [...document.querySelectorAll('body *')].map(extractElement),
  links: [...document.querySelectorAll('a[href]')]
    .map((element) => element.getAttribute('href'))
    .filter((href): href is string => href !== null)
    .map((href) => new URL(href, location.href).href)
    .sort(),
  statusCode: input.statusCode,
  title: document.title,
  url: location.href,
  viewport: input.viewport,
});

const extractElement = (element: Element): ElementObservation => {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const attributes = Object.fromEntries(
    ['alt', 'aria-label', 'href', 'role', 'src', 'target', 'type']
      .map((name) => [name, element.getAttribute(name)] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== null),
  );

  return {
    attributes,
    css: extractCss(style),
    id: elementPath(element),
    ...(element.parentElement ? { parentId: elementPath(element.parentElement) } : {}),
    rect: { height: rect.height, width: rect.width, x: rect.x, y: rect.y },
    tagName: element.tagName.toLowerCase(),
    text: element.children.length === 0 ? element.textContent.trim() : '',
    visible:
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      rect.width > 0 &&
      rect.height > 0,
  };
};

/*** Read the complete portable computed-CSS observation from one browser element. */
const extractCss = (style: CSSStyleDeclaration): CssObservation => ({
  ...extractLayoutCss(style),
  ...extractVisualCss(style),
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

/*** Read layout-specific computed values without inferring components or breakpoints. */
const extractLayoutCss = (style: CSSStyleDeclaration) => ({
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

/*** Read visual and typography values from the browser's computed style. */
const extractVisualCss = (style: CSSStyleDeclaration) => ({
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
  textAlign: style.textAlign,
  textDecoration: style.textDecoration,
  visibility: style.visibility,
});

const elementPath = (element: Element): string => {
  const parts = [] as string[];
  for (let current: Element | null = element; current; current = current.parentElement) {
    const index = current.parentElement ? [...current.parentElement.children].indexOf(current) : 0;
    parts.unshift(`${current.tagName.toLowerCase()}:${index}`);
  }
  return parts.join('/');
};
