import type { CrawlOptions, CrawlResult } from '../../../types/public.js';
import { createPuppeteerCapturePage } from '../adapters/puppeteer/createPuppeteerCapturePage.js';
import { createRobotsPort } from '../adapters/robots/robotsPort.js';
import { crawlWebsiteAsync } from '../application/crawlWebsiteAsync.js';
import { measureCrawlPhaseAsync } from '../utils/measureCrawlPhaseAsync.js';

interface WebsiteCrawlerOptions {
  readonly allowPrivateHostsForTests?: boolean;
  readonly launchArguments?: readonly string[];
}

/*** Create the public, safe website-recognition crawler. */
export const createWebsiteCrawler = (
  crawlerOptions: WebsiteCrawlerOptions = {},
): {
  readonly crawlWebsiteAsync: (options: CrawlOptions) => Promise<CrawlResult>;
} => ({
  crawlWebsiteAsync: async (options) => crawlWebsiteWithBrowserAsync(options, crawlerOptions),
});

/*** Start the browser at the public boundary so opt-in timings include its complete lifecycle. */
const crawlWebsiteWithBrowserAsync = async (
  options: CrawlOptions,
  crawlerOptions: WebsiteCrawlerOptions,
): Promise<CrawlResult> => {
  const capturePage = await measureCrawlPhaseAsync(options.timing, 'browser-start', () =>
    createPuppeteerCapturePage(crawlerOptions),
  );
  return crawlWebsiteAsync(options, { capturePage, robots: createRobotsPort() });
};
