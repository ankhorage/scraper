import { expect, test } from 'bun:test';

import {
  createResponsiveProbePlan,
  selectResponsiveViewports,
} from './selectResponsiveViewports.js';

test('selects one initial width and one width for every responsive transition', () => {
  expect(
    selectResponsiveViewports([
      {
        condition: '(min-width: 480px)',
        kind: 'viewport',
        source: 'inline',
        sourceUrl: 'https://example.test/',
      },
      {
        condition: '(min-width: 768px)',
        kind: 'viewport',
        source: 'inline',
        sourceUrl: 'https://example.test/',
      },
      {
        condition: '(min-width: 1024px)',
        kind: 'viewport',
        source: 'inline',
        sourceUrl: 'https://example.test/',
      },
      {
        condition: '(min-width: 1280px)',
        kind: 'viewport',
        source: 'inline',
        sourceUrl: 'https://example.test/',
      },
    ]).map((viewport) => viewport.width),
  ).toEqual([320, 479, 480, 767, 768, 1023, 1024, 1279, 1280, 1440]);
});

test('honours legacy units and inclusive and exclusive range boundaries', () => {
  expect(
    selectResponsiveViewports([
      {
        condition: '(width > 30em)',
        kind: 'viewport',
        source: 'inline',
        sourceUrl: 'https://example.test/',
      },
      {
        condition: '(600px <= width < 900px)',
        kind: 'viewport',
        source: 'inline',
        sourceUrl: 'https://example.test/',
      },
      {
        condition: '(max-width: 70rem)',
        kind: 'viewport',
        source: 'inline',
        sourceUrl: 'https://example.test/',
      },
    ]).map((viewport) => viewport.width),
  ).toEqual([320, 480, 481, 599, 600, 899, 900, 1120, 1121, 1440]);
});

test('does not turn container queries or fluid styles into viewport breakpoints', () => {
  expect(
    selectResponsiveViewports([
      {
        condition: '(width > 30rem)',
        kind: 'container',
        source: 'inline',
        sourceUrl: 'https://example.test/',
      },
      {
        condition: 'display: grid',
        kind: 'diagnostic',
        source: 'inline',
        sourceUrl: 'https://example.test/',
      },
    ]),
  ).toEqual([
    { height: 900, id: 'auto-320', width: 320 },
    { height: 900, id: 'auto-1440', width: 1440 },
  ]);
});

test('retains every candidate so the verification layer can report coverage truncation', () => {
  expect(
    selectResponsiveViewports(
      Array.from({ length: 100 }, (_, index) => ({
        condition: `(min-width: ${index * 10 + 1}px)`,
        kind: 'viewport' as const,
        source: 'inline',
        sourceUrl: 'https://example.test/',
      })),
    ),
  ).toHaveLength(200);
});

test('does not present a compound non-width media condition as complete width coverage', () => {
  const plan = createResponsiveProbePlan([
    {
      condition: '(min-width: 600px) and (prefers-color-scheme: dark)',
      kind: 'viewport',
      source: 'inline',
      sourceUrl: 'https://example.test/',
    },
  ]);
  expect(plan.candidates.map((viewport) => viewport.width)).toEqual([320, 599, 600, 1440]);
  expect(plan.uncertainty).toEqual([
    'Viewport condition includes non-width media features that bounded width probes cannot fully evaluate: (min-width: 600px) and (prefers-color-scheme: dark)',
  ]);
});

test('keeps representative automatic widths within the safe browser viewport bound', () => {
  expect(
    selectResponsiveViewports([
      {
        condition: '(min-width: 100000px)',
        kind: 'viewport',
        source: 'inline',
        sourceUrl: 'https://example.test/',
      },
    ]),
  ).toEqual([
    { height: 900, id: 'auto-320', width: 320 },
    { height: 900, id: 'auto-1440', width: 1440 },
  ]);
});

test('retains comma-separated width alternatives while ignoring universal and invalid transitions', () => {
  const plan = createResponsiveProbePlan([
    {
      condition: '(max-width: 599px), (min-width: 1024px)',
      kind: 'viewport',
      source: 'inline',
      sourceUrl: 'https://example.test/',
    },
    {
      condition: 'all',
      kind: 'viewport',
      source: 'first',
      sourceUrl: 'https://example.test/',
    },
    {
      condition: 'all',
      kind: 'viewport',
      source: 'second',
      sourceUrl: 'https://example.test/',
    },
    {
      condition: '(min-width: -1px)',
      kind: 'viewport',
      source: 'vendor',
      sourceUrl: 'https://example.test/',
    },
  ]);

  expect(plan.candidates.map((viewport) => viewport.width)).toEqual([
    320, 599, 600, 1023, 1024, 1440,
  ]);
  expect(plan.uncertainty).toEqual([
    'Unsupported viewport-width condition was retained but could not produce a numeric probe: (min-width: -1px)',
  ]);
});
