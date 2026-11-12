import { expect, test } from 'bun:test';

import { crawl } from './crawl.js';

const invalidRequests = [
  ['--max-pages', '999999999999999999999999999999999999999999999999999999999999999999'],
  ['--max-pages', '1.5'],
  ['--max-depth', '-1'],
  ['--viewport', 'desktop:999999999999999999999999999999999999999999999999999999999999x900'],
  ['--viewport', 'desktop:1440x900', '--viewport', 'desktop:390x844'],
] as const;

for (const request of invalidRequests) {
  test(`rejects invalid crawl arguments before starting a crawl: ${request.join(' ')}`, async () => {
    const output = createContext();
    const result = await crawl(
      ['https://example.test/', ...request, '--output', 'crawl.json'],
      output,
    );

    expect(result.exitCode).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr).toHaveLength(1);
  });
}

/*** Creates the command boundary context used to verify that rejected input has no crawl output. */
function createContext() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    cwd: '/tmp',
    env: {},
    stderr,
    stdout,
    version: 'test',
    writeStderr: (value: string) => stderr.push(value),
    writeStdout: (value: string) => stdout.push(value),
  };
}
