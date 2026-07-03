"use client";

import { useEffect, useState } from "react";
import type { DataReport } from "@/lib/types";
import { ISSUE_LABELS } from "@/lib/types";

export default function AdminPage() {
  const [key, setKey] = useState("");
  const [entered, setEntered] = useState(false);
  const [reports, setReports] = useState<DataReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("adminKey");
    if (saved) {
      setKey(saved);
      setEntered(true);
    }
  }, []);

  useEffect(() => {
    if (!entered || !key) return;
    fetch("/api/admin/reports", { headers: { "x-admin-key": key } })
      .then(async (res) => {
        if (res.status === 401) {
          setError("Wrong admin key.");
          setEntered(false);
          sessionStorage.removeItem("adminKey");
          return;
        }
        const data = await res.json();
        setReports(data.reports);
        sessionStorage.setItem("adminKey", key);
        setError(null);
      })
      .catch(() => setError("Couldn't load reports."));
  }, [entered, key]);

  async function setStatus(id: string, status: DataReport["status"]) {
    await fetch("/api/admin/reports", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-key": key },
      body: JSON.stringify({ id, status }),
    });
    setReports(
      (rs) => rs?.map((r) => (r.id === id ? { ...r, status } : r)) ?? null
    );
  }

  if (!entered) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16">
        <h1 className="text-xl font-bold">Admin — Data Error Reports</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setEntered(true);
          }}
          className="mt-4"
        >
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Admin key"
            className="w-full rounded-lg border border-stone-300 px-3 py-2"
          />
          <button
            type="submit"
            className="mt-3 w-full rounded-lg bg-stone-800 px-4 py-2 font-medium text-white"
          >
            Enter
          </button>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </form>
      </div>
    );
  }

  const badge: Record<DataReport["status"], string> = {
    new: "bg-red-100 text-red-800",
    reviewed: "bg-amber-100 text-amber-800",
    resolved: "bg-green-100 text-green-800",
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-bold">Data Error Reports</h1>
      {!reports ? (
        <p className="mt-4 text-stone-500">Loading…</p>
      ) : reports.length === 0 ? (
        <p className="mt-4 text-stone-500">No reports yet. 🎉</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {reports.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-stone-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge[r.status]}`}>
                  {r.status}
                </span>
                <span className="font-semibold">{r.locationName}</span>
                <span className="text-sm text-stone-500">
                  {ISSUE_LABELS[r.issueType]} ·{" "}
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              {r.details && (
                <p className="mt-2 text-sm text-stone-700">{r.details}</p>
              )}
              <div className="mt-3 flex gap-2 text-sm">
                <a
                  href={`/location/${r.locationId}`}
                  className="text-green-700 underline"
                >
                  View listing
                </a>
                {r.status !== "reviewed" && (
                  <button
                    onClick={() => setStatus(r.id, "reviewed")}
                    className="text-amber-700 underline"
                  >
                    Mark reviewed
                  </button>
                )}
                {r.status !== "resolved" && (
                  <button
                    onClick={() => setStatus(r.id, "resolved")}
                    className="text-green-700 underline"
                  >
                    Mark resolved
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
