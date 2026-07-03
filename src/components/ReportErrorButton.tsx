"use client";

import { useState } from "react";
import { ISSUE_LABELS, type ReportIssueType } from "@/lib/types";

interface Props {
  locationId: string;
  locationName: string;
}

export default function ReportErrorButton({ locationId, locationName }: Props) {
  const [open, setOpen] = useState(false);
  const [issueType, setIssueType] = useState<ReportIssueType>("wrong_hours");
  const [details, setDetails] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(
    "idle"
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          locationName,
          issueType,
          details,
          website: honeypot, // honeypot field — bots fill it, humans don't
        }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-green-800">
        ✓ Thank you — your report was received and will be reviewed.
      </p>
    );
  }

  return (
    <div className="mt-6">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          ⚑ Report Data Error
        </button>
      ) : (
        <form
          onSubmit={submit}
          className="rounded-lg border border-stone-200 bg-stone-50 p-4"
        >
          <h2 className="font-semibold">Report a data error</h2>
          <p className="mt-1 text-sm text-stone-600">
            No account needed. Your report helps keep this listing accurate.
          </p>
          <label className="mt-3 block text-sm font-medium">
            What&apos;s wrong?
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value as ReportIssueType)}
              className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2"
            >
              {Object.entries(ISSUE_LABELS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium">
            Details (optional)
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={1000}
              rows={3}
              className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2"
              placeholder="e.g. They moved to a new address on Main St."
            />
          </label>
          {/* honeypot — hidden from real users */}
          <input
            type="text"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={state === "sending"}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
            >
              {state === "sending" ? "Sending…" : "Send report"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700"
            >
              Cancel
            </button>
          </div>
          {state === "error" && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              Couldn&apos;t send — please try again in a minute.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
