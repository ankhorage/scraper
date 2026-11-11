import type { CrawlOptions, CrawlResult } from '../../../types/public.js';
import { createPuppeteerCapturePage } from '../adapters/puppeteer/createPuppeteerCapturePage.js';
import { createRobotsPort } from '../adapters/robots/robotsPort.js';
import { crawlWebsiteAsync } from '../application/crawlWebsiteAsync.js';

/*** Create the public, safe website-recognition crawler. */
export const createWebsiteCrawler = (): {
  readonly crawlWebsiteAsync: (options: CrawlOptions) => Promise<CrawlResult>;
} => ({
  crawlWebsiteAsync: async (options) =>
    crawlWebsiteAsync(options, {
      capturePage: await createPuppeteerCapturePage(),
      robots: createRobotsPort(),
    }),
});
