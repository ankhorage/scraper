# Public API

## BreakpointEvidence

Kind: `type`
Module: `src/types/public.ts`
Source: `src/types/public.ts:27:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| condition | property | `string` | yes |  |
| kind | property | `"container" \| "diagnostic" \| "viewport"` | yes |  |
| source | property | `string` | yes |  |
| sourceUrl | property | `string` | yes |  |

## CrawlOptions

Kind: `type`
Module: `src/types/public.ts`
Source: `src/types/public.ts:7:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| dynamicCapture | property | `DynamicCaptureOptions` | no |  |
| maxBytesPerPage | property | `number` | no |  |
| maxDepth | property | `number` | no |  |
| maxPages | property | `number` | no |  |
| navigationTimeoutMs | property | `number` | no |  |
| url | property | `string` | yes |  |
| viewports | property | `readonly CrawlViewport[]` | no |  |

## CrawlResult

Kind: `type`
Module: `src/types/public.ts`
Source: `src/types/public.ts:137:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| breakpointCoverage | property | `readonly BreakpointCoverage[]` | yes |  |
| breakpointEvidence | property | `readonly BreakpointEvidence[]` | yes |  |
| diagnostics | property | `readonly CrawlDiagnostic[]` | yes |  |
| document | property | `WebsiteObservationDocument` | yes |  |

## CrawlViewport

Kind: `type`
Module: `src/types/public.ts`
Source: `src/types/public.ts:1:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| height | property | `number` | yes |  |
| id | property | `string` | yes |  |
| width | property | `number` | yes |  |

## createWebsiteCrawler

Kind: `value`
Module: `src/features/website-crawl/composition/createWebsiteCrawler.ts`
Source: `src/features/website-crawl/composition/createWebsiteCrawler.ts:12:14`

Create the public, safe website-recognition crawler.

### Signatures

- `(crawlerOptions?: WebsiteCrawlerOptions) => { readonly crawlWebsiteAsync: (options: CrawlOptions) => Promise<CrawlResult>; }`
  - crawlerOptions: `WebsiteCrawlerOptions` (optional)
  - returns: `{ readonly crawlWebsiteAsync: (options: CrawlOptions) => Promise<CrawlResult>; }`

## DynamicCaptureOptions

Kind: `type`
Module: `src/types/public.ts`
Source: `src/types/public.ts:19:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| maxCandidates | property | `number` | no |  |
| overallTimeoutMs | property | `number` | no |  |
| perTargetTimeoutMs | property | `number` | no |  |
| stabilityWindowMs | property | `number` | no |  |
