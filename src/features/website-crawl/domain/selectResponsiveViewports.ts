import type { BreakpointEvidence, CrawlViewport } from '../../../types/public.js';

const maximumViewportWidth = 3840;

export interface ResponsiveProbePlan {
  readonly candidates: readonly CrawlViewport[];
  readonly uncertainty: readonly string[];
}

/*** Derive integer viewport candidates from authored width thresholds without claiming coverage. */
export const createResponsiveProbePlan = (
  evidence: readonly BreakpointEvidence[],
): ResponsiveProbePlan => {
  const parsed = evidence.filter((item) => item.kind === 'viewport').map(parseCondition);
  const candidates = uniqueSorted([320, 1440, ...parsed.flatMap((item) => item.widths)]).filter(
    (width) => width > 0 && width <= maximumViewportWidth,
  );
  return {
    candidates: candidates.map((width) => ({ height: 900, id: `auto-${width}`, width })),
    uncertainty: uniqueStrings(parsed.flatMap((item) => item.uncertainty)),
  };
};

/*** Preserve the planning helper while returning every candidate state for browser verification. */
export const selectResponsiveViewports = (
  evidence: readonly BreakpointEvidence[],
): readonly CrawlViewport[] => createResponsiveProbePlan(evidence).candidates;

interface ParsedCondition {
  readonly uncertainty: readonly string[];
  readonly widths: readonly number[];
}

/*** Extract every measurable width transition from one authored CSS media condition. */
const parseCondition = (evidence: BreakpointEvidence): ParsedCondition => {
  if (isUniversalCondition(evidence.condition)) return { uncertainty: [], widths: [] };
  const comparisons = [
    ...evidence.condition.matchAll(widthComparisonPattern),
    ...evidence.condition.matchAll(widthFirstPattern),
  ];
  const widths = comparisons.flatMap((match) => transitionWidths(match));
  const containsWidth = /\b(?:min|max)-width\b|\bwidth\s*(?:[<>]=?|:)/iu.test(evidence.condition);
  const hasNonWidthFeature = containsNonWidthFeature(evidence.condition);
  return {
    widths,
    uncertainty:
      widths.length > 0
        ? hasNonWidthFeature
          ? [
              `Viewport condition includes non-width media features that bounded width probes cannot fully evaluate: ${evidence.condition}`,
            ]
          : []
        : [
            containsWidth
              ? `Unsupported viewport-width condition was retained but could not produce a numeric probe: ${evidence.condition}`
              : `Viewport condition has no measurable width threshold and was evaluated only at bounded baseline probes: ${evidence.condition}`,
          ],
  };
};

/*** Ignore universal media metadata because it carries no viewport transition to verify. */
const isUniversalCondition = (condition: string): boolean => /^\s*all\s*$/iu.test(condition);

/*** Identify media-feature clauses that width-only probes cannot independently exercise. */
const containsNonWidthFeature = (condition: string): boolean =>
  [...condition.matchAll(/\(([^()]*)\)/gu)].some(
    (match) => !/^(?:(?:min|max)-width\s*:|width\s*(?:[<>]=?))\s*/iu.test(match[1] ?? ''),
  );

const widthComparisonPattern =
  /(?:\b(min|max)-width\s*:\s*|\bwidth\s*)(<=|<|>=|>)?\s*([0-9]+(?:\.[0-9]+)?)(px|em|rem)\b|([0-9]+(?:\.[0-9]+)?)(px|em|rem)\s*(<=|<|>=|>)\s*width\b/giu;
const widthFirstPattern = /\bwidth\s*(<=|<|>=|>)\s*([0-9]+(?:\.[0-9]+)?)(px|em|rem)\b/giu;

/*** Convert one CSS width comparison into the first integer width of each adjacent regime. */
const transitionWidths = (match: RegExpMatchArray): readonly number[] => {
  const widthFirst = /^width\b/iu.test(match[0]);
  const legacy = widthFirst ? undefined : match[1];
  const operator = firstMatchedPart(widthFirst ? [match[1]] : [match[2], match[7]]);
  const numeric = firstMatchedPart(widthFirst ? [match[2]] : [match[3], match[5]]);
  const unit = firstMatchedPart(widthFirst ? [match[3]] : [match[4], match[6]]);
  if (numeric === undefined || unit === undefined) return [];
  const pixels = toPixels(numeric, unit);
  if (pixels === null) return [];
  const normalizedOperator =
    legacyOperator(legacy) ??
    (widthFirst || match[5] === undefined ? operator : reverseComparison(operator));
  return normalizedOperator === undefined ? [] : adjacentIntegerWidths(pixels, normalizedOperator);
};

/*** Return the first defined capture group from equivalent media-syntax alternatives. */
const firstMatchedPart = (parts: readonly (string | undefined)[]): string | undefined =>
  parts.find((part): part is string => part !== undefined);

/*** Normalize the legacy min-width and max-width feature names to comparison operators. */
const legacyOperator = (legacy: string | undefined): string | undefined =>
  legacy === 'min' ? '>=' : legacy === 'max' ? '<=' : undefined;

/*** Map a comparison to integer samples immediately on both sides of its boundary. */
const adjacentIntegerWidths = (value: number, operator: string): readonly number[] => {
  const boundary =
    operator === '>=' || operator === '<'
      ? Math.ceil(value)
      : operator === '>' || operator === '<='
        ? Math.floor(value) + 1
        : null;
  return boundary === null ? [] : [boundary - 1, boundary];
};

/*** Convert CSS media-query lengths using the specified initial font-size basis. */
const toPixels = (numeric: string, unit: string): number | null => {
  const multiplier = unit === 'px' ? 1 : unit === 'em' || unit === 'rem' ? 16 : null;
  const value = Number(numeric) * (multiplier ?? Number.NaN);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/*** Reverse a comparison whose numeric value appears before `width`. */
const reverseComparison = (operator: string | undefined): string | undefined =>
  operator === '<'
    ? '>'
    : operator === '<='
      ? '>='
      : operator === '>'
        ? '<'
        : operator === '>='
          ? '<='
          : undefined;

/*** Sort and deduplicate finite candidate widths before browser probing. */
const uniqueSorted = (widths: readonly number[]): readonly number[] =>
  [...new Set(widths.filter(Number.isSafeInteger))].sort((left, right) => left - right);

/*** Preserve one explanation for repeated authored conditions without losing raw evidence provenance. */
const uniqueStrings = (values: readonly string[]): readonly string[] => [...new Set(values)];
