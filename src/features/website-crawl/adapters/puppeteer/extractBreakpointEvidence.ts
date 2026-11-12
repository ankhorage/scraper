import type { BreakpointEvidence } from '../../../../types/public.js';

/*** Serialize isolated browser helpers so CSSOM traversal remains self-contained in page evaluation. */
export const extractBreakpointEvidence = (): string =>
  `(() => { ${[
    inspectStylesheet.toString(),
    inspectCssRules.toString(),
    inspectCssRule.toString(),
    appendBreakpointEvidence.toString(),
    hasBreakpointEvidenceCapacity.toString(),
    collectBreakpointEvidence.toString(),
  ].join('\n')} return collectBreakpointEvidence; })()`;

/*** Traverse one accessible stylesheet and retain a diagnostic when its CSSOM is inaccessible. */
function inspectStylesheet(
  sheet: CSSStyleSheet,
  source: string,
  evidence: BreakpointEvidence[],
  seen: Set<CSSStyleSheet>,
): void {
  if (seen.has(sheet)) return;
  seen.add(sheet);
  if (
    sheet.media.mediaText &&
    !appendBreakpointEvidence(evidence, {
      condition: sheet.media.mediaText,
      kind: 'viewport',
      source,
    })
  )
    return;
  try {
    inspectCssRules(sheet.cssRules, source, evidence, seen);
  } catch (error) {
    appendBreakpointEvidence(evidence, {
      condition: error instanceof Error ? error.name : 'CSSOM access failed',
      kind: 'diagnostic',
      source,
    });
  }
}

/*** Traverse a nested CSS rule list while retaining the source stylesheet. */
function inspectCssRules(
  rules: CSSRuleList,
  source: string,
  evidence: BreakpointEvidence[],
  seen: Set<CSSStyleSheet>,
): void {
  for (const rule of rules) {
    if (!hasBreakpointEvidenceCapacity(evidence)) return;
    inspectCssRule(rule, source, evidence, seen);
  }
}

/*** Classify CSS media, import, grouping, and container rules without treating containers as viewports. */
function inspectCssRule(
  rule: CSSRule,
  source: string,
  evidence: BreakpointEvidence[],
  seen: Set<CSSStyleSheet>,
): void {
  if (!hasBreakpointEvidenceCapacity(evidence)) return;
  if (rule instanceof CSSMediaRule) {
    if (
      !appendBreakpointEvidence(evidence, {
        condition: rule.conditionText,
        kind: 'viewport',
        source,
      })
    )
      return;
    inspectCssRules(rule.cssRules, source, evidence, seen);
  } else if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
    if (
      !appendBreakpointEvidence(evidence, {
        condition: rule.conditionText,
        kind: 'container',
        source,
      })
    )
      return;
    inspectCssRules(rule.cssRules, source, evidence, seen);
  } else if (rule instanceof CSSImportRule) {
    const importSource = rule.href || source;
    if (rule.media.mediaText)
      appendBreakpointEvidence(evidence, {
        condition: rule.media.mediaText,
        kind: 'viewport',
        source: importSource,
      });
    if (rule.styleSheet) inspectStylesheet(rule.styleSheet, importSource, evidence, seen);
  } else if ('cssRules' in rule) {
    inspectCssRules((rule as CSSGroupingRule).cssRules, source, evidence, seen);
  }
}

/*** Retain at most 127 source conditions plus one truthful diagnostic from hostile CSSOM input. */
function appendBreakpointEvidence(
  evidence: BreakpointEvidence[],
  item: BreakpointEvidence,
): boolean {
  if (evidence.length < 127) {
    evidence.push(item);
    return true;
  }
  if (evidence.length === 127)
    evidence.push({
      condition: 'Breakpoint CSSOM evidence limit reached.',
      kind: 'diagnostic',
      source: 'CSSOM',
    });
  return false;
}

/*** Stop recursive CSSOM traversal once the bounded evidence buffer is full. */
function hasBreakpointEvidenceCapacity(evidence: readonly BreakpointEvidence[]): boolean {
  return evidence.length < 128;
}

/*** Evaluate every document and adopted stylesheet and return deterministic unique responsive evidence. */
function collectBreakpointEvidence(): readonly BreakpointEvidence[] {
  const evidence: BreakpointEvidence[] = [];
  const seen = new Set<CSSStyleSheet>();
  [...document.styleSheets].forEach((sheet, index) =>
    inspectStylesheet(sheet, sheet.href ?? `document.styleSheets[${index}]`, evidence, seen),
  );
  [...document.adoptedStyleSheets].forEach((sheet, index) =>
    inspectStylesheet(sheet, `document.adoptedStyleSheets[${index}]`, evidence, seen),
  );
  return evidence
    .filter(
      (item, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.kind === item.kind &&
            candidate.condition === item.condition &&
            candidate.source === item.source,
        ) === index,
    )
    .sort((left, right) =>
      `${left.source}\u0000${left.condition}`.localeCompare(
        `${right.source}\u0000${right.condition}`,
      ),
    );
}
