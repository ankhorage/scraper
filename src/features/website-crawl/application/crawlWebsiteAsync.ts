import { createHash } from 'node:crypto';

import type {
  BreakpointCoverage,
  BreakpointEvidence,
  CrawlDiagnostic,
  CrawlOptions,
  CrawlResult,
  PageObservation,
} from '../../../types/public.js';
import { isSameOrigin } from '../domain/isSameOrigin.js';
import { normalizeUrl } from '../domain/normalizeUrl.js';
import type { CapturePagePort } from '../ports/CapturePagePort.js';
import type { RobotsPort } from '../ports/RobotsPort.js';
import { prepareCanonicalCaptureAsync } from './resolveCanonicalAliasAsync.js';
import { resolveResponsiveViewportsAsync } from './resolveResponsiveViewportsAsync.js';
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
  readonly viewports?: CrawlOptions['viewports'];
}

interface CrawlState {
  readonly breakpointCoverage: BreakpointCoverage[];
  readonly breakpointEvidence: BreakpointEvidence[];
  readonly diagnostics: CrawlDiagnostic[];
  readonly captureFingerprints: Map<string, string>;
  readonly canonicalUrls: Set<string>;
  readonly canonicalViewportPlans: Map<
    string,
    readonly NonNullable<CrawlOptions['viewports']>[number][]
  >;
  readonly pages: PageObservation[];
  readonly queue: CrawlEntry[];
  readonly requestedUrls: Set<string>;
  readonly redirects: Set<string>;
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
    breakpointCoverage: [],
    breakpointEvidence: [],
    diagnostics: [],
    captureFingerprints: new Map<string, string>(),
    canonicalUrls: new Set<string>(),
    canonicalViewportPlans: new Map(),
    pages: [],
    queue: [{ depth: 0, sourceUrl, url: sourceUrl }],
    requestedUrls: new Set<string>(),
    redirects: new Set<string>(),
    visited: new Set<string>(),
  };

  try {
    while (state.queue.length > 0) {
      if (state.requestedUrls.size >= plan.maxPages) {
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
    breakpointCoverage: state.breakpointCoverage,
    breakpointEvidence: state.breakpointEvidence,
    diagnostics: state.diagnostics,
    document: toWebsiteObservationDocument(sourceUrl, state.pages),
  };
};

/*** Crawl the next requested URL and retain only its unique final canonical captures. */
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
  state.requestedUrls.add(entry.url);
  await captureEntryAsync(state, plan, sourceUrl, entry, dependencies);
};

/*** Capture one requested URL at every viewport while enforcing canonical capture uniqueness. */
const captureEntryAsync = async (
  state: CrawlState,
  plan: CrawlPlan,
  sourceUrl: string,
  entry: CrawlEntry,
  dependencies: CrawlDependencies,
): Promise<void> => {
  const finalUrl = await prepareCanonicalCaptureAsync({
    canonicalViewportPlans: state.canonicalViewportPlans,
    capturePage: dependencies.capturePage,
    diagnostics: state.diagnostics,
    entry,
    maxBytes: plan.maxBytes,
    redirects: state.redirects,
    robots: dependencies.robots,
    timeoutMs: plan.timeoutMs,
  });
  if (!finalUrl) return;
  const viewports = await resolveResponsiveViewportsAsync({
    capturePage: dependencies.capturePage,
    entry,
    plan,
    state,
  });
  const capturedFinalUrls = await captureViewportsAsync(
    state,
    plan,
    sourceUrl,
    entry,
    dependencies.capturePage,
    viewports,
  );
  if (
    viewports.length > 0 &&
    capturedFinalUrls.size === 1 &&
    capturedFinalUrls.has(finalUrl) &&
    viewports.every((viewport) =>
      state.captureFingerprints.has(`${finalUrl}\u0000${viewport.id}\u0000default`),
    )
  ) {
    state.canonicalViewportPlans.set(finalUrl, viewports);
  }
};

