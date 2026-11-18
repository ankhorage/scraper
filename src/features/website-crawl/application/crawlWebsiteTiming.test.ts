import { expect, test } from 'bun:test';

import type { CrawlTimingPhase } from '../../../types/public.js';
import { crawlWebsiteAsync } from './crawlWebsiteAsync.js';

test(
  'emits bounded failure and cleanup timing phases when robots checking times out',
  testTimingFailureAsync,
);

/*** Verify a failed robots phase still closes the browser boundary and exposes no error content. */
async function testTimingFailureAsync(): Promise<void> {
  const timings: CrawlTimingPhase[] = [];
  const failure = Object.assign(new Error('Fixture timeout'), { name: 'TimeoutError' });
  const closed = { value: false };
  const error = await crawlWebsiteAsync(
    { timing: { onPhase: (phase) => timings.push(phase) }, url: 'https://example.test/' },
    {
      capturePage: {
        capturePageAsync: () =>
          Promise.reject(new Error('Capture must not run after robots failure.')),
        closeAsync: () => {
          closed.value = true;
          return Promise.resolve();
        },
      },
      robots: { isAllowedAsync: () => Promise.reject(failure) },
    },
  ).then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error).toBe(failure);
  expect(closed.value).toBe(true);
  assertFailureTimings(timings);
}

/*** Assert failure categories and cleanup ordering without collecting page, URL, or error payloads. */
function assertFailureTimings(timings: readonly CrawlTimingPhase[]): void {
  const robots = timings.find((phase) => phase.phase === 'robots');
  expect(robots?.outcome).toBe('failed');
  expect(robots?.reason).toBe('timeout');
  expect(timings.at(-1)).toMatchObject({ outcome: 'completed', phase: 'browser-cleanup' });
}
