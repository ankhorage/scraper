import type {
  BreakpointCoverage,
  BreakpointEvidence,
  BreakpointMeasurement,
  BreakpointOmission,
  BreakpointProbe,
  CrawlDiagnostic,
} from '../../../types/public.js';
import { createResponsiveProbePlan } from '../domain/selectResponsiveViewports.js';
import type { CapturePagePort } from '../ports/CapturePagePort.js';

interface VerifyResponsiveCoverageInput {
  readonly capturePage: CapturePagePort;
  readonly evidence: readonly BreakpointEvidence[];
  readonly maxBytes: number;
  readonly sourceUrl: string;
  readonly timeoutMs: number;
  readonly url: string;
}

interface ResponsiveCoverageResult {
  readonly coverage: BreakpointCoverage;
  readonly diagnostics: readonly CrawlDiagnostic[];
}

const maximumAutomaticCaptures = 8;
const maximumAutomaticProbes = 16;

/*** Verify responsive candidates in the browser and report bounded coverage truthfully. */
export const verifyResponsiveCoverageAsync = async ({
  capturePage,
  evidence,
  maxBytes,
  sourceUrl,
  timeoutMs,
  url,
}: VerifyResponsiveCoverageInput): Promise<ResponsiveCoverageResult> => {
  const probePlan = createResponsiveProbePlan(evidence);
  const bounded = boundProbeCandidates(probePlan.candidates.map((candidate) => candidate.width));
  const coverage = capturePage.probeResponsiveAsync
    ? await verifiedCoverageAsync({
        capturePage,
        evidence,
        maxBytes,
        probePlan,
        timeoutMs,
        url,
        ...bounded,
      })
    : unverifiedCoverage(url, evidence, bounded.selected, bounded.omitted, probePlan.uncertainty);
  return { coverage, diagnostics: coverageDiagnostics(sourceUrl, url, coverage) };
};

/*** Bound lightweight probes while distributing samples across the discovered responsive range. */
const boundProbeCandidates = (
  candidates: readonly number[],
): { readonly omitted: readonly BreakpointOmission[]; readonly selected: readonly number[] } => {
  if (candidates.length <= maximumAutomaticProbes) return { omitted: [], selected: candidates };
  const selected = evenlyDistributedCandidates(candidates, maximumAutomaticProbes);
  const selectedSet = new Set(selected);
  return {
    omitted: candidates
      .filter((width) => !selectedSet.has(width))
      .map((width) => ({
        reason: 'Candidate regime was not probed because the sixteen-probe budget was exhausted.',
        width,
      })),
    selected,
  };
};

/*** Select ordered candidate quantiles so neighbouring thresholds cannot exhaust the probe budget. */
const evenlyDistributedCandidates = (
  candidates: readonly number[],
  limit: number,
): readonly number[] =>
  Array.from({ length: limit }, (_, index) => {
    const candidateIndex = Math.round((index * (candidates.length - 1)) / (limit - 1));
    return candidates.at(candidateIndex) ?? candidates.at(-1) ?? 1440;
  });

/*** Use browser probes to select one full observation for every meaningfully distinct state. */
const verifiedCoverageAsync = async ({
  capturePage,
  evidence,
  maxBytes,
  omitted,
  probePlan,
  selected,
  timeoutMs,
  url,
}: {
  readonly capturePage: CapturePagePort;
  readonly evidence: readonly BreakpointEvidence[];
  readonly maxBytes: number;
  readonly omitted: readonly BreakpointOmission[];
  readonly probePlan: ReturnType<typeof createResponsiveProbePlan>;
  readonly selected: readonly number[];
  readonly timeoutMs: number;
  readonly url: string;
}): Promise<BreakpointCoverage> => {
  const conditions = evidence
    .filter((item) => item.kind === 'viewport')
    .map((item) => item.condition);
  const probes = await capturePage.probeResponsiveAsync?.({
    conditions,
    maxBytes,
    timeoutMs,
    url,
    widths: selected,
  });
  if (!probes) throw new Error('Responsive probe capability became unavailable.');
  const measurements = selectVerifiedMeasurements(probes);
  return {
    evidence,
    measurements: measurements.slice(0, maximumAutomaticCaptures),
    omissions: [
      ...omitted,
      ...measurements.slice(maximumAutomaticCaptures).map((measurement) => ({
        reason:
          'Verified responsive state omitted because the eight full-capture budget was exhausted.',
        width: measurement.width,
      })),
    ],
    probes,
    sourceUrl: url,
    uncertainty: probePlan.uncertainty,
  };
};

/*** Retain the first ascending probe from each distinct semantic responsive state. */
const selectVerifiedMeasurements = (
  probes: readonly BreakpointProbe[],
): readonly BreakpointMeasurement[] => {
  const signatures = new Set<string>();
  return probes
    .filter((probe) => {
      const signature = JSON.stringify({
        hasHorizontalOverflow: probe.hasHorizontalOverflow,
        layout: probe.layout,
        navigation: probe.navigation,
      });
      if (signatures.has(signature)) return false;
      signatures.add(signature);
      return true;
    })
    .map((probe, index) => ({
      reason:
        index === 0
          ? 'Baseline browser-responsive state verified by navigation, layout, and overflow probe.'
          : 'Browser-responsive state differs in navigation, layout, or overflow from earlier probes.',
      width: probe.width,
    }));
};

/*** Report conservative bounded captures when the adapter cannot supply responsive probes. */
const unverifiedCoverage = (
  sourceUrl: string,
  evidence: readonly BreakpointEvidence[],
  candidates: readonly number[],
  omissions: readonly BreakpointOmission[],
  uncertainty: readonly string[],
): BreakpointCoverage => ({
  evidence,
  measurements: candidates.slice(0, maximumAutomaticCaptures).map((width) => ({
    reason:
      'Browser probe adapter unavailable; full capture retained without responsive verification.',
    width,
  })),
  omissions: [
    ...omissions,
    ...candidates.slice(maximumAutomaticCaptures).map((width) => ({
      reason:
        'Candidate regime omitted because browser verification is unavailable and the full-capture budget was exhausted.',
      width,
    })),
  ],
  probes: [],
  sourceUrl,
  uncertainty: [
    ...uncertainty,
    'Responsive browser verification was unavailable; CSS conditions alone do not prove complete coverage.',
  ],
});

/*** Convert explicit coverage omissions and uncertainties into crawler diagnostics. */
const coverageDiagnostics = (
  sourceUrl: string,
  url: string,
  coverage: BreakpointCoverage,
): readonly CrawlDiagnostic[] => [
  ...coverage.omissions.map((omission) => ({
    code: 'breakpoint' as const,
    message: `${omission.reason} Width: ${omission.width}px.`,
    sourceUrl,
    url,
  })),
  ...coverage.uncertainty.map((message) => ({
    code: 'breakpoint' as const,
    message,
    sourceUrl,
    url,
  })),
];
