declare global {
  var __ankhorageScraperReadRelevantState: (element: Element) => string;
}

/*** Install relevant target-state extraction without treating incidental descendant mutations as progress. */
export const installBrowserRelevantState = (): void => {
  globalThis.__ankhorageScraperReadRelevantState = (element) =>
    (element.matches('progress, [role="progressbar"], [aria-valuenow]')
      ? [
          element,
          ...[...element.querySelectorAll('*')].filter((descendant) => {
            const style = getComputedStyle(descendant);
            return (
              descendant.matches('progress, [role="progressbar"], [aria-valuenow], [value]') ||
              /(?:progress|fill|bar)/i.test(descendant.getAttribute('class') ?? '') ||
              style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
              style.backgroundImage !== 'none'
            );
          }),
        ]
      : [element]
    )
      .map((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const style = getComputedStyle(candidate);
        return [
          globalThis.__ankhorageScraperElementPath(candidate),
          candidate.getAttribute('aria-valuenow'),
          candidate.getAttribute('value'),
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          style.opacity,
          style.transform,
        ].join(':');
      })
      .join('|');
};
