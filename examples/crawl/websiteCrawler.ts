/***
 * Crawl a public website into the portable website-observation contract.
 *
 * @usage
 * @readme
 * @title Crawl a website
 */
import { createWebsiteCrawler } from '@ankhorage/scraper';

const crawler = createWebsiteCrawler();
const result = await crawler.crawlWebsiteAsync({ url: 'https://example.com' });

console.log(result.document.pages.length, result.diagnostics);
