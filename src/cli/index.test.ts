import { areCapabilitiesEqual, isCapability } from '@ankhorage/capability';
import { expect, test } from 'bun:test';

import packageJson from '../../package.json' with { type: 'json' };
import { CAPABILITIES } from '../capabilities/index.js';
import provider from './index.js';

test('publishes the canonical Scraper capability and matching crawl handler', () => {
  expect(CAPABILITIES).toHaveLength(1);
  expect(CAPABILITIES.every(isCapability)).toBeTrue();
  expect(CAPABILITIES[0]).toMatchObject({
    id: 'scraper.crawl',
    owner: '@ankhorage/scraper',
    access: ['invoke'],
    binding: { kind: 'action', bindableAs: ['target'] },
  });
  expect(packageJson.exports['./cli']).toEqual({
    types: './dist/cli/index.d.ts',
    import: './dist/cli/index.js',
  });
  expect(packageJson.exports['./capabilities']).toEqual({
    types: './dist/capabilities/index.d.ts',
    import: './dist/capabilities/index.js',
  });
  const published = packageJson.ankh.capabilities.at(0);
  expect(isCapability(published)).toBeTrue();
  if (!isCapability(published)) return;
  expect(areCapabilitiesEqual(published, CAPABILITIES[0])).toBeTrue();
  expect(provider.capabilities).toBe(CAPABILITIES);
  expect(provider.commands.map(({ path }) => path)).toEqual([['crawl']]);
  expect(provider.handlers.map(({ path }) => path)).toEqual([['crawl']]);
});
