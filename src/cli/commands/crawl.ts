import { constants } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { AnkhCommandContext } from '@ankhorage/ankh';

import { createWebsiteCrawler } from '../../index.js';
import type { CrawlResult } from '../../types/public.js';

/*** Adapt `ankh scraper crawl` arguments to the package's public crawler API. */
export async function crawl(
  argv: readonly string[],
  context: AnkhCommandContext,
): Promise<{ readonly exitCode: number }> {
  try {
    const input = parseCrawlInput(argv, context.cwd);
    if ('help' in input) {
      context.writeStdout(renderHelp());
      return { exitCode: 0 };
    }
    await assertOutputDoesNotExistAsync(input.outputPath);
    if (input.breakpointOutputPath) await assertOutputDoesNotExistAsync(input.breakpointOutputPath);
    const result = await createWebsiteCrawler().crawlWebsiteAsync(crawlOptions(input));
    await writeFile(input.outputPath, `${JSON.stringify(result.document, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    if (input.breakpointOutputPath)
      await writeFile(
        input.breakpointOutputPath,
        `${JSON.stringify(
          {
            breakpointCoverage: result.breakpointCoverage,
            breakpointEvidence: result.breakpointEvidence,
          },
          null,
          2,
        )}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );
    context.writeStdout(`Wrote website observation document to ${input.outputPath}.\n`);
    if (hasBreakpointDiagnostics(result))
      context.writeStderr(renderBreakpointSummary(result, input.breakpointOutputPath));
    const nonBreakpointDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code !== 'breakpoint',
    );
    if (nonBreakpointDiagnostics.length > 0)
      context.writeStderr(`${JSON.stringify(nonBreakpointDiagnostics, null, 2)}\n`);
    return { exitCode: 0 };
  } catch (error) {
    context.writeStderr(`${errorMessage(error)}\n`);
    return { exitCode: 1 };
  }
}

interface CrawlInput {
  readonly breakpointOutputPath: string | undefined;
  readonly maxDepth: number | undefined;
  readonly maxPages: number | undefined;
  readonly outputPath: string;
  readonly url: string;
  readonly viewports: readonly {
    readonly height: number;
    readonly id: string;
    readonly width: number;
  }[];
}

/*** Preserve absent optional crawler options instead of passing explicit undefined values. */
function crawlOptions(input: CrawlInput) {
  return {
    url: input.url,
    ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
    ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages }),
    ...(input.viewports.length === 0 ? {} : { viewports: input.viewports }),
  };
}

/*** Render bounded responsive coverage facts without flooding the terminal with per-width warnings. */
function renderBreakpointSummary(
  result: CrawlResult,
  breakpointOutputPath: string | undefined,
): string {
  const coverage = result.breakpointCoverage;
  const probes = coverage.reduce((count, item) => count + item.probes.length, 0);
  const omissions = coverage.flatMap((item) => item.omissions);
  const verified = coverage.reduce(
    (count, item) =>
      count +
      item.measurements.length +
      item.omissions.filter((item) => item.reason.startsWith('Verified responsive state')).length,
    0,
  );
  const capturedWidths = [
    ...new Set(
      result.document.pages.flatMap((page) => page.viewports.map((viewport) => viewport.width)),
    ),
  ].sort((left, right) => left - right);
  const captured = result.document.pages.reduce((count, page) => count + page.viewports.length, 0);
  const details =
    breakpointOutputPath === undefined
      ? 'Use --breakpoint-output <file> for complete breakpoint evidence.'
      : `Full breakpoint evidence: ${breakpointOutputPath}.`;
  const lines = [
    `Breakpoint coverage: probed ${probes}; verified responsive states ${verified}; fully captured ${captured}; omitted ${omissions.length}.`,
    capturedWidths.length === 0
      ? undefined
      : `Fully captured widths: ${capturedWidths.join(', ')}px.`,
    ...summarizeOmissions(omissions),
    details,
  ].filter((line): line is string => line !== undefined);
  return `${lines.join('\n')}\n`;
}

/*** Group omitted viewport candidates by cause while retaining a few representative widths. */
function summarizeOmissions(
  omissions: readonly CrawlResult['breakpointCoverage'][number]['omissions'][number][],
): readonly string[] {
  const grouped = new Map<string, number[]>();
  for (const omission of omissions) {
    const widths = grouped.get(omission.reason) ?? [];
    grouped.set(omission.reason, [...widths, omission.width]);
  }
  return [...grouped.entries()].map(([reason, widths]) => {
    const representativeWidths = widths.slice(0, 3).join(', ');
    const remaining = widths.length > 3 ? ', …' : '';
    return `Omitted regime (${widths.length}): ${reason} Representative widths: ${representativeWidths}${remaining}px.`;
  });
}

/*** Identify breakpoint diagnostics that require the compact responsive-coverage terminal summary. */
function hasBreakpointDiagnostics(result: CrawlResult): boolean {
  return (
    result.breakpointCoverage.length > 0 ||
    result.diagnostics.some((diagnostic) => diagnostic.code === 'breakpoint')
  );
}

/*** Parse a bounded crawl request and reject unknown, duplicate, or incomplete options. */
function parseCrawlInput(
  argv: readonly string[],
  cwd: string,
): CrawlInput | { readonly help: true } {
  if (argv.length === 1 && isHelpToken(argv[0])) return { help: true };
  const [url, ...tokens] = argv;
  if (url === undefined || url.startsWith('-')) throw new Error(renderUsage());
  const values = collectCrawlOptions(tokens);
  const output = singleOption(values, '--output');
  const breakpointOutput = optionalSingleOption(values, '--breakpoint-output');
  const maxPages = positiveIntegerOption(values, '--max-pages');
  const maxDepth = nonnegativeIntegerOption(values, '--max-depth');
  const viewports = (values.get('--viewport') ?? []).map(parseViewport);
  assertUniqueViewportIds(viewports);
  return {
    breakpointOutputPath:
      breakpointOutput === undefined ? undefined : resolve(cwd, breakpointOutput),
    url,
    maxDepth,
    maxPages,
    outputPath: resolve(cwd, output),
    viewports,
  };
}

