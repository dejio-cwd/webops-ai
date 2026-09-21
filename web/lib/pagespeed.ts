// Real Lighthouse + Core Web Vitals without running Chrome ourselves: Google's
// PageSpeed Insights API runs Lighthouse in Google's cloud and returns both lab
// metrics and (when available) real-user CrUX field data. Works with a keyless
// quota; set PAGESPEED_API_KEY (or GOOGLE_API_KEY) to raise limits.

export interface MetricValue {
  value: number | null;
  displayValue: string | null;
  score: number | null; // 0-1
}

export interface PageSpeedResult {
  strategy: "mobile" | "desktop";
  url: string;
  fetchedAt: string;
  scores: {
    performance: number | null;
    accessibility: number | null;
    bestPractices: number | null;
    seo: number | null;
  };
  lab: {
    lcp: MetricValue;
    cls: MetricValue;
    tbt: MetricValue;
    fcp: MetricValue;
    speedIndex: MetricValue;
    tti: MetricValue;
  };
  field: {
    hasData: boolean;
    lcp: string | null;
    cls: string | null;
    inp: string | null;
    fcp: string | null;
    ttfb: string | null;
    overall: string | null;
  };
  opportunities: { title: string; displayValue: string | null; savingsMs: number }[];
  error?: string;
}

function metric(audit: Record<string, unknown> | undefined): MetricValue {
  if (!audit) return { value: null, displayValue: null, score: null };
  return {
    value: typeof audit.numericValue === "number" ? Math.round(audit.numericValue) : null,
    displayValue: (audit.displayValue as string) ?? null,
    score: typeof audit.score === "number" ? audit.score : null,
  };
}

function pct(cat: Record<string, unknown> | undefined): number | null {
  const s = cat?.score;
  return typeof s === "number" ? Math.round(s * 100) : null;
}

function fieldCat(metrics: Record<string, unknown> | undefined, key: string): string | null {
  const m = metrics?.[key] as { category?: string } | undefined;
  return m?.category ?? null;
}

export async function runPageSpeed(
  url: string,
  strategy: "mobile" | "desktop" = "mobile",
): Promise<PageSpeedResult> {
  const base: PageSpeedResult = {
    strategy,
    url,
    fetchedAt: new Date().toISOString(),
    scores: { performance: null, accessibility: null, bestPractices: null, seo: null },
    lab: {
      lcp: metric(undefined),
      cls: metric(undefined),
      tbt: metric(undefined),
      fcp: metric(undefined),
      speedIndex: metric(undefined),
      tti: metric(undefined),
    },
    field: { hasData: false, lcp: null, cls: null, inp: null, fcp: null, ttfb: null, overall: null },
    opportunities: [],
  };

  const key = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_API_KEY || "";
  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("strategy", strategy);
  for (const c of ["performance", "accessibility", "best-practices", "seo"]) {
    endpoint.searchParams.append("category", c);
  }
  if (key) endpoint.searchParams.set("key", key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ...base, error: `PageSpeed API returned ${res.status}. ${body.slice(0, 160)}` };
    }
    const data = (await res.json()) as Record<string, any>;
    const lh = data.lighthouseResult || {};
    const cats = lh.categories || {};
    const audits = lh.audits || {};
    const loading = data.loadingExperience?.metrics;

    return {
      ...base,
      scores: {
        performance: pct(cats.performance),
        accessibility: pct(cats.accessibility),
        bestPractices: pct(cats["best-practices"]),
        seo: pct(cats.seo),
      },
      lab: {
        lcp: metric(audits["largest-contentful-paint"]),
        cls: metric(audits["cumulative-layout-shift"]),
        tbt: metric(audits["total-blocking-time"]),
        fcp: metric(audits["first-contentful-paint"]),
        speedIndex: metric(audits["speed-index"]),
        tti: metric(audits["interactive"]),
      },
      field: {
        hasData: Boolean(loading),
        lcp: fieldCat(loading, "LARGEST_CONTENTFUL_PAINT_MS"),
        cls: fieldCat(loading, "CUMULATIVE_LAYOUT_SHIFT_SCORE"),
        inp: fieldCat(loading, "INTERACTION_TO_NEXT_PAINT"),
        fcp: fieldCat(loading, "FIRST_CONTENTFUL_PAINT_MS"),
        ttfb: fieldCat(loading, "EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
        overall: data.loadingExperience?.overall_category ?? null,
      },
      opportunities: Object.values(audits)
        .filter((a: any) => a?.details?.type === "opportunity" && a.numericValue > 100)
        .map((a: any) => ({
          title: a.title as string,
          displayValue: (a.displayValue as string) ?? null,
          savingsMs: Math.round(a.numericValue),
        }))
        .sort((a, b) => b.savingsMs - a.savingsMs)
        .slice(0, 8),
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : "PageSpeed request failed." };
  } finally {
    clearTimeout(timer);
  }
}
