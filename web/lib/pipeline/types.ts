import type { AuditConfig } from "./config";
export type JobStatus = "QUEUED" | "RUNNING" | "PAUSED" | "CANCELLING" | "CANCELLED" | "COMPLETED" | "FAILED";
export interface AuditJob { id: string; owner_id: string; project_id: string | null; url: string; config: AuditConfig; status: JobStatus; stage: string; workflow_run_id: string | null; robots: import("../robots").RobotsInfo | null; summary: Record<string, unknown>; error: string | null; created_at: string; updated_at: string; completed_at: string | null }
export interface CrawlTask { id: string; job_id: string; kind: string; url: string; depth: number; source_url: string | null; payload: Record<string, unknown>; attempts: number; lease_token: string; status: string; error?: string }
export interface TaskInput { kind: string; url: string; depth?: number; source_url?: string; payload?: Record<string, unknown>; priority?: number }
export interface EvidenceRecord<T = unknown> { job_id?: string; kind: string; key: string; url: string; source_url?: string; title?: string; category?: string; severity?: string; status?: string; data: T }
export interface Progress { pending: number; running: number; done: number; failed: number; skipped: number; total: number; pages: number; images: number; nextAttempt: string | null }
export interface TaskOutput { records: EvidenceRecord[]; tasks: TaskInput[]; metadata?: Record<string, unknown> }
