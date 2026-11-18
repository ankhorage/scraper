# Public API

## BreakpointEvidence

Kind: `type`
Module: `src/types/public.ts`
Source: `src/types/public.ts:53:1`

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
| timing | property | `CrawlTimingOptions` | no |  |
| url | property | `string` | yes |  |
| viewports | property | `readonly CrawlViewport[]` | no |  |

## CrawlResult

Kind: `type`
Module: `src/types/public.ts`
Source: `src/types/public.ts:163:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| breakpointCoverage | property | `readonly BreakpointCoverage[]` | yes |  |
| breakpointEvidence | property | `readonly BreakpointEvidence[]` | yes |  |
| diagnostics | property | `readonly CrawlDiagnostic[]` | yes |  |
| document | property | `WebsiteObservationDocument` | yes |  |

## CrawlTimingOptions

Kind: `type`
Module: `src/types/public.ts`
Source: `src/types/public.ts:40:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| onPhase | property | `(phase: CrawlTimingPhase) => void` | yes |  |

## CrawlTimingPhase

Kind: `type`
Module: `src/types/public.ts`
Source: `src/types/public.ts:21:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| durationMs | property | `number` | yes |  |
| outcome | property | `"completed" \| "failed"` | yes |  |
| phase | property | `"viewport" \| "browser-cleanup" \| "browser-start" \| "complete" \| "dom-extraction" \| "dynamic-activation" \| "dynamic-settling" \| "error" \| "navigation" \| "robots"` | yes |  |
| reason | property | `"error" \| "aborted" \| "timeout"` | no |  |
| viewportId | property | `string` | no |  |

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
Source: `src/features/website-crawl/composition/createWebsiteCrawler.ts:13:14`

Create the public, safe website-recognition crawler.

### Signatures

- `(crawlerOptions?: WebsiteCrawlerOptions) => { readonly crawlWebsiteAsync: (options: CrawlOptions) => Promise<CrawlResult>; }`
  - crawlerOptions: `WebsiteCrawlerOptions` (optional)
  - returns: `{ readonly crawlWebsiteAsync: (options: CrawlOptions) => Promise<CrawlResult>; }`

## DynamicCaptureOptions

Kind: `type`
Module: `src/types/public.ts`
Source: `src/types/public.ts:45:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| maxCandidates | property | `number` | no |  |
| overallTimeoutMs | property | `number` | no |  |
| perTargetTimeoutMs | property | `number` | no |  |
| stabilityWindowMs | property | `number` | no |  |
