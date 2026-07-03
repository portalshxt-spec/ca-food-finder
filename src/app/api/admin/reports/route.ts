import { NextRequest, NextResponse } from "next/server";
import { listReports, setReportStatus } from "@/lib/reportStore";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const key = process.env.ADMIN_KEY;
  if (!key) return false;
  return req.headers.get("x-admin-key") === key;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ reports: await listReports() });
  } catch {
    return NextResponse.json({ error: "storage" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, status } = await req.json();
  if (!["new", "reviewed", "resolved"].includes(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }
  const ok = await setReportStatus(String(id), status);
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
