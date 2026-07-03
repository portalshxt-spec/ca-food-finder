import { NextRequest, NextResponse } from "next/server";
import { addReport } from "@/lib/reportStore";
import type { ReportIssueType } from "@/lib/types";

export const runtime = "nodejs";

const VALID_ISSUES: ReportIssueType[] = [
  "closed_permanently",
  "wrong_hours",
  "wrong_address",
  "wrong_phone",
  "other",
];

// Simple in-memory rate limit: max 5 reports/hour per IP. On serverless this
// resets between cold starts — the honeypot below is the primary spam guard.
const hits = new Map<string, number[]>();
const LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) return true;
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  // honeypot: real users never fill the hidden "website" field
  if (typeof body.website === "string" && body.website.length > 0) {
    return NextResponse.json({ ok: true }); // silently drop bot submissions
  }

  const locationId = String(body.locationId ?? "");
  const issueType = String(body.issueType ?? "") as ReportIssueType;
  if (!locationId || !VALID_ISSUES.includes(issueType)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  try {
    await addReport({
      locationId,
      locationName: String(body.locationName ?? "").slice(0, 200),
      issueType,
      details: String(body.details ?? "").slice(0, 1000),
    });
  } catch {
    return NextResponse.json({ error: "storage" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
