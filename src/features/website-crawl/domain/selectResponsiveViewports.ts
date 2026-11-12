import type { BreakpointEvidence, CrawlViewport } from '../../../types/public.js';

interface WidthRange {
  readonly lower?: { readonly inclusive: boolean; readonly value: number };
  readonly upper?: { readonly inclusive: boolean; readonly value: number };
}

const maximumAutomaticViewports = 8;
const maximumViewportWidth = 3840;

/*** Select one bounded representative viewport for each CSS viewport-media layout region. */
export const selectResponsiveViewports = (
  evidence: readonly BreakpointEvidence[],
): readonly CrawlViewport[] => {
  const ranges = evidence
    .filter((item) => item.kind === 'viewport')
    .flatMap((item) => parseWidthRange(item.condition));
  const widths = [320, ...ranges.flatMap(rangeTransitionWidths)].filter(
    (value) => Number.isSafeInteger(value) && value > 0 && value <= maximumViewportWidth,
  );
  const uniqueWidths = selectRepresentativeWidths(
    [...new Set(widths)].sort((left, right) => left - right),
  );
  return ranges.length === 0
    ? [{ height: 900, id: 'auto-1440', width: 1440 }]
    : uniqueWidths.map((width) => ({ height: 900, id: `auto-${width}`, width }));
};

/*** Keep automatic captures bounded while sampling the full ordered set of CSS transition widths. */
const selectRepresentativeWidths = (widths: readonly number[]): readonly number[] =>
  widths.length <= maximumAutomaticViewports
    ? widths
    : Array.from(
        { length: maximumAutomaticViewports },
        (_, index) =>
          widths[Math.round((index * (widths.length - 1)) / (maximumAutomaticViewports - 1))] ??
          320,
      );

/*** Pick each initial region and each precise point where a media-query result can change. */
const rangeTransitionWidths = (range: WidthRange): readonly number[] => [
  ...(range.lower ? [range.lower.inclusive ? range.lower.value : range.lower.value + 1] : []),
  ...(range.upper ? [range.upper.inclusive ? range.upper.value + 1 : range.upper.value] : []),
];

/*** Parse conjunctions of CSS viewport-width comparisons without guessing at unsupported media syntax. */
const parseWidthRange = (condition: string): readonly WidthRange[] =>
  condition
    .split(/\s*,\s*|\s+or\s+/iu)
    .map(parseWidthConjunction)
    .filter((range): range is WidthRange => range !== null);

/*** Resolve one comma-separated media-query branch only when every relevant comparison is measurable. */
const parseWidthConjunction = (condition: string): WidthRange | null => {
  const comparisons = [...condition.matchAll(/\(([^()]+)\)/gu)].map((match) => match[1] ?? '');
  if (comparisons.length === 0) return null;
  const ranges = comparisons.map(parseWidthComparison);
  if (ranges.some((range) => range === null)) return null;
  const parsed = ranges.filter((range): range is WidthRange => range !== null);
  return parsed.length === 0 ? null : combineWidthRanges(parsed);
};

/*** Convert legacy and range-syntax width terms into inclusive integer CSS-pixel bounds. */
const parseWidthComparison = (value: string): WidthRange | null => {
  const normalized = value.trim().toLowerCase();
  return (
    parseChainedRange(normalized) ??
    parseLegacyRange(normalized) ??
    parseWidthFirstRange(normalized) ??
    parseValueFirstRange(normalized)
  );
};

/*** Parse a chained range such as `600px <= width < 900px`. */
const parseChainedRange = (normalized: string): WidthRange | null => {
  const chained = /^([0-9.]+)(px|em|rem)\s*(<=|<)\s*width\s*(<=|<)\s*([0-9.]+)(px|em|rem)$/u.exec(
    normalized,
  );
  if (!chained) return null;
  const lower = toPixels(chained[1] ?? '', chained[2] ?? '');
  const upper = toPixels(chained[5] ?? '', chained[6] ?? '');
  if (lower === null || upper === null) return null;
  return {
    lower: { inclusive: (chained[3] ?? '') === '<=', value: lower },
    upper: { inclusive: (chained[4] ?? '') === '<=', value: upper },
  };
};

