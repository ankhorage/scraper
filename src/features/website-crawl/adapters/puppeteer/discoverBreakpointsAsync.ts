import type { Browser, Page } from 'puppeteer';

import type { BreakpointEvidence } from '../../../../types/public.js';
import { extractBreakpointEvidence } from './extractBreakpointEvidence.js';

interface DiscoverBreakpointsInput {
  readonly browser: Browser;
  readonly input: { readonly maxBytes: number; readonly timeoutMs: number; readonly url: string };
  readonly options: { readonly allowPrivateHostsForTests?: boolean };
  readonly assertBoundedDocumentAsync: (page: Page, maxBytes: number) => Promise<void>;
  readonly assertPublicUrlAsync: (
    input: string,
    options: { readonly allowPrivateHostsForTests?: boolean },
  ) => Promise<void>;
  readonly blockUnsafeRequestsAsync: (
    page: Page,
    options: { readonly allowPrivateHostsForTests?: boolean },
  ) => Promise<void>;
}

/*** Read CSSOM breakpoint evidence before costly DOM and computed-style capture begins. */
export const discoverBreakpointsAsync = async ({
  browser,
  input,
  options,
  assertBoundedDocumentAsync,
  assertPublicUrlAsync,
  blockUnsafeRequestsAsync,
}: DiscoverBreakpointsInput): Promise<readonly BreakpointEvidence[]> => {
  await assertPublicUrlAsync(input.url, options);
  const page = await browser.newPage();
  try {
    await page.setViewport({ height: 900, width: 1440 });
    await blockUnsafeRequestsAsync(page, options);
    await page.goto(input.url, { timeout: input.timeoutMs, waitUntil: 'networkidle2' });
    await assertPublicUrlAsync(page.url(), options);
    await assertBoundedDocumentAsync(page, input.maxBytes);
    const evidence: unknown = await page.evaluate(`${extractBreakpointEvidence()}()`);
    if (!isBreakpointEvidence(evidence))
      throw new Error('Browser returned invalid breakpoint evidence.');
    return evidence;
  } finally {
    await page.close();
  }
};

/*** Validate browser-boundary CSSOM values before they enter the crawler application layer. */
const isBreakpointEvidence = (value: unknown): value is readonly BreakpointEvidence[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isRecord(item) &&
      typeof item.condition === 'string' &&
      typeof item.source === 'string' &&
      typeof item.sourceUrl === 'string' &&
      (item.kind === 'container' || item.kind === 'diagnostic' || item.kind === 'viewport'),
  );

/*** Narrow an untrusted browser value to a non-array record before reading its fields. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