/*** Collect every selected viewport and retain the final identity observed for each successful one. */
const captureViewportsAsync = async (
  state: CrawlState,
  plan: CrawlPlan,
  sourceUrl: string,
  entry: CrawlEntry,
  capturePage: CapturePagePort,
  viewports: readonly NonNullable<CrawlOptions['viewports']>[number][],
): Promise<Set<string>> => {
  const capturedFinalUrls = new Set<string>();
  for (const viewport of viewports) {
    try {
      const page = await capturePage.capturePageAsync({
        maxBytes: plan.maxBytes,
        origin: new URL(sourceUrl).origin,
        timeoutMs: plan.timeoutMs,
        url: entry.url,
        viewport,
      });
      capturedFinalUrls.add(page.url);
      retainCanonicalCapture(state, plan, sourceUrl, entry, page);
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
  return capturedFinalUrls;
};

/*** Retain only the first deterministic capture for each final URL, viewport, and default state. */
const retainCanonicalCapture = (
  state: CrawlState,
  plan: CrawlPlan,
  sourceUrl: string,
  entry: CrawlEntry,
  page: PageObservation,
): void => {
  if (!isSameOrigin(page.url, new URL(sourceUrl).origin)) {
    state.diagnostics.push({
      code: 'blocked',
      finalUrl: page.url,
      message: 'The final browser URL left the permitted crawl origin.',
      sourceUrl: entry.sourceUrl,
      url: entry.url,
      viewportId: page.viewport.id,
    });
    return;
  }
  recordRedirect(state, entry, page);
  const captureKey = `${page.url}\u0000${page.viewport.id}\u0000default`;
  const captureFingerprint = fingerprint(page);
  const existingCaptureFingerprint = state.captureFingerprints.get(captureKey);
  if (existingCaptureFingerprint) {
    state.diagnostics.push(
      duplicateCaptureDiagnostic(entry, page, captureFingerprint, existingCaptureFingerprint),
    );
    return;
  }
  state.captureFingerprints.set(captureKey, captureFingerprint);
  state.canonicalUrls.add(page.url);
  state.pages.push(page);
  enqueueLinks(
    state.queue,
    page.links,
    new URL(sourceUrl).origin,
    entry,
    plan.maxDepth,
    state.visited,
  );
};

/*** Describe either an exact duplicate or a material conflict without merging browser evidence. */
const duplicateCaptureDiagnostic = (
  entry: CrawlEntry,
  page: PageObservation,
  captureFingerprint: string,
  existingCaptureFingerprint: string,
): CrawlDiagnostic => ({
  captureFingerprint,
  code: existingCaptureFingerprint === captureFingerprint ? 'duplicate' : 'conflict',
  existingCaptureFingerprint,
  finalUrl: page.url,
  message:
    existingCaptureFingerprint === captureFingerprint
      ? 'A duplicate canonical viewport capture was excluded.'
      : 'A materially conflicting canonical viewport capture was excluded.',
  sourceUrl: entry.sourceUrl,
  url: entry.url,
  viewportId: page.viewport.id,
});

/*** Record each requested-to-final URL redirect once while retaining the crawl source evidence. */
const recordRedirect = (state: CrawlState, entry: CrawlEntry, page: PageObservation): void => {
  recordRedirectUrl(state, entry, page.url);
};

/*** Record each proven requested-to-final URL mapping without inferring path equivalence. */
const recordRedirectUrl = (state: CrawlState, entry: CrawlEntry, finalUrl: string): void => {
  if (entry.url === finalUrl || state.redirects.has(`${entry.url}\u0000${finalUrl}`)) return;
  state.redirects.add(`${entry.url}\u0000${finalUrl}`);
  state.diagnostics.push({
    code: 'redirect',
    finalUrl,
    message: 'The requested URL redirected to the canonical final URL.',
    sourceUrl: entry.sourceUrl,
    url: entry.url,
  });
};

/*** Fingerprint every material browser fact so canonical capture conflicts are never silently merged. */
const fingerprint = (page: PageObservation): string =>
  createHash('sha256').update(JSON.stringify(page)).digest('hex');

/*** Apply the explicit resource bounds used for every crawl invocation. */
const createCrawlPlan = (options: CrawlOptions): CrawlPlan => ({
  maxBytes: options.maxBytesPerPage ?? 2_000_000,
  maxDepth: options.maxDepth ?? 1,
  maxPages: options.maxPages ?? 20,
  timeoutMs: options.navigationTimeoutMs ?? 15_000,
  ...(options.viewports ? { viewports: options.viewports } : {}),
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

/*** Identify the next request that was not navigated because the request budget was exhausted. */
const limitDiagnostic = (entry: CrawlEntry): CrawlDiagnostic => ({
  code: 'limit',
  message: 'The configured requested URL limit was reached.',
  sourceUrl: entry.sourceUrl,
  url: entry.url,
});
