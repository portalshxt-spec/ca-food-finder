"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { FoodLocation, LocationType, Metro } from "@/lib/types";
import { TYPE_LABELS } from "@/lib/types";
import { haversineMiles, formatMiles } from "@/lib/geo";
import { openStatus, friendlyHours } from "@/lib/hours";
import caZips from "../../data/ca-zips.json";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-stone-100 text-stone-500">
      Loading map…
    </div>
  ),
});

type Mode = "need" | "donate";
const ZIPS = caZips as unknown as Record<string, [number, number]>;

interface Props {
  locations: FoodLocation[];
  metros: Metro[];
}

export default function Finder({ locations, metros }: Props) {
  const [mode, setMode] = useState<Mode>("need");
  const [userPoint, setUserPoint] = useState<{
    lat: number;
    lng: number;
    label: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<LocationType | "all">("all");
  const [maxMiles, setMaxMiles] = useState<number>(25);

  function locate() {
    setSearchError(null);
    if (!navigator.geolocation) {
      setSearchError("Location isn't available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setUserPoint({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: "your location",
        }),
      () => setSearchError("Couldn't get your location — try a ZIP code."),
      { timeout: 10_000 }
    );
  }

  function search(e?: React.FormEvent) {
    e?.preventDefault();
    setSearchError(null);
    const q = query.trim().toLowerCase();
    if (!q) return;
    if (/^\d{5}$/.test(q)) {
      const hit = ZIPS[q];
      if (hit) {
        setUserPoint({ lat: hit[0], lng: hit[1], label: `ZIP ${q}` });
      } else {
        setSearchError("That ZIP code isn't in California.");
      }
      return;
    }
    const metro = metros.find((m) => m.name.toLowerCase().includes(q));
    if (metro) {
      setUserPoint({ lat: metro.lat, lng: metro.lng, label: metro.name });
    } else {
      setSearchError(
        "Enter a 5-digit ZIP code or a major city (e.g. Fresno)."
      );
    }
  }

  const filtered = useMemo(() => {
    let list = locations;
    if (mode === "donate") {
      list = list.filter((l) => l.services.acceptsDonations !== false);
    }
    if (typeFilter !== "all") list = list.filter((l) => l.type === typeFilter);
    if (openNowOnly) list = list.filter((l) => openStatus(l.hoursRaw) === "open");
    if (userPoint) {
      list = list
        .map((l) => ({
          ...l,
          _mi: haversineMiles(userPoint.lat, userPoint.lng, l.lat, l.lng),
        }))
        .filter((l) => (l as FoodLocation & { _mi: number })._mi <= maxMiles)
        .sort(
          (a, b) =>
            (a as FoodLocation & { _mi: number })._mi -
            (b as FoodLocation & { _mi: number })._mi
        );
    }
    return list as (FoodLocation & { _mi?: number })[];
  }, [locations, mode, typeFilter, openNowOnly, userPoint, maxMiles]);

  // The clicked map dot — always shown as a pinned card, even when the
  // list is empty or the location falls outside the current filters.
  const selected = selectedId
    ? locations.find((l) => l.id === selectedId) ?? null
    : null;
  const selectedMi =
    selected && userPoint
      ? haversineMiles(userPoint.lat, userPoint.lng, selected.lat, selected.lng)
      : null;

  return (
    <div className="flex h-dvh flex-col">
      {/* Header */}
      <header className="border-b border-stone-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <h1 className="text-lg font-bold text-stone-900">
            🍞 CA Food Finder
          </h1>
          <div
            role="group"
            aria-label="Mode"
            className="flex overflow-hidden rounded-full border border-stone-300 text-sm font-medium"
          >
            <button
              onClick={() => setMode("need")}
              aria-pressed={mode === "need"}
              className={`px-4 py-1.5 ${
                mode === "need"
                  ? "bg-green-700 text-white"
                  : "bg-white text-stone-700 hover:bg-stone-50"
              }`}
            >
              I need food
            </button>
            <button
              onClick={() => setMode("donate")}
              aria-pressed={mode === "donate"}
              className={`px-4 py-1.5 ${
                mode === "donate"
                  ? "bg-blue-700 text-white"
                  : "bg-white text-stone-700 hover:bg-stone-50"
              }`}
            >
              I want to donate
            </button>
          </div>

          <form onSubmit={search} className="flex flex-1 gap-2 min-w-60">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ZIP code or city…"
              aria-label="Search by ZIP code or city"
              className="w-full min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:border-green-600 focus:outline-none"
              inputMode="text"
            />
            <button
              type="submit"
              className="rounded-lg bg-stone-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
            >
              Search
            </button>
            <button
              type="button"
              onClick={locate}
              className="whitespace-nowrap rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
            >
              📍 Use my location
            </button>
          </form>
        </div>

        {/* Filters */}
        <div className="mx-auto mt-2 flex max-w-6xl flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5 rounded-full border border-stone-300 px-3 py-1">
            <input
              type="checkbox"
              checked={openNowOnly}
              onChange={(e) => setOpenNowOnly(e.target.checked)}
            />
            Open now
          </label>
          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as LocationType | "all")
            }
            aria-label="Filter by place type"
            className="rounded-full border border-stone-300 px-3 py-1"
          >
            <option value="all">All types</option>
            <option value="food_pantry">Food pantries</option>
            <option value="meal_site">Free meals</option>
            <option value="donation_dropoff">Donation drop-offs</option>
          </select>
          {userPoint && (
            <select
              value={maxMiles}
              onChange={(e) => setMaxMiles(+e.target.value)}
              aria-label="Maximum distance"
              className="rounded-full border border-stone-300 px-3 py-1"
            >
              <option value={5}>Within 5 mi</option>
              <option value={10}>Within 10 mi</option>
              <option value={25}>Within 25 mi</option>
              <option value={50}>Within 50 mi</option>
            </select>
          )}
          <span
            className="rounded-full border border-dashed border-stone-300 px-3 py-1 text-stone-400"
            title="Dietary and eligibility data is being added — coming soon"
          >
            Dietary · No-ID · coming soon
          </span>
          {userPoint && (
            <span className="ml-auto text-stone-500">
              {filtered.length} places near {userPoint.label}
            </span>
          )}
        </div>
        {searchError && (
          <p role="alert" className="mx-auto mt-1 max-w-6xl text-sm text-red-700">
            {searchError}
          </p>
        )}
      </header>

      {/* Body: list + map */}
      <div className="flex min-h-0 flex-1 flex-col-reverse sm:flex-row">
        <aside className="h-1/2 w-full overflow-y-auto border-t border-stone-200 bg-stone-50 sm:h-auto sm:w-105 sm:border-r sm:border-t-0">
          {selected && (
            <div className="border-b-2 border-green-600 bg-green-50 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-stone-900">{selected.name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        selected.type === "meal_site"
                          ? "bg-orange-100 text-orange-800"
                          : "bg-green-100 text-green-800"
                      }`}
                    >
                      {TYPE_LABELS[selected.type]}
                    </span>
                    {openStatus(selected.hoursRaw) === "open" && (
                      <span className="font-medium text-green-700">
                        Open now
                      </span>
                    )}
                    {openStatus(selected.hoursRaw) === "closed" && (
                      <span className="text-stone-500">Closed now</span>
                    )}
                    {selectedMi != null && (
                      <span className="font-medium text-stone-500">
                        {formatMiles(selectedMi)} away
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  aria-label="Close selected location"
                  className="rounded-full px-2 text-lg leading-none text-stone-400 hover:text-stone-700"
                >
                  ×
                </button>
              </div>
              {selected.address && (
                <p className="mt-1 text-sm text-stone-700">{selected.address}</p>
              )}
              {selected.hoursRaw && (
                <p className="mt-0.5 text-xs text-stone-500">
                  {friendlyHours(selected.hoursRaw)}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href={`/location/${selected.id}`}
                  className="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800"
                >
                  Full details
                </Link>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-100"
                >
                  Directions ↗
                </a>
                {selected.phone && (
                  <a
                    href={`tel:${selected.phone}`}
                    className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-100"
                  >
                    📞 Call
                  </a>
                )}
              </div>
            </div>
          )}
          {!userPoint ? (
            <div className="p-6 text-center">
              <p className="text-lg font-semibold text-stone-800">
                Enter your ZIP to see what&apos;s nearby
              </p>
              <p className="mt-2 text-sm text-stone-600">
                Or tap <strong>📍 Use my location</strong>. Every dot on the
                map is a place to {mode === "need" ? "get free food" : "donate food"}.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {metros.map((m) => (
                  <button
                    key={m.id}
                    onClick={() =>
                      setUserPoint({ lat: m.lat, lng: m.lng, label: m.name })
                    }
                    className="rounded-full border border-stone-300 bg-white px-3 py-1 text-sm text-stone-700 hover:border-green-600 hover:text-green-700"
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-stone-600">
              No places match within {maxMiles} miles. Try widening the
              distance or clearing filters.
            </p>
          ) : (
            <ul>
              {filtered.map((l) => {
                const status = openStatus(l.hoursRaw);
                return (
                  <li
                    key={l.id}
                    className={`border-b border-stone-200 ${
                      selectedId === l.id ? "bg-green-50" : "bg-white"
                    }`}
                  >
                    <button
                      onClick={() => setSelectedId(l.id)}
                      className="block w-full px-4 py-3 text-left hover:bg-stone-50"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-stone-900">
                          {l.name}
                        </span>
                        {l._mi != null && (
                          <span className="shrink-0 text-sm font-medium text-stone-500">
                            {formatMiles(l._mi)}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`rounded-full px-2 py-0.5 font-medium ${
                            l.type === "meal_site"
                              ? "bg-orange-100 text-orange-800"
                              : "bg-green-100 text-green-800"
                          }`}
                        >
                          {TYPE_LABELS[l.type]}
                        </span>
                        {status === "open" && (
                          <span className="font-medium text-green-700">
                            Open now
                          </span>
                        )}
                        {status === "closed" && (
                          <span className="text-stone-500">Closed now</span>
                        )}
                        {mode === "donate" &&
                          l.services.acceptsDonations === "unverified" && (
                            <span className="text-amber-700">
                              Call to confirm donations
                            </span>
                          )}
                      </div>
                      {l.address && (
                        <p className="mt-1 text-sm text-stone-600">
                          {l.address}
                        </p>
                      )}
                      {l.hoursRaw && (
                        <p className="mt-0.5 text-xs text-stone-500">
                          {friendlyHours(l.hoursRaw)}
                        </p>
                      )}
                    </button>
                    {selectedId === l.id && (
                      <div className="flex gap-2 px-4 pb-3">
                        <Link
                          href={`/location/${l.id}`}
                          className="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800"
                        >
                          Details
                        </Link>
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
                        >
                          Directions ↗
                        </a>
                        {l.phone && (
                          <a
                            href={`tel:${l.phone}`}
                            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
                          >
                            Call
                          </a>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main className="relative min-h-0 flex-1">
          {userPoint && (
            <button
              onClick={() => {
                setUserPoint(null);
                setSelectedId(null);
                setQuery("");
                setSearchError(null);
              }}
              aria-label="Back to statewide map"
              className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3.5 py-2 text-sm font-medium text-stone-800 shadow-md hover:bg-stone-50"
            >
              ← All of California
            </button>
          )}
          <MapView
            locations={filtered}
            selectedId={selectedId}
            onSelect={setSelectedId}
            userPoint={userPoint}
          />
        </main>
      </div>
    </div>
  );
}
