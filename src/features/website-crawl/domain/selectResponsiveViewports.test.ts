import { describe, expect, test } from 'bun:test';

import { selectResponsiveViewports } from './selectResponsiveViewports.js';

describe('selectResponsiveViewports', () => {
  test('selects one initial width and one width for every responsive transition', () => {
    expect(
      selectResponsiveViewports([
        { condition: '(min-width: 480px)', kind: 'viewport', source: 'inline' },
        { condition: '(min-width: 768px)', kind: 'viewport', source: 'inline' },
        { condition: '(min-width: 1024px)', kind: 'viewport', source: 'inline' },
        { condition: '(min-width: 1280px)', kind: 'viewport', source: 'inline' },
      ]).map((viewport) => viewport.width),
    ).toEqual([320, 480, 768, 1024, 1280]);
  });

  test('honours legacy units and inclusive and exclusive range boundaries', () => {
    expect(
      selectResponsiveViewports([
        { condition: '(width > 30em)', kind: 'viewport', source: 'inline' },
        { condition: '(600px <= width < 900px)', kind: 'viewport', source: 'inline' },
        { condition: '(max-width: 70rem)', kind: 'viewport', source: 'inline' },
      ]).map((viewport) => viewport.width),
    ).toEqual([320, 481, 600, 900, 1121]);
  });

  test('does not turn container queries or fluid styles into viewport breakpoints', () => {
    expect(
      selectResponsiveViewports([
        { condition: '(width > 30rem)', kind: 'container', source: 'inline' },
        { condition: 'display: grid', kind: 'diagnostic', source: 'inline' },
      ]),
    ).toEqual([{ height: 900, id: 'auto-1440', width: 1440 }]);
  });

  test('bounds automatic capture plans for pathological responsive stylesheets', () => {
    expect(
      selectResponsiveViewports(
        Array.from({ length: 100 }, (_, index) => ({
          condition: `(min-width: ${index * 10 + 1}px)`,
          kind: 'viewport' as const,
          source: 'inline',
        })),
      ),
    ).toHaveLength(8);
  });

  test('keeps representative automatic widths within the safe browser viewport bound', () => {
    expect(
      selectResponsiveViewports([
        { condition: '(min-width: 100000px)', kind: 'viewport', source: 'inline' },
      ]),
    ).toEqual([{ height: 900, id: 'auto-320', width: 320 }]);
  });
});
