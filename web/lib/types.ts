// Core shared types for the WebOps AI audit engine.
// Everything the crawler, rules engine, opportunity engine and UI exchange
// is described here so the whole pipeline stays type-safe end to end.

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FindingCategory =
  | "indexability"
  | "seo"
  | "content"
  | "links"
  | "images"
  | "structured-data"
  | "accessibility"
  | "performance"
  | "security";

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  indexability: "Indexability",
  seo: "SEO",
  content: "Content",
  links: "Links",
  images: "Images",
  "structured-data": "Structured Data",
  accessibility: "Accessibility",
  performance: "Performance",
  security: "Security",
};

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 100,
  high: 60,
  medium: 25,
  low: 8,
  info: 1,
};

/** A single hyperlink discovered on a page. */
export interface PageLink {
  href: string; // normalized absolute URL
  raw: string; // as written in the document
  anchor: string; // visible anchor text (trimmed)
  rel: string | null;
  internal: boolean;
  nofollow: boolean;
}

/** A single image reference discovered on a page. */
export interface PageImage {
  src: string; // normalized absolute URL
  alt: string | null;
  width: string | null;
  height: string | null;
  loading: string | null;
}

/** Parsed JSON-LD / structured-data block. */
export interface StructuredDataBlock {
  types: string[]; // @type values, flattened
  valid: boolean; // JSON parsed cleanly
  raw?: string; // original text (truncated) when invalid
}

/** All raw evidence captured for one crawled URL. */
export interface PageEvidence {
  url: string;
  finalUrl: string;
  requestedUrl: string;
  depth: number;
  status: number;
  ok: boolean;
  redirected: boolean;
  redirectChain: { url: string; status: number }[];
  contentType: string;
  contentLengthBytes: number;
  responseTimeMs: number;
  headers: Record<string, string>;
  // SEO signals
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  canonical: string | null;
  robotsMeta: string | null;
  xRobotsTag: string | null;
  metaViewport: string | null;
  lang: string | null;
  charset: string | null;
  h1: string[];
  h2Count: number;
  headingOutlineIssues: string[];
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  hreflang: { lang: string; href: string }[];
  structuredData: StructuredDataBlock[];
  // content
  wordCount: number;
  textToHtmlRatio: number;
  contentHash: string;
  // links & assets
  links: PageLink[];
  internalLinkCount: number;
  externalLinkCount: number;
  images: PageImage[];
  // derived indexability
  indexable: boolean;
  indexabilityReason: string | null;
  // per-page findings (populated by the rules engine)
  findings: Finding[];
  error?: string;
}

/** One deterministic issue detected against evidence. */
export interface Finding {
  ruleId: string;
  ruleVersion: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  detail: string; // human-readable explanation of THIS instance
  why: string; // why the rule matters, in general
  recommendation: string;
  url: string; // affected page
  evidence?: string; // the offending value / snippet
}

/** A group of related findings rolled up into a prioritized action. */
export interface Opportunity {
  id: string;
  ruleId: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  why: string;
  recommendation: string;
  affectedUrls: string[];
  affectedCount: number;
  sampleEvidence: string[];
  score: number; // 0-100 priority
  effort: "low" | "medium" | "high";
  confidence: "high" | "medium" | "low";
}

export interface CrawlStats {
  requestedUrl: string;
  origin: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  pagesCrawled: number;
  pagesRequested: number;
  maxPages: number;
  maxDepth: number;
  fromSitemap: number;
  robotsFound: boolean;
  sitemapFound: boolean;
  statusCounts: Record<string, number>;
  brokenLinks: BrokenLink[];
  truncated: boolean;
}

export interface BrokenLink {
  from: string;
  to: string;
  status: number;
  anchor: string;
}

export interface HealthScore {
  overall: number; // 0-100
  grade: string; // A+ .. F
  categories: Partial<Record<FindingCategory, number>>;
}

export interface AuditResult {
  auditId: string;
  version: string;
  capturedAt: string;
  crawl: CrawlStats;
  health: HealthScore;
  pages: PageEvidence[];
  findings: Finding[];
  opportunities: Opportunity[];
  findingCountsByCategory: Record<string, number>;
  findingCountsBySeverity: Record<string, number>;
}
