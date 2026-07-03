import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { DataReport, ReportIssueType } from "./types";

/**
 * Report storage. Two backends:
 *  - Supabase (production/Vercel): set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *    Talks to the PostgREST API directly — no client library needed.
 *  - Local JSON file (development): data/reports.json.
 */

const REPORTS_PATH = join(process.cwd(), "data", "reports.json");

function supabase(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

function sbHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

interface SbRow {
  id: string;
  location_id: string;
  location_name: string | null;
  issue_type: ReportIssueType;
  details: string | null;
  status: DataReport["status"];
  created_at: string;
}

function fromRow(r: SbRow): DataReport {
  return {
    id: r.id,
    locationId: r.location_id,
    locationName: r.location_name ?? "",
    issueType: r.issue_type,
    details: r.details ?? "",
    createdAt: r.created_at,
    status: r.status,
  };
}

function readFileReports(): DataReport[] {
  if (!existsSync(REPORTS_PATH)) return [];
  return JSON.parse(readFileSync(REPORTS_PATH, "utf8"));
}

function writeFileReports(reports: DataReport[]) {
  mkdirSync(dirname(REPORTS_PATH), { recursive: true });
  writeFileSync(REPORTS_PATH, JSON.stringify(reports, null, 1));
}

export async function addReport(input: {
  locationId: string;
  locationName: string;
  issueType: ReportIssueType;
  details: string;
}): Promise<void> {
  const sb = supabase();
  if (sb) {
    const res = await fetch(`${sb.url}/rest/v1/reports`, {
      method: "POST",
      headers: { ...sbHeaders(sb.key), Prefer: "return=minimal" },
      body: JSON.stringify({
        location_id: input.locationId,
        location_name: input.locationName,
        issue_type: input.issueType,
        details: input.details,
      }),
    });
    if (!res.ok) throw new Error(`supabase insert failed: ${res.status}`);
    return;
  }
  const reports = readFileReports();
  reports.push({
    id: randomUUID(),
    locationId: input.locationId,
    locationName: input.locationName,
    issueType: input.issueType,
    details: input.details,
    createdAt: new Date().toISOString(),
    status: "new",
  });
  writeFileReports(reports);
}

export async function listReports(): Promise<DataReport[]> {
  const sb = supabase();
  if (sb) {
    const res = await fetch(
      `${sb.url}/rest/v1/reports?select=*&order=created_at.desc`,
      { headers: sbHeaders(sb.key), cache: "no-store" }
    );
    if (!res.ok) throw new Error(`supabase select failed: ${res.status}`);
    return ((await res.json()) as SbRow[]).map(fromRow);
  }
  return readFileReports().reverse();
}

export async function setReportStatus(
  id: string,
  status: DataReport["status"]
): Promise<boolean> {
  const sb = supabase();
  if (sb) {
    const res = await fetch(
      `${sb.url}/rest/v1/reports?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { ...sbHeaders(sb.key), Prefer: "return=representation" },
        body: JSON.stringify({ status }),
      }
    );
    if (!res.ok) return false;
    return ((await res.json()) as SbRow[]).length > 0;
  }
  const reports = readFileReports();
  const report = reports.find((r) => r.id === id);
  if (!report) return false;
  report.status = status;
  writeFileReports(reports);
  return true;
}
