declare global {
  var __ankhorageScraperReadRelevantState: (element: Element) => string;
}

/*** Install animation-state extraction that deliberately excludes viewport-relative scroll position. */
export const installBrowserRelevantState = (): void => {
  const pseudoState = (element: Element, pseudo: '::after' | '::before'): readonly string[] => {
    const style = getComputedStyle(element, pseudo);
    return [style.content, style.width, style.height, style.opacity, style.transform];
  };
  const relevantElements = (element: Element): readonly Element[] =>
    element.matches('progress, [role="progressbar"], [aria-valuenow], [value]') ||
    /(?:progress|counter|reveal|animate|motion)/i.test(element.getAttribute('class') ?? '')
      ? [
          element,
          ...[...element.querySelectorAll('*')].filter((descendant) => {
            const style = getComputedStyle(descendant);
            return (
              descendant.matches('progress, [role="progressbar"], [aria-valuenow], [value]') ||
              /(?:progress|counter|reveal|animate|motion|fill|bar)/i.test(
                descendant.getAttribute('class') ?? '',
              ) ||
              style.transform !== 'none' ||
              style.opacity !== '1'
            );
          }),
        ]
      : [element];
  globalThis.__ankhorageScraperReadRelevantState = (element) =>
    relevantElements(element)
      .map((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const style = getComputedStyle(candidate);
        return [
          globalThis.__ankhorageScraperElementPath(candidate),
          candidate.getAttribute('aria-valuenow'),
          candidate.getAttribute('value'),
          /(?:counter|count)/i.test(candidate.getAttribute('class') ?? '')
            ? candidate.textContent
            : '',
          rect.width,
          rect.height,
          style.opacity,
          style.transform,
          style.transition,
          style.animation,
          ...pseudoState(candidate, '::before'),
          ...pseudoState(candidate, '::after'),
        ].join(':');
      })
      .join('|');
};
