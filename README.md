# 🍞 CA Food Finder

A free, privacy-first map + list of places to **get free food** or **donate
food** across California's 10 largest metros. No sign-up required to browse.

Built with Next.js (App Router, TypeScript, Tailwind), MapLibre GL with
OpenFreeMap tiles, and open data from OpenStreetMap.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

The admin dashboard lives at `/admin` — set `ADMIN_KEY` in `.env.local`
(change the default before deploying!).

## Data pipeline

```bash
# 1. Fetch raw data from the Overpass API (OpenStreetMap)
curl -sS -A "ca-food-finder-ingest/0.1 (contact: you@example.com)" \
  -X POST --data-urlencode data@scripts/ingest/sources/osm-query.txt \
  https://overpass-api.de/api/interpreter -o data/raw-osm.json

# 2. Normalize + dedupe + metro-tag → data/locations.json
node scripts/ingest/normalize.mjs
```

Re-run weekly to stay fresh (set up a cron job or GitHub Action).

- **Current sources:** OpenStreetMap (© OpenStreetMap contributors, ODbL —
  attribution is rendered on every listing and on the map).
- **Planned sources:** USDA meal-site data, CA Association of Food Banks
  directory, Food Oasis LA. Add a new adapter function in
  `scripts/ingest/normalize.mjs` per source (see `fromOsm`).
- **Never** ingest Google Places data — its terms forbid storing results.

`data/ca-zips.json` holds CA ZIP-code centroids from the 2023 US Census ZCTA
gazetteer (public domain) and powers the ZIP search offline.

## Architecture notes

- **Locations** are served statically from `data/locations.json` — at this
  scale (hundreds of records) no database is needed and distance sorting is
  done client-side with haversine. When the dataset grows past ~10k records,
  migrate to Supabase Postgres + PostGIS (`ORDER BY location <-> point`).
- **Reports** (`/api/report`) are stored in `data/reports.json` with
  IP rate-limiting (5/hour) and a honeypot field. ⚠️ On Vercel the filesystem
  is ephemeral — before deploying, swap the file read/write in
  `src/app/api/report/route.ts` and `src/app/api/admin/reports/route.ts`
  for a Supabase table (`reports`: id, location_id, issue_type, details,
  status, created_at). The UI needs no changes.
- **Hours**: OSM `opening_hours` strings are parsed by a deliberately
  conservative parser (`src/lib/hours.ts`) — anything it can't parse shows
  as "unknown" rather than guessing wrong, so the "Open now" filter never
  lies.
- **PWA**: `src/app/manifest.ts` makes the app installable to a phone's
  home screen.

## Deploying (free tier)

1. Push to GitHub, import into [Vercel](https://vercel.com) — zero config.
2. Set `ADMIN_KEY` in Vercel's environment variables.
3. (Before real traffic) create a free [Supabase](https://supabase.com)
   project and move reports storage there, per the note above.

## Roadmap

- [ ] USDA + CAFB + Food Oasis LA ingestion adapters (fills sparse metros:
      San Diego, Anaheim, Bakersfield)
- [ ] Reports storage on Supabase; optional accounts (magic link) + favorites
- [ ] Spanish translation
- [ ] Verified-badge workflow; auto-flag listings with 2+ unresolved reports
- [ ] Eligibility / dietary / no-ID filters once source data supports them
- [ ] Statewide rural coverage, then other states