/*** Collect repeated flags from complete argument pairs without indexing user-controlled arrays. */
function collectCrawlOptions(tokens: readonly string[]): ReadonlyMap<CrawlFlag, readonly string[]> {
  if (tokens.length === 0) return new Map();
  const [flag, value, ...rest] = tokens;
  if (flag === undefined || value === undefined || !isCrawlFlag(flag))
    throw new Error(renderUsage());
  const values = collectCrawlOptions(rest);
  return new Map([...values, [flag, [...(values.get(flag) ?? []), value]]]);
}

/*** Accept only the named flags supported by the crawl delivery adapter. */
type CrawlFlag = '--breakpoint-output' | '--max-depth' | '--max-pages' | '--output' | '--viewport';

function isCrawlFlag(value: string): value is CrawlFlag {
  return (
    value === '--output' ||
    value === '--breakpoint-output' ||
    value === '--max-pages' ||
    value === '--max-depth' ||
    value === '--viewport'
  );
}

/*** Read one non-repeating flag value and make required options explicit. */
function singleOption(values: ReadonlyMap<CrawlFlag, readonly string[]>, flag: CrawlFlag): string {
  const options = values.get(flag) ?? [];
  if (options.length !== 1) throw new Error(renderUsage());
  const [value] = options;
  if (value === undefined) throw new Error(renderUsage());
  return value;
}

/*** Read one optional non-repeating output path without creating a default sidecar. */
function optionalSingleOption(
  values: ReadonlyMap<CrawlFlag, readonly string[]>,
  flag: CrawlFlag,
): string | undefined {
  const options = values.get(flag) ?? [];
  if (options.length > 1) throw new Error(renderUsage());
  return options[0];
}

/*** Convert an optional positive integer flag without coercing malformed values. */
function positiveIntegerOption(
  values: ReadonlyMap<CrawlFlag, readonly string[]>,
  flag: CrawlFlag,
): number | undefined {
  const options = values.get(flag) ?? [];
  if (options.length > 1) throw new Error(renderUsage());
  const [value] = options;
  if (value === undefined) return undefined;
  return parseSafeInteger(value, flag, /^[1-9][0-9]*$/, 'a positive integer');
}

/*** Convert an optional nonnegative integer flag while preserving an explicit zero depth. */
function nonnegativeIntegerOption(
  values: ReadonlyMap<CrawlFlag, readonly string[]>,
  flag: CrawlFlag,
): number | undefined {
  const options = values.get(flag) ?? [];
  if (options.length > 1) throw new Error(renderUsage());
  const [value] = options;
  if (value === undefined) return undefined;
  return parseSafeInteger(value, flag, /^(?:0|[1-9][0-9]*)$/, 'a nonnegative integer');
}

/*** Parse decimal CLI input only when it remains a finite safe integer at the runtime boundary. */
function parseSafeInteger(
  value: string,
  flag: string,
  pattern: RegExp,
  description: string,
): number {
  if (!pattern.test(value)) throw new Error(`${flag} must be ${description}.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed))
    throw new Error(`${flag} must be a safe integer.`);
  return parsed;
}

/*** Parse one explicit viewport identifier and dimensions without inventing a viewport. */
function parseViewport(value: string): {
  readonly height: number;
  readonly id: string;
  readonly width: number;
} {
  const match = /^(?<id>[a-z][a-z0-9-]*):(?<width>[1-9][0-9]*)x(?<height>[1-9][0-9]*)$/i.exec(
    value,
  );
  if (match?.groups === undefined) throw new Error('--viewport must use id:WIDTHxHEIGHT.');
  const { id, width, height } = match.groups;
  if (id === undefined || width === undefined || height === undefined)
    throw new Error('--viewport must use id:WIDTHxHEIGHT.');
  return {
    id,
    width: parseSafeInteger(width, '--viewport width', /^[1-9][0-9]*$/, 'a positive integer'),
    height: parseSafeInteger(height, '--viewport height', /^[1-9][0-9]*$/, 'a positive integer'),
  };
}

/*** Reject duplicate viewport identities before crawler composition can start the browser. */
function assertUniqueViewportIds(viewports: readonly { readonly id: string }[]): void {
  if (new Set(viewports.map((viewport) => viewport.id)).size !== viewports.length)
    throw new Error('--viewport IDs must be unique.');
}

/*** Refuse an existing target before starting the potentially expensive crawl. */
async function assertOutputDoesNotExistAsync(path: string): Promise<void> {
  try {
    await access(path, constants.F_OK);
  } catch {
    return;
  }
  throw new Error(`Refusing to overwrite existing file: ${path}`);
}

/*** Identify the command help tokens supported by the Ankh delivery surface. */
function isHelpToken(value: string | undefined): boolean {
  return value === '--help' || value === '-h' || value === 'help';
}

/*** Render short command-specific help for direct dispatcher invocation. */
function renderHelp(): string {
  return `${renderUsage()}\n`;
}

/*** Render the canonical crawl invocation shape. */
function renderUsage(): string {
  return 'Usage: ankh scraper crawl <url> --output <file> [--breakpoint-output <file>] [--max-pages <count>] [--max-depth <count>] [--viewport <id:WIDTHxHEIGHT>]...';
}

/*** Convert an unknown boundary failure to a safe command diagnostic. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Scraper crawl failed.';
}
