// Health scoring. Deterministic and explainable: each category score is
// 100 minus a normalized penalty from its findings, and the overall score is
// an importance-weighted mean of the categories that were evaluated.

import type { Finding, FindingCategory, HealthScore } from "./types";
import { SEVERITY_WEIGHT } from "./types";

const CATEGORY_IMPORTANCE: Record<FindingCategory, number> = {
  indexability: 0.24,
  seo: 0.22,
  performance: 0.16,
  content: 0.1,
  links: 0.1,
  accessibility: 0.08,
  security: 0.06,
  "structured-data": 0.02,
  images: 0.02,
};

export function computeHealth(
  findings: Finding[],
  pagesCrawled: number,
  performanceScore?: number | null,
): HealthScore {
  const pages = Math.max(pagesCrawled, 1);
  const byCat = new Map<FindingCategory, number>();
  for (const f of findings) {
    byCat.set(f.category, (byCat.get(f.category) || 0) + SEVERITY_WEIGHT[f.severity]);
  }

  const categories: Partial<Record<FindingCategory, number>> = {};
  for (const cat of Object.keys(CATEGORY_IMPORTANCE) as FindingCategory[]) {
    if (cat === "performance" && typeof performanceScore === "number") {
      categories[cat] = Math.round(performanceScore);
      continue;
    }
    const weighted = byCat.get(cat) || 0;
    const penalty = (weighted / pages) * 0.85;
    categories[cat] = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  }

  let num = 0;
  let den = 0;
  for (const cat of Object.keys(CATEGORY_IMPORTANCE) as FindingCategory[]) {
    const score = categories[cat];
    if (score === undefined) continue;
    if (cat === "performance" && typeof performanceScore !== "number") continue;
    const w = CATEGORY_IMPORTANCE[cat];
    num += score * w;
    den += w;
  }
  const overall = den ? Math.round(num / den) : 100;

  return { overall, grade: grade(overall), categories };
}

export function grade(score: number): string {
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}
