import type { BreakpointEvidence, CrawlDiagnostic } from '../../../types/public.js';

/*** Surface unsupported CSSOM evidence without conflating container conditions with viewport rules. */
export const toBreakpointDiagnostics = (
  sourceUrl: string,
  url: string,
  evidence: readonly BreakpointEvidence[],
): CrawlDiagnostic[] =>
  evidence
    .filter((item) => item.kind !== 'viewport')
    .map((item) => ({
      code: 'breakpoint' as const,
      message:
        item.kind === 'container'
          ? `Container query retained as evidence but excluded from viewport selection: ${item.condition}`
          : item.condition === 'Breakpoint CSSOM evidence limit reached.'
            ? 'CSSOM breakpoint evidence reached its bounded limit; automatic selection may be incomplete.'
            : `Stylesheet CSSOM could not be read: ${item.source} (${item.condition})`,
      sourceUrl,
      url,
    }));
