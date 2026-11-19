import { constants } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { AnkhCommandContext } from '@ankhorage/ankh';
import type { UiNode } from '@ankhorage/contracts';

import { createWebsiteCrawler } from '../../index.js';

/*** Adapt `ankh scraper analyze` to observation capture, recognition, and an inspectable terminal tree. */
export const analyze = async (
  argv: readonly string[],
  context: AnkhCommandContext,
): Promise<{ readonly exitCode: number }> => {
  try {
    const input = parseInput(argv, context.cwd);
    await Promise.all([assertAbsentAsync(input.analysis), assertAbsentAsync(input.observation)]);
    const result = await createWebsiteCrawler().crawlWebsiteAsync({
      url: input.url,
      ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
      ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages }),
      ...(input.viewports ? { viewports: input.viewports } : {}),
    });
    await Promise.all([
      writeFile(input.analysis, `${JSON.stringify(result.recognition, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      }),
      writeFile(input.observation, `${JSON.stringify(result.document, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      }),
    ]);
    context.writeStdout(
      `${result.recognition.pages.map((page) => `Page ${page.path}\n${renderTree(page.root)}`).join('\n')}\n`,
    );
    return { exitCode: 0 };
  } catch (error) {
    context.writeStderr(`${error instanceof Error ? error.message : 'Scraper analysis failed.'}\n`);
    return { exitCode: 1 };
  }
};

/*** Parse bounded multi-page analysis options and reject paths that would overwrite evidence. */
const parseInput = (argv: readonly string[], cwd: string) => {
  const [url, ...flags] = argv;
  if (!url || url.startsWith('-') || flags.length % 2 !== 0) throw new Error(usage());
  const values = new Map<string, string[]>();
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags.at(index);
    const value = flags.at(index + 1);
    if (
      !flag ||
      !value ||
      !['--max-depth', '--max-pages', '--output', '--observation-output', '--viewport'].includes(
        flag,
      )
    )
      throw new Error(usage());
    values.set(flag, [...(values.get(flag) ?? []), value]);
  }
  const one = (flag: string) => {
    const valuesForFlag = values.get(flag) ?? [];
    if (valuesForFlag.length !== 1 || !valuesForFlag[0]) throw new Error(usage());
    return valuesForFlag[0];
  };
  const viewports = (values.get('--viewport') ?? []).map((value) => {
    const match = /^(?<id>[a-z][a-z0-9-]*):(?<width>[1-9][0-9]*)x(?<height>[1-9][0-9]*)$/iu.exec(
      value,
    );
    if (!match?.groups?.id || !match.groups.width || !match.groups.height) throw new Error(usage());
    return {
      height: Number(match.groups.height),
      id: match.groups.id,
      width: Number(match.groups.width),
    };
  });
  return {
    analysis: resolve(cwd, one('--output')),
    maxDepth: nonnegativeInteger('--max-depth', values),
    maxPages: positiveInteger('--max-pages', values),
    observation: resolve(cwd, one('--observation-output')),
    url,
    viewports: viewports.length ? viewports : undefined,
  };
};

/*** Parse a bounded non-negative crawl depth without accepting partial numeric input. */
const nonnegativeInteger = (flag: string, values: ReadonlyMap<string, readonly string[]>) => {
  const value = values.get(flag)?.[0];
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new Error(usage());
  return Number(value);
};

/*** Parse a positive page bound without allowing a zero-page analysis. */
const positiveInteger = (flag: string, values: ReadonlyMap<string, readonly string[]>) => {
  const value = nonnegativeInteger(flag, values);
  if (value === 0) throw new Error(usage());
  return value;
};

/*** Render canonical type names and semantic details as an ordered Unicode tree. */
const renderTree = (node: UiNode, prefix = '', last = true): string => {
  const label =
    node.type === 'Layout'
      ? `Layout (${node.props?.layout === 'grid' ? 'Grid' : `Flex, ${String(node.style?.flexDirection ?? 'row')}`})`
      : `${node.type}${textLabel(node)}`;
  const children = node.children ?? [];
  return `${prefix}${last ? '└── ' : '├── '}${label}${children.map((child: UiNode, index: number) => `\n${renderTree(child, `${prefix}${last ? '    ' : '│   '}`, index === children.length - 1)}`).join('')}`;
};

/*** Render source text content only on textual modules without emitting script or style content. */
const textLabel = (node: UiNode): string => {
  if (!['Button', 'Heading', 'Link', 'RichText'].includes(node.type)) return '';
  const textRuns = node.props?.textRuns;
  if (!Array.isArray(textRuns)) return '';
  const text = textRuns.flatMap(textRunText).join('').replace(/\s+/gu, ' ').trim();
  return text.length > 0 ? `: ${text}` : '';
};

/*** Read one text run only when its serializable text field is actually present. */
const textRunText = (value: unknown): readonly string[] => {
  if (typeof value !== 'object' || value === null || !('text' in value)) return [];
  return typeof value.text === 'string' ? [value.text] : [];
};

/*** Refuse evidence-target paths that already exist before browser work begins. */
const assertAbsentAsync = async (path: string): Promise<void> => {
  try {
    await access(path, constants.F_OK);
  } catch {
    return;
  }
  throw new Error(`Refusing to overwrite existing file: ${path}`);
};

/*** Describe the canonical direct analysis command. */
const usage = (): string =>
  'Usage: ankh scraper analyze <url> --output <analysis.json> --observation-output <observations.json> [--max-depth <n>] [--max-pages <n>] [--viewport <id:WIDTHxHEIGHT>]...';
