import type { Browser, Page } from 'puppeteer';

import type { BreakpointProbe } from '../../../../types/public.js';

interface ProbeResponsiveInput {
  readonly assertBoundedDocumentAsync: (page: Page, maxBytes: number) => Promise<void>;
  readonly assertPublicUrlAsync: (
    input: string,
    options: { readonly allowPrivateHostsForTests?: boolean },
  ) => Promise<void>;
  readonly blockUnsafeRequestsAsync: (
    page: Page,
    options: { readonly allowPrivateHostsForTests?: boolean },
  ) => Promise<void>;
  readonly browser: Browser;
  readonly conditions: readonly string[];
  readonly input: { readonly maxBytes: number; readonly timeoutMs: number; readonly url: string };
  readonly options: { readonly allowPrivateHostsForTests?: boolean };
  readonly widths: readonly number[];
}

/*** Probe bounded responsive browser facts without collecting full page observations. */
export const probeResponsiveAsync = async ({
  assertBoundedDocumentAsync,
  assertPublicUrlAsync,
  blockUnsafeRequestsAsync,
  browser,
  conditions,
  input,
  options,
  widths,
}: ProbeResponsiveInput): Promise<readonly BreakpointProbe[]> => {
  await assertPublicUrlAsync(input.url, options);
  const page = await browser.newPage();
  try {
    await blockUnsafeRequestsAsync(page, options);
    const probes: BreakpointProbe[] = [];
    for (const width of widths) {
      await page.setViewport({ height: 900, width });
      await page.goto(input.url, { timeout: input.timeoutMs, waitUntil: 'networkidle2' });
      await assertPublicUrlAsync(page.url(), options);
      await assertBoundedDocumentAsync(page, input.maxBytes);
      const probe: unknown = await page.evaluate(extractResponsiveProbe, conditions);
      if (!isBreakpointProbe(probe))
        throw new Error('Browser returned an invalid responsive probe.');
      probes.push({ ...probe, width });
    }
    return probes;
  } finally {
    await page.close();
  }
};

/*** Extract raw viewport-sensitive navigation, layout, overflow, and CSS-condition facts. */
const extractResponsiveProbe = (conditions: readonly string[]): Omit<BreakpointProbe, 'width'> => {
  const isVisible = (element: Element, style: CSSStyleDeclaration, rect: DOMRect): boolean =>
    !element.hasAttribute('hidden') &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    (rect.width > 0 || rect.height > 0);
  return {
    conditionMatches: conditions.filter((condition) => window.matchMedia(condition).matches).sort(),
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    layout: [...document.body.querySelectorAll('*')].slice(0, 256).map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return `${element.tagName}:${element.parentElement?.tagName ?? ''}:${style.display}:${style.gridTemplateColumns}:${style.flexDirection}:${isVisible(element, style, rect)}`;
    }),
    navigation: [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
      .filter((element) =>
        isVisible(element, getComputedStyle(element), element.getBoundingClientRect()),
      )
      .map((element) => `${element.textContent.trim()}:${element.href}`)
      .sort(),
  };
};

/*** Validate untrusted browser results before they cross into the application layer. */
const isBreakpointProbe = (value: unknown): value is Omit<BreakpointProbe, 'width'> =>
  isRecord(value) &&
  Array.isArray(value.conditionMatches) &&
  value.conditionMatches.every((item) => typeof item === 'string') &&
  typeof value.hasHorizontalOverflow === 'boolean' &&
  Array.isArray(value.layout) &&
  value.layout.every((item) => typeof item === 'string') &&
  Array.isArray(value.navigation) &&
  value.navigation.every((item) => typeof item === 'string');

/*** Narrow an untrusted browser value to a plain record before reading its fields. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
