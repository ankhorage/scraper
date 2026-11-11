import type {
  CrawlDiagnostic,
  CrawlOptions,
  CrawlResult,
  PageObservation,
} from '../../../types/public.js';
import { isSameOrigin } from '../domain/isSameOrigin.js';
import { normalizeUrl } from '../domain/normalizeUrl.js';
import type { CapturePagePort } from '../ports/CapturePagePort.js';
import type { RobotsPort } from '../ports/RobotsPort.js';
import { toWebsiteObservationDocument } from './toWebsiteObservationDocument.js';

interface CrawlDependencies {
  readonly capturePage: CapturePagePort;
  readonly robots: RobotsPort;
}

interface CrawlPlan {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxPages: number;
  readonly timeoutMs: number;
  readonly viewports: NonNullable<CrawlOptions['viewports']>;
}

/*** Crawl a bounded same-origin website and return raw browser observations without assessing them. */
export const crawlWebsiteAsync = async (
  options: CrawlOptions,
  dependencies: CrawlDependencies,
): Promise<CrawlResult> => {
  const sourceUrl = normalizeUrl(options.url);
  const plan = createCrawlPlan(options);
  const queue = [{ depth: 0, url: sourceUrl }];
  const visited = new Set<string>();
  const pages: PageObservation[] = [];
  const diagnostics = [] as CrawlDiagnostic[];

  try {
    while (queue.length > 0 && pages.length < plan.maxPages) {
      const entry = queue.shift();
      if (!entry || visited.has(entry.url)) continue;
      visited.add(entry.url);

      if (!(await dependencies.robots.isAllowedAsync(entry.url))) {
        diagnostics.push({ code: 'robots', url: entry.url });
        continue;
      }

      for (const viewport of plan.viewports) {
        try {
          const page = await dependencies.capturePage.capturePageAsync({
            maxBytes: plan.maxBytes,
            timeoutMs: plan.timeoutMs,
            url: entry.url,
            viewport,
          });
          pages.push(page);
          enqueueLinks(
            queue,
            page.links,
            new URL(sourceUrl).origin,
            entry.depth,
            plan.maxDepth,
            visited,
          );
        } catch {
          diagnostics.push({ code: 'unreachable', url: entry.url });
        }
      }
    }
  } finally {
    await dependencies.capturePage.closeAsync();
  }

  if (queue.length > 0) diagnostics.push({ code: 'limit', url: sourceUrl });
  return toWebsiteObservationDocument(sourceUrl, pages, diagnostics);
};

/*** Apply the explicit resource bounds used for every crawl invocation. */
const createCrawlPlan = (options: CrawlOptions): CrawlPlan => ({
  maxBytes: options.maxBytesPerPage ?? 2_000_000,
  maxDepth: options.maxDepth ?? 1,
  maxPages: options.maxPages ?? 20,
  timeoutMs: options.navigationTimeoutMs ?? 15_000,
  viewports: options.viewports ?? [{ id: 'desktop', width: 1440, height: 900 }],
});

const enqueueLinks = (
  queue: { depth: number; url: string }[],
  links: readonly string[],
  origin: string,
  depth: number,
  maxDepth: number,
  visited: ReadonlySet<string>,
): void => {
  if (depth >= maxDepth) return;
  for (const link of links) {
    try {
      const url = normalizeUrl(link);
      if (
        isSameOrigin(url, origin) &&
        !visited.has(url) &&
        !queue.some((entry) => entry.url === url)
      ) {
        queue.push({ depth: depth + 1, url });
      }
    } catch {
      // Invalid discovered hrefs have no safe crawl target and are intentionally excluded.
    }
  }
};
