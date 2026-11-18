import type { CrawlOptions, DynamicCaptureOptions } from '../../../types/public.js';

export interface CrawlPlan {
  readonly dynamicCapture?: DynamicCaptureOptions;
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxPages: number;
  readonly timeoutMs: number;
  readonly timing?: CrawlOptions['timing'];
  readonly viewports?: CrawlOptions['viewports'];
}

/*** Apply the explicit resource bounds used for every crawl invocation. */
export const createCrawlPlan = (options: CrawlOptions): CrawlPlan => ({
  ...(options.dynamicCapture ? { dynamicCapture: options.dynamicCapture } : {}),
  maxBytes: options.maxBytesPerPage ?? 2_000_000,
  maxDepth: options.maxDepth ?? 1,
  maxPages: options.maxPages ?? 20,
  timeoutMs: options.navigationTimeoutMs ?? 15_000,
  ...(options.timing ? { timing: options.timing } : {}),
  ...(options.viewports ? { viewports: options.viewports } : {}),
});
