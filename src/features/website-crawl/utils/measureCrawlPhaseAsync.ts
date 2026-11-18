import type { CrawlTimingOptions, CrawlTimingPhase } from '../../../types/public.js';

type CrawlTimingPhaseName = CrawlTimingPhase['phase'];

/*** Measure one crawl phase with the monotonic runtime clock and safely stream its bounded result. */
export const measureCrawlPhaseAsync = async <Value>(
  timing: CrawlTimingOptions | undefined,
  phase: CrawlTimingPhaseName,
  operation: () => Promise<Value>,
  viewportId?: string,
  phaseStartedAt = performance.now(),
): Promise<Value> => {
  try {
    const value = await operation();
    emitCrawlTiming(timing, {
      durationMs: performance.now() - phaseStartedAt,
      outcome: 'completed',
      phase,
      ...(viewportId ? { viewportId } : {}),
    });
    return value;
  } catch (error) {
    emitCrawlTiming(timing, {
      durationMs: performance.now() - phaseStartedAt,
      outcome: 'failed',
      phase,
      reason: classifyTimingFailure(error),
      ...(viewportId ? { viewportId } : {}),
    });
    throw error;
  }
};

/*** Stream one terminal crawl result without allowing consumer observability to alter crawling. */
const emitCrawlTiming = (timing: CrawlTimingOptions | undefined, phase: CrawlTimingPhase): void => {
  try {
    timing?.onPhase(phase);
  } catch {
    // Timing is observational and must not weaken the crawler's safety or completion behavior.
  }
};

/*** Reduce runtime failures to a bounded category without exposing error content to consumers. */
const classifyTimingFailure = (error: unknown): 'aborted' | 'error' | 'timeout' => {
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  return error instanceof Error && /timeout/iu.test(error.name) ? 'timeout' : 'error';
};
