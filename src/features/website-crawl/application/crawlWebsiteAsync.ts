import { createHash } from 'node:crypto';

import type {
  BreakpointCoverage,
  BreakpointEvidence,
  CrawlDiagnostic,
  CrawlOptions,
  CrawlResult,
  PageObservation,
} from '../../../types/public.js';
import { recognizeWebsiteDocumentAsync } from '../../website-recognition/application/recognizeWebsiteDocumentAsync.js';
import { isSameOrigin } from '../domain/isSameOrigin.js';
import { normalizeUrl } from '../domain/normalizeUrl.js';
import type { CapturePagePort } from '../ports/CapturePagePort.js';
import type { RobotsPort } from '../ports/RobotsPort.js';
import { measureCrawlPhaseAsync } from '../utils/measureCrawlPhaseAsync.js';
import { type CrawlPlan, createCrawlPlan } from './createCrawlPlan.js';
import { toBreakpointDiagnostics } from './toBreakpointDiagnostics.js';
import { toWebsiteObservationDocument } from './toWebsiteObservationDocument.js';
import { verifyResponsiveCoverageAsync } from './verifyResponsiveCoverageAsync.js';

interface CrawlDependencies {
  readonly capturePage: CapturePagePort;
  readonly robots: RobotsPort;
}

interface CrawlState {
  readonly breakpointCoverage: BreakpointCoverage[];
  readonly breakpointEvidence: BreakpointEvidence[];
  readonly diagnostics: CrawlDiagnostic[];
  readonly captureFingerprints: Map<string, string>;
  readonly canonicalUrls: Set<string>;
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
  const startedAt = performance.now();
  try {
    const sourceUrl = normalizeUrl(options.url);
    const plan = createCrawlPlan(options);
    const state = createCrawlState(sourceUrl);
    while (state.queue.length > 0) {
      if (state.requestedUrls.size >= plan.maxPages) {
        const [next] = state.queue;
        if (next) state.diagnostics.push(limitDiagnostic(next));
        break;
      }
      await crawlNextEntryAsync(state, plan, sourceUrl, dependencies);
    }
    const document = toWebsiteObservationDocument(sourceUrl, state.pages);
    const result = {
      breakpointCoverage: state.breakpointCoverage,
      breakpointEvidence: state.breakpointEvidence,
      diagnostics: state.diagnostics,
      document,
      recognition: await recognizeWebsiteDocumentAsync(document),
    };
    await measureCrawlPhaseAsync(
      options.timing,
      'complete',
      () => Promise.resolve(),
      undefined,
      startedAt,
    );
    return result;
  } finally {
    await measureCrawlPhaseAsync(options.timing, 'browser-cleanup', () =>
      dependencies.capturePage.closeAsync(),
    );
  }
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
  if (
    !(await measureCrawlPhaseAsync(plan.timing, 'robots', () =>
      dependencies.robots.isAllowedAsync(entry.url),
    ))
  ) {
    state.diagnostics.push({
      code: 'robots',
      message: 'robots.txt disallowed this URL.',
      sourceUrl: entry.sourceUrl,
      url: entry.url,
    });
    return;
  }
  state.requestedUrls.add(entry.url);
  await captureEntryAsync(state, plan, sourceUrl, entry, dependencies.capturePage);
};

/*** Capture one requested URL at every viewport while enforcing canonical capture uniqueness. */
const captureEntryAsync = async (
  state: CrawlState,
  plan: CrawlPlan,
  sourceUrl: string,
  entry: CrawlEntry,
  capturePage: CapturePagePort,
): Promise<void> => {
  const viewports = await resolveViewportsAsync(state, plan, entry, capturePage);
  for (const viewport of viewports) {
    try {
      const page = await measureCrawlPhaseAsync(
        plan.timing,
        'viewport',
        () =>
          capturePage.capturePageAsync({
            ...(plan.dynamicCapture ? { dynamicCapture: plan.dynamicCapture } : {}),
            maxBytes: plan.maxBytes,
            timeoutMs: plan.timeoutMs,
            ...(plan.timing ? { timing: plan.timing } : {}),
            url: entry.url,
            viewport,
          }),
        viewport.id,
      );
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
};

/*** Discover, probe, and select each page's responsive states unless callers supplied an override. */
const resolveViewportsAsync = async (
  state: CrawlState,
  plan: CrawlPlan,
  entry: CrawlEntry,
  capturePage: CapturePagePort,
): Promise<readonly NonNullable<CrawlOptions['viewports']>[number][]> => {
  if (plan.viewports) return plan.viewports;
  if (!capturePage.discoverBreakpointsAsync) return [{ height: 900, id: 'desktop', width: 1440 }];
  try {
    const evidence = await capturePage.discoverBreakpointsAsync({
      maxBytes: plan.maxBytes,
      timeoutMs: plan.timeoutMs,
      url: entry.url,
    });
    state.breakpointEvidence.push(...evidence);
    state.diagnostics.push(...toBreakpointDiagnostics(entry.sourceUrl, entry.url, evidence));
    const responsiveCoverage = await verifyResponsiveCoverageAsync({
      capturePage,
      evidence,
      maxBytes: plan.maxBytes,
      sourceUrl: entry.sourceUrl,
      timeoutMs: plan.timeoutMs,
      url: entry.url,
    });
    state.breakpointCoverage.push(responsiveCoverage.coverage);
    state.diagnostics.push(...responsiveCoverage.diagnostics);
    return responsiveCoverage.coverage.measurements.map((measurement) => ({
      height: 900,
      id: `auto-${measurement.width}`,
      width: measurement.width,
    }));
  } catch (error) {
    state.diagnostics.push({
      code: 'breakpoint',
      message: `Breakpoint discovery failed; using the bounded default viewport. ${error instanceof Error ? error.message : String(error)}`,
      sourceUrl: entry.sourceUrl,
      url: entry.url,
    });
    return [{ height: 900, id: 'auto-1440', width: 1440 }];
  }
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
  if (entry.url === page.url || state.redirects.has(`${entry.url}\u0000${page.url}`)) return;
  state.redirects.add(`${entry.url}\u0000${page.url}`);
  state.diagnostics.push({
    code: 'redirect',
    finalUrl: page.url,
    message: 'The requested URL redirected to the canonical final URL.',
    sourceUrl: entry.sourceUrl,
    url: entry.url,
  });
};

/*** Fingerprint every material browser fact so canonical capture conflicts are never silently merged. */
const fingerprint = (page: PageObservation): string =>
  createHash('sha256').update(JSON.stringify(page)).digest('hex');

/*** Initialize the mutable queue and uniqueness boundaries for one normalized crawl origin. */
const createCrawlState = (sourceUrl: string): CrawlState => ({
  breakpointCoverage: [],
  breakpointEvidence: [],
  diagnostics: [],
  captureFingerprints: new Map<string, string>(),
  canonicalUrls: new Set<string>(),
  pages: [],
  queue: [{ depth: 0, sourceUrl, url: sourceUrl }],
  requestedUrls: new Set<string>(),
  redirects: new Set<string>(),
  visited: new Set<string>(),
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
