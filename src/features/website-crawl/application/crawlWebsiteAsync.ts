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

interface CrawlState {
  readonly diagnostics: CrawlDiagnostic[];
  readonly pages: PageObservation[];
  readonly queue: CrawlEntry[];
  readonly selectedUrls: Set<string>;
  readonly visited: Set<string>;
}

interface CrawlEntry {
  readonly depth: number;
  readonly sourceUrl: string;
  readonly url: string;
}

/*** Crawl a bounded same-origin website and return raw browser observations without assessing them. */
export const crawlWebsiteAsync = async (
  options: CrawlOptions,
  dependencies: CrawlDependencies,
): Promise<CrawlResult> => {
  const sourceUrl = normalizeUrl(options.url);
  const plan = createCrawlPlan(options);
  const state: CrawlState = {
    diagnostics: [],
    pages: [],
    queue: [{ depth: 0, sourceUrl, url: sourceUrl }],
    selectedUrls: new Set<string>(),
    visited: new Set<string>(),
  };

  try {
    while (state.queue.length > 0) {
      if (state.selectedUrls.size >= plan.maxPages) {
        const [next] = state.queue;
        if (next) state.diagnostics.push(limitDiagnostic(next));
        break;
      }
      await crawlNextEntryAsync(state, plan, sourceUrl, dependencies);
    }
  } finally {
    await dependencies.capturePage.closeAsync();
  }

  return {
    diagnostics: state.diagnostics,
    document: toWebsiteObservationDocument(sourceUrl, state.pages),
  };
};

/*** Crawl the next canonical URL and all configured viewport captures for that URL. */
const crawlNextEntryAsync = async (
  state: CrawlState,
  plan: CrawlPlan,
  sourceUrl: string,
  dependencies: CrawlDependencies,
): Promise<void> => {
  const entry = state.queue.shift();
  if (!entry || state.visited.has(entry.url)) return;
  state.visited.add(entry.url);
  if (!(await dependencies.robots.isAllowedAsync(entry.url))) {
    state.diagnostics.push({
      code: 'robots',
      message: 'robots.txt disallowed this URL.',
      sourceUrl: entry.sourceUrl,
      url: entry.url,
    });
    return;
  }
  state.selectedUrls.add(entry.url);
  await captureEntryAsync(state, plan, sourceUrl, entry, dependencies.capturePage);
};

/*** Capture one selected URL at every viewport while preserving every individual failure. */
const captureEntryAsync = async (
  state: CrawlState,
  plan: CrawlPlan,
  sourceUrl: string,
  entry: CrawlEntry,
  capturePage: CapturePagePort,
): Promise<void> => {
  for (const viewport of plan.viewports) {
    try {
      const page = await capturePage.capturePageAsync({
        maxBytes: plan.maxBytes,
        timeoutMs: plan.timeoutMs,
        url: entry.url,
        viewport,
      });
      state.pages.push(page);
      enqueueLinks(
        state.queue,
        page.links,
        new URL(sourceUrl).origin,
        entry,
        plan.maxDepth,
        state.visited,
      );
    } catch (error) {
      state.diagnostics.push({
        code: 'unreachable',
        message: error instanceof Error ? error.message : String(error),
        sourceUrl: entry.sourceUrl,
        url: entry.url,
        viewportId: viewport.id,
      });
    }
  }
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
  queue: CrawlEntry[],
  links: readonly string[],
  origin: string,
  entry: CrawlEntry,
  maxDepth: number,
  visited: ReadonlySet<string>,
): void => {
  if (entry.depth >= maxDepth) return;
  for (const link of links) {
    try {
      const url = normalizeUrl(link);
      if (
        isSameOrigin(url, origin) &&
        !visited.has(url) &&
        !queue.some((entry) => entry.url === url)
      ) {
        queue.push({ depth: entry.depth + 1, sourceUrl: entry.url, url });
      }
    } catch {
      // Invalid discovered hrefs have no safe crawl target and are intentionally excluded.
    }
  }
};

/*** Identify the canonical next URL that was not selected because the page limit was reached. */
const limitDiagnostic = (entry: CrawlEntry): CrawlDiagnostic => ({
  code: 'limit',
  message: 'The configured distinct canonical URL limit was reached.',
  sourceUrl: entry.sourceUrl,
  url: entry.url,
});
