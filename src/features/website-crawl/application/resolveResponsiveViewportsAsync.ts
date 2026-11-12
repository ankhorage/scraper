import type {
  BreakpointCoverage,
  BreakpointEvidence,
  CrawlDiagnostic,
  CrawlOptions,
} from '../../../types/public.js';
import type { CapturePagePort } from '../ports/CapturePagePort.js';
import { verifyResponsiveCoverageAsync } from './verifyResponsiveCoverageAsync.js';

interface ResolveResponsiveViewportsInput {
  readonly capturePage: CapturePagePort;
  readonly entry: { readonly sourceUrl: string; readonly url: string };
  readonly plan: {
    readonly maxBytes: number;
    readonly timeoutMs: number;
    readonly viewports?: CrawlOptions['viewports'];
  };
  readonly state: {
    readonly breakpointCoverage: BreakpointCoverage[];
    readonly breakpointEvidence: BreakpointEvidence[];
    readonly diagnostics: CrawlDiagnostic[];
  };
}

/*** Discover, probe, and select page-local responsive states unless callers supplied an override. */
export const resolveResponsiveViewportsAsync = async ({
  capturePage,
  entry,
  plan,
  state,
}: ResolveResponsiveViewportsInput): Promise<
  readonly NonNullable<CrawlOptions['viewports']>[number][]
> => {
  if (plan.viewports) return plan.viewports;
  if (!capturePage.discoverBreakpointsAsync) return [{ height: 900, id: 'desktop', width: 1440 }];
  try {
    const evidence = await capturePage.discoverBreakpointsAsync({
      maxBytes: plan.maxBytes,
      timeoutMs: plan.timeoutMs,
      url: entry.url,
    });
    state.breakpointEvidence.push(...evidence);
    state.diagnostics.push(...breakpointDiagnostics(entry, evidence));
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

/*** Surface unsupported CSSOM evidence without conflating container conditions with viewport rules. */
const breakpointDiagnostics = (
  entry: ResolveResponsiveViewportsInput['entry'],
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
      sourceUrl: entry.sourceUrl,
      url: entry.url,
    }));
