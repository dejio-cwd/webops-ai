"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuditConsole } from "@/components/audit-console";
function AuditRoute(){const params=useSearchParams();return <AuditConsole projectId={params.get("projectId") || ""} initialJobId={params.get("jobId") || ""} initialView={params.get("view") || "Overview"}/>;}
export default function AuditsPage(){return <Suspense fallback={<p>Loading audit workspace…</p>}><AuditRoute/></Suspense>;}
