import sharp from "sharp";
import { createHash } from "node:crypto";
import { fetchEvidence } from "./http";
import type { AuditConfig } from "./config";
import type { PageImage, Finding } from "../types";

export interface ImageAnalysis {
  url: string; finalUrl: string; filename: string; format: string | null; mime: string; bytes: number;
  width: number | null; height: number | null; aspectRatio: number | null; hash: string | null;
  status: number; optimizedBytes: number | null; estimatedSavingsBytes: number | null; savingsPercent: number | null;
  recommendedFormat: string | null; confidence: string; error?: string; limitation?: string;
  cacheControl: string | null; animated?: boolean;
}
export async function analyzeImage(url: string, config: AuditConfig): Promise<ImageAnalysis> {
  const res = await fetchEvidence(url, config, { maxBytes: config.maxImageBytes });
  const base: ImageAnalysis = { url, finalUrl: res.url, filename: new URL(res.url).pathname.split("/").pop() || "image", format: null, mime: res.headers["content-type"] || "", bytes: res.bytes.length, width: null, height: null, aspectRatio: null, hash: null, status: res.status, optimizedBytes: null, estimatedSavingsBytes: null, savingsPercent: null, recommendedFormat: null, confidence: "insufficient data", cacheControl: res.headers["cache-control"] || null };
  if (res.status >= 500 || res.status === 429) throw new Error(`Image HTTP ${res.status}`);
  if (res.status >= 400 || res.truncated) return { ...base, error: res.truncated ? "Image exceeds the configured byte limit; byte count is a lower bound." : `Image HTTP ${res.status}` };
  try {
    const metadata = await sharp(res.bytes, { limitInputPixels: 40000000 }).metadata();
    Object.assign(base, { format: metadata.format || null, width: metadata.width || null, height: metadata.height || null, aspectRatio: metadata.width && metadata.height ? metadata.width / metadata.height : null, hash: createHash("sha256").update(res.bytes).digest("hex"), animated: (metadata.pages || 1) > 1, confidence: "high" });
    if (["jpeg", "png", "webp"].includes(metadata.format || "") && !base.animated && (metadata.width || 0) * (metadata.height || 0) <= 12000000) {
      const webp = await sharp(res.bytes).webp({ quality: 80, effort: 2 }).toBuffer();
      base.optimizedBytes = webp.length; base.estimatedSavingsBytes = Math.max(0, res.bytes.length - webp.length);
      base.savingsPercent = res.bytes.length ? Math.round(base.estimatedSavingsBytes / res.bytes.length * 100) : 0;
      base.recommendedFormat = base.estimatedSavingsBytes > 0 ? "webp" : metadata.format || null;
      base.limitation = "Savings use an actual WebP quality-80 sample encode at original dimensions. Visual quality and transparency must be reviewed before replacing the original. AVIF may be tested separately; no AVIF byte savings are invented.";
    } else base.limitation = "Compression savings not measured for this format, animation, or pixel budget.";
  } catch { base.error = "The image could not be decoded within the image-processing limits."; }
  return base;
}

export function imageFindings(page: string, image: PageImage, analysis: ImageAnalysis, config: AuditConfig): Finding[] {
  const out: Finding[] = [];
  const add = (id: string, severity: Finding["severity"], title: string, evidence: string, recommendation: string, confidence: Finding["confidence"] = "high") => out.push({ ruleId: id, ruleVersion: "2", category: "images", severity, title, detail: title, why: "Image delivery and meaningful alternatives affect usability, accessibility, and performance.", recommendation, url: page, element: image.selector, evidence, confidence, estimatedSavingsBytes: id === "IMG-COMPRESSION" ? analysis.estimatedSavingsBytes || 0 : undefined });
  const contentImage = ["img", "lazy", "rendered", "srcset", "picture"].includes(image.source || "img");
  if (contentImage && image.alt === null) add("IMG-ALT-MISSING", "high", "Image has no alt attribute", analysis.url, "Describe the image's purpose in this context, or use an empty alt for a decorative image.");
  if (contentImage && image.alt === "") add("IMG-ALT-REVIEW", "info", "Confirm this empty alt is intentional", analysis.url, "Keep empty alt for decorative images. Add a meaningful alternative if this image conveys information.", "low");
  if (image.alt && /^(image|photo|picture|img[_-]?\d*|\S+\.(png|jpg|jpeg|webp))$/i.test(image.alt.trim())) add("IMG-ALT-GENERIC", "medium", "Alt text appears generic", image.alt, "Describe the content or function rather than repeating a filename.", "medium");
  if (contentImage && (!image.width || !image.height)) add("IMG-DIMENSIONS", "medium", "Image lacks explicit HTML dimensions", analysis.url, "Set width and height, or reserve its aspect ratio in CSS. Check rendered layout before diagnosing CLS.", "medium");
  if (analysis.bytes > config.largeImageBytes) add("IMG-LARGE", "medium", "Image exceeds the selected byte threshold", `${analysis.bytes} bytes; threshold ${config.largeImageBytes}`, "Resize and compress this image, and verify the smallest acceptable format.");
  if (analysis.estimatedSavingsBytes && analysis.estimatedSavingsBytes > 10000) add("IMG-COMPRESSION", "medium", "Measured encoding sample suggests byte savings", `${analysis.bytes} → ${analysis.optimizedBytes} bytes at WebP quality 80`, "Review the sample's quality and test WebP/AVIF delivery before replacing the asset.", "medium");
  const rw = image.renderedWidth, rh = image.renderedHeight, dpr = config.viewport.deviceScaleFactor;
  if (rw && rh && analysis.width && analysis.height) {
    if (analysis.width > rw * dpr * config.oversizedRatio && analysis.height > rh * dpr * config.oversizedRatio) add("IMG-OVERSIZED", "medium", "Source is larger than the rendered display needs", `${analysis.width}×${analysis.height} source, ${Math.round(rw)}×${Math.round(rh)} CSS pixels, DPR ${dpr}`, `Provide a responsive candidate near ${Math.ceil(rw*dpr)}×${Math.ceil(rh*dpr)} pixels for this viewport.`);
    if (analysis.width < rw * dpr * 0.9 || analysis.height < rh * dpr * 0.9) add("IMG-UNDERSIZED", "low", "Image may be upscaled", `${analysis.width}×${analysis.height} source versus ${Math.round(rw*dpr)}×${Math.round(rh*dpr)} display pixels`, "Provide a larger responsive candidate where visual inspection confirms blur.", "medium");
  }
  if (contentImage && analysis.width && analysis.width > 1000 && !image.srcset) add("IMG-RESPONSIVE", "low", "Large image has no responsive candidates", `${analysis.width}px wide; no srcset observed`, "Evaluate srcset and sizes for smaller screens.", "medium");
  if (image.srcset && /\d+w\b/.test(image.srcset) && !image.sizes) add("IMG-SIZES", "medium", "Width-based srcset lacks sizes", image.srcset, "Set sizes to describe the image's layout width.");
  if (image.isLcp && image.loading === "lazy") add("IMG-LCP-LAZY", "high", "Observed LCP image is lazy-loaded", analysis.url, "Load the LCP image eagerly and consider fetchpriority=high.");
  if (analysis.status >= 400) add("IMG-BROKEN", "high", "Image request failed", `HTTP ${analysis.status}: ${analysis.url}`, "Correct or replace the image URL.");
  return out;
}
