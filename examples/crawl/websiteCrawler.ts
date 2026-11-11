/***
 * Crawl a public website into the portable website-observation contract.
 *
 * @usage
 * @readme
 * @title Crawl a website
 */
import { createWebsiteCrawler } from '@ankhorage/scraper';

const crawler = createWebsiteCrawler();
const observation = await crawler.crawlWebsiteAsync({ url: 'https://example.com' });

console.log(observation.pages.length);
