import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocationsFile } from "@/lib/data";
import { TYPE_LABELS } from "@/lib/types";
import { friendlyHours } from "@/lib/hours";
import ReportErrorButton from "@/components/ReportErrorButton";

export function generateStaticParams() {
  return getLocationsFile().locations.map((l) => ({ id: l.id }));
}

export default async function LocationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loc = getLocationsFile().locations.find((l) => l.id === id);
  if (!loc) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/" className="text-sm text-green-700 hover:underline">
        ← Back to map
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{loc.name}</h1>
        <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800">
          {TYPE_LABELS[loc.type]}
        </span>
        {loc.verified && (
          <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800">
            ✓ Verified
          </span>
        )}
      </div>

      {loc.description && (
        <p className="mt-2 text-stone-700">{loc.description}</p>
      )}

      <dl className="mt-5 space-y-4">
        {loc.address && (
          <div>
            <dt className="text-sm font-semibold text-stone-500">Address</dt>
            <dd className="text-lg">{loc.address}</dd>
          </div>
        )}
        <div>
          <dt className="text-sm font-semibold text-stone-500">Hours</dt>
          <dd className="text-lg">
            {loc.hoursRaw ? friendlyHours(loc.hoursRaw) : "Not listed — call ahead"}
          </dd>
        </div>
        {loc.phone && (
          <div>
            <dt className="text-sm font-semibold text-stone-500">Phone</dt>
            <dd>
              <a
                href={`tel:${loc.phone}`}
                className="text-lg text-green-700 hover:underline"
              >
                {loc.phone}
              </a>
            </dd>
          </div>
        )}
        {loc.website && (
          <div>
            <dt className="text-sm font-semibold text-stone-500">Website</dt>
            <dd>
              <a
                href={loc.website}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-lg text-green-700 hover:underline"
              >
                {loc.website} ↗
              </a>
            </dd>
          </div>
        )}
        <div>
          <dt className="text-sm font-semibold text-stone-500">Services</dt>
          <dd className="text-lg">
            {[
              loc.services.givesFood && "Provides free food",
              loc.services.servesMeals && "Serves prepared meals",
              loc.services.acceptsDonations === true &&
                "Accepts food donations",
              loc.services.acceptsDonations === "unverified" &&
                "Likely accepts donations — call to confirm",
            ]
              .filter(Boolean)
              .join(" · ")}
          </dd>
        </div>
        {loc.eligibility && (
          <div>
            <dt className="text-sm font-semibold text-stone-500">
              Eligibility / requirements
            </dt>
            <dd className="text-lg">{loc.eligibility}</dd>
          </div>
        )}
        {loc.wheelchair && (
          <div>
            <dt className="text-sm font-semibold text-stone-500">
              Wheelchair access
            </dt>
            <dd className="text-lg capitalize">{loc.wheelchair}</dd>
          </div>
        )}
      </dl>

      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-green-700 px-5 py-2.5 font-medium text-white hover:bg-green-800"
        >
          Get directions ↗
        </a>
        <a
          href={`https://maps.apple.com/?daddr=${loc.lat},${loc.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-stone-300 px-5 py-2.5 font-medium text-stone-700 hover:bg-stone-50"
        >
           Apple Maps ↗
        </a>
        {loc.phone && (
          <a
            href={`tel:${loc.phone}`}
            className="rounded-lg border border-stone-300 px-5 py-2.5 font-medium text-stone-700 hover:bg-stone-50"
          >
            📞 Call
          </a>
        )}
      </div>

      <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        ⚠️ Hours and services can change — please call ahead to confirm before
        traveling.
      </p>

      <ReportErrorButton locationId={loc.id} locationName={loc.name} />

      <p className="mt-8 border-t border-stone-200 pt-4 text-xs text-stone-500">
        Data source:{" "}
        <a
          href={loc.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {loc.source === "openstreetmap" ? "OpenStreetMap" : loc.source}
        </a>{" "}
        (© OpenStreetMap contributors, ODbL) · Last updated {loc.lastUpdated}
      </p>
    </div>
  );
}
