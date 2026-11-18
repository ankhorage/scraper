import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, expect, test } from 'bun:test';

import { createWebsiteCrawler } from '../../../index.js';
import type { CrawlTimingPhase } from '../../../types/public.js';

let origin = '';
let server: Server;

beforeAll(async () => {
  server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(timingPage);
  });
  origin = await listenAsync(server);
});

afterAll(async () => closeAsync(server));

test(
  'streams bounded data-minimizing timings through 1440, 768, and 390 pixel Chromium captures',
  testCrawlTimingAsync,
  30_000,
);

/*** Validate phase ordering and the one-settling-budget-per-viewport invariant at the public edge. */
async function testCrawlTimingAsync(): Promise<void> {
  const timings: CrawlTimingPhase[] = [];
  const crawler = createWebsiteCrawler({
    allowPrivateHostsForTests: true,
    launchArguments: chromiumLaunchArguments,
  });
  await crawler.crawlWebsiteAsync({
    dynamicCapture: dynamicCapture,
    maxDepth: 0,
    maxPages: 1,
    navigationTimeoutMs: 10_000,
    timing: { onPhase: (phase) => timings.push(phase) },
    url: origin,
    viewports,
  });

  expect(timings[0]?.phase).toBe('browser-start');
  expect(timings.at(-1)?.phase).toBe('browser-cleanup');
  expect(timings.every((phase) => phase.durationMs >= 0)).toBe(true);
  expect(timings.every((phase) => phase.outcome === 'completed')).toBe(true);
  expect(timings.some((phase) => phase.phase === 'complete')).toBe(true);
  expect(timings.filter((phase) => phase.phase === 'robots')).toHaveLength(1);
  expect(
    timings.filter((phase) => phase.phase === 'viewport').map((phase) => phase.viewportId),
  ).toEqual(['desktop', 'tablet', 'mobile']);
  expect(timings.filter((phase) => phase.phase === 'navigation')).toHaveLength(3);
  expect(timings.filter((phase) => phase.phase === 'dom-extraction')).toHaveLength(3);
  expect(timings.filter((phase) => phase.phase === 'dynamic-activation')).toHaveLength(3);
  assertSettlingBudget(timings);
  expect(timings.every(hasOnlyTimingFields)).toBe(true);
}

/*** Prove inactive dynamic candidates settle once per requested viewport rather than consuming retries. */
function assertSettlingBudget(timings: readonly CrawlTimingPhase[]): void {
  const settling = timings.filter((phase) => phase.phase === 'dynamic-settling');
  expect(settling).toHaveLength(3);
  expect(settling.every((phase) => phase.durationMs < 250)).toBe(true);
}

/*** Keep the public timing payload restricted to monotonic metadata and explicit viewport identities. */
function hasOnlyTimingFields(phase: CrawlTimingPhase): boolean {
  return Object.keys(phase).every((key) =>
    ['durationMs', 'outcome', 'phase', 'reason', 'viewportId'].includes(key),
  );
}

/*** Bind the deterministic Chromium fixture to an ephemeral loopback port. */
async function listenAsync(fixture: Server): Promise<string> {
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const address = fixture.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture server.');
  return `http://127.0.0.1:${address.port}`;
}

/*** Close the deterministic fixture after the public browser acceptance completes. */
function closeAsync(fixture: Server): Promise<void> {
  return new Promise<void>((resolve, reject) =>
    fixture.close((error) => (error ? reject(error) : resolve())),
  );
}

const dynamicCapture = {
  maxCandidates: 1,
  overallTimeoutMs: 500,
  perTargetTimeoutMs: 80,
  stabilityWindowMs: 20,
} as const;

const viewports = [
  { height: 900, id: 'desktop', width: 1440 },
  { height: 800, id: 'tablet', width: 768 },
  { height: 844, id: 'mobile', width: 390 },
] as const;

const chromiumLaunchArguments = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-crash-reporter',
  '--single-process',
] as const;

const timingPage =
  '<!doctype html><html><body><main class="progress no-op">No relevant animation</main></body></html>';