/*** Parse legacy `min-width` and `max-width` media features. */
const parseLegacyRange = (normalized: string): WidthRange | null => {
  const legacy = /^(min|max)-width\s*:\s*([0-9.]+)(px|em|rem)$/u.exec(normalized);
  if (!legacy) return null;
  const pixels = toPixels(legacy[2] ?? '', legacy[3] ?? '');
  return pixels === null
    ? null
    : legacy[1] === 'min'
      ? { lower: { inclusive: true, value: pixels } }
      : { upper: { inclusive: true, value: pixels } };
};

/*** Parse a comparison whose viewport width is written first. */
const parseWidthFirstRange = (normalized: string): WidthRange | null => {
  const widthFirst = /^width\s*(<=|<|>=|>)\s*([0-9.]+)(px|em|rem)$/u.exec(normalized);
  return widthFirst
    ? comparisonRange(widthFirst[1] ?? '', toPixels(widthFirst[2] ?? '', widthFirst[3] ?? ''))
    : null;
};

/*** Parse a comparison whose viewport width is written last. */
const parseValueFirstRange = (normalized: string): WidthRange | null => {
  const valueFirst = /^([0-9.]+)(px|em|rem)\s*(<=|<|>=|>)\s*width$/u.exec(normalized);
  if (!valueFirst) return null;
  const pixels = toPixels(valueFirst[1] ?? '', valueFirst[2] ?? '');
  return pixels === null ? null : comparisonRange(reverseComparison(valueFirst[3] ?? ''), pixels);
};

/*** Convert CSS root-relative width units using the browser default root font size. */
const toPixels = (numeric: string | undefined, unit: string | undefined): number | null => {
  if (numeric === undefined || unit === undefined) return null;
  const value = Number(numeric) * (unit === 'px' ? 1 : 16);
  return Number.isFinite(value) && value >= 0 && Number.isInteger(value) ? value : null;
};

/*** Map one width comparison to its lower or upper bound. */
const comparisonRange = (operator: string, value: number | null): WidthRange | null => {
  if (value === null) return null;
  return operator === '>='
    ? { lower: { inclusive: true, value } }
    : operator === '>'
      ? { lower: { inclusive: false, value } }
      : operator === '<='
        ? { upper: { inclusive: true, value } }
        : operator === '<'
          ? { upper: { inclusive: false, value } }
          : null;
};

/*** Reverse a comparison whose numeric value appears before width. */
const reverseComparison = (operator: string): string =>
  operator === '<' ? '>' : operator === '<=' ? '>=' : operator === '>' ? '<' : '<=';

/*** Intersect CSS width bounds while preserving their precise inclusive edges. */
const combineWidthRanges = (ranges: readonly WidthRange[]): WidthRange => {
  const lower = ranges.map((range) => range.lower).reduce(selectLower);
  const upper = ranges.map((range) => range.upper).reduce(selectUpper);
  return {
    ...(lower ? { lower } : {}),
    ...(upper ? { upper } : {}),
  };
};

/*** Select the tightest lower bound from an optional pair. */
const selectLower = (
  current: WidthRange['lower'],
  candidate: WidthRange['lower'],
): WidthRange['lower'] =>
  current === undefined
    ? candidate
    : candidate === undefined || candidate.value < current.value
      ? current
      : candidate.value > current.value
        ? candidate
        : { inclusive: current.inclusive && candidate.inclusive, value: current.value };

/*** Select the tightest upper bound from an optional pair. */
const selectUpper = (
  current: WidthRange['upper'],
  candidate: WidthRange['upper'],
): WidthRange['upper'] =>
  current === undefined
    ? candidate
    : candidate === undefined || candidate.value > current.value
      ? current
      : candidate.value < current.value
        ? candidate
        : { inclusive: current.inclusive && candidate.inclusive, value: current.value };
