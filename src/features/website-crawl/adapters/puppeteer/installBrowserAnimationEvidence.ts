import type { WebsiteAnimationEvidence } from '@ankhorage/contracts/website';

declare global {
  var __ankhorageScraperExtractAnimationEvidence: (element: Element) => WebsiteAnimationEvidence;
}

/*** Install browser-local animation serialization before page scripts can mutate candidate state. */
export const installBrowserAnimationEvidence = (): void => {
  globalThis.__ankhorageScraperExtractAnimationEvidence = (element) => {
    const property = (value: string) => ({
      availability: { missing: null, status: 'available' as const },
      value,
    });
    const unavailableProperty = (missing: { readonly code: string; readonly message: string }) => ({
      availability: { missing, status: 'missing' as const },
      value: null,
    });
    const pseudoElements = (['::before', '::after'] as const).map((pseudo) => {
      const style = getComputedStyle(element, pseudo);
      const missing = {
        code: 'pseudo-element-unavailable',
        message: `No generated ${pseudo} element was observed.`,
      };
      if (style.content === 'none' || style.display === 'none') {
        return {
          availability: { missing, status: 'missing' as const },
          boxSize: { height: unavailableProperty(missing), width: unavailableProperty(missing) },
          content: unavailableProperty(missing),
          css: null,
          pseudo,
        };
      }
      return {
        availability: { missing: null, status: 'available' as const },
        boxSize: { height: property(style.height), width: property(style.width) },
        content: property(style.content),
        css: globalThis.__ankhorageScraperExtractCss(style),
        pseudo,
      };
    });
    const style = getComputedStyle(element);
    return {
      pseudoElements,
      target: {
        animation: property(style.animation),
        transform: property(style.transform),
        transition: property(style.transition),
      },
      trigger: 'scroll-into-view',
      uncertainty: [],
    };
  };
};
