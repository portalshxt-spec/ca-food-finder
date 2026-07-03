/**
 * Fetch raw data from every source into data/raw-*.{json,xml}.
 * Safe to re-run: a failed source keeps its previous raw file (stale data
 * beats no data), and a source returning suspiciously few records is
 * rejected for the same reason.
 *
 * Run: node scripts/ingest/fetch.mjs   (then normalize.mjs)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = join(root, "data");
const UA = "ca-food-finder-ingest/1.0 (community food access map)";
const today = () => new Date().toISOString().slice(0, 10);

let failures = 0;

async function source(name, file, minRecords, countFn, fetchFn) {
  try {
    const payload = await fetchFn();
    const n = countFn(payload);
    if (n < minRecords) {
      throw new Error(`only ${n} records (expected >= ${minRecords})`);
    }
    writeFileSync(join(dataDir, file), typeof payload === "string" ? payload : JSON.stringify(payload));
    console.log(`✓ ${name}: ${n} records`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} FAILED (${err.message}) — keeping previous ${file}`);
  }
}

const jget = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { "User-Agent": UA, ...opts.headers } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
};

// 1. OpenStreetMap (Overpass)
await source("openstreetmap", "raw-osm.json", 100,
  (p) => p.elements.length,
  async () => {
    const query = readFileSync(join(root, "scripts/ingest/sources/osm-query.txt"), "utf8");
    const r = await jget("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(query),
    });
    return r.json();
  });

// 2. SF-Marin Food Bank (all county/senior/urgent variants)
await source("sf-marin-food-bank", "raw-sfmarin.json", 50,
  (p) => p.variants.reduce((s, v) => s + v.ngns.length + v.sfps.length + v.efbs.length, 0),
  async () => {
    const variants = [];
    for (const county of ["sf", "marin"]) {
      for (const [senior, urgent] of [["0", "0"], ["1", "0"], ["0", "1"]]) {
        const r1 = await jget(`https://foodlocator.sfmfoodbank.org/en/${county}`);
        const cookies = r1.headers.getSetCookie().map((c) => c.split(";")[0]);
        const xsrf = decodeURIComponent(
          cookies.find((c) => c.startsWith("XSRF-TOKEN=")).split("=").slice(1).join("=")
        );
        const r2 = await jget("https://foodlocator.sfmfoodbank.org/resource", {
          method: "POST",
          headers: {
            "Content-Type": "application/json;charset=utf-8",
            Accept: "application/json",
            "X-XSRF-TOKEN": xsrf,
            "X-Requested-With": "XMLHttpRequest",
            Cookie: cookies.join("; "),
            Referer: `https://foodlocator.sfmfoodbank.org/en/${county}`,
          },
          body: JSON.stringify({
            visit_county: county, visit_zip: "unknown", visit_senior: senior,
            visit_urgent: urgent, visit_disabled: "0", visit_lang: "en",
            visit_calfresh: "0", visit_hdg: "0", visit_purpose: "resources",
          }),
        });
        const j = await r2.json();
        variants.push({ county, senior, urgent, ngns: j.ngns ?? [], sfps: j.sfps ?? [], efbs: j.efbs ?? [] });
        await new Promise((res) => setTimeout(res, 800));
      }
    }
    return { fetchedAt: today(), variants };
  });

// 3 + 4. Storepoint networks (Feeding San Diego, LA Regional Food Bank)
for (const [name, file, mapId] of [
  ["feeding-san-diego", "raw-feedingsd.json", "16765f3e46d5c1"],
  ["la-regional-food-bank", "raw-lafb.json", "163e12f02a0d79"],
]) {
  await source(name, file, 100,
    (p) => p.results.locations.length,
    async () => {
      const r = await jget(`https://api.storepoint.co/v1/${mapId}/locations?rq`);
      const j = await r.json();
      j.fetchedAt = today();
      return j;
    });
}

// 5. Sacramento Food Bank (Vivery/AccessFood)
await source("sacramento-food-bank", "raw-sacramento.json", 100,
  (p) => p.locations.length,
  async () => {
    const all = [];
    for (let page = 1; page <= 30; page++) {
      const u = `https://api.accessfood.org/api/MapInformation/LocationSearch?radius=100&lat=38.5816&lng=-121.4944&dayAv=&foodProgramAv=&serviceTypeAv=&foodOfferingAv=&dietRestrictionAv=&locationFeatureAv=&languagesAv=&serviceCategoriesAv=&regionId=41&regionMapId=64&showOutOfNetwork=0&page=${page}&pageSize=20`;
      const r = await jget(u);
      const j = await r.json();
      const batch = j.item1 ?? [];
      all.push(...batch);
      if (batch.length < 20) break;
      await new Promise((res) => setTimeout(res, 300));
    }
    return { fetchedAt: today(), regionName: "Sacramento Food Bank & Family Services", locations: all };
  });

// 6. Second Harvest of Silicon Valley
await source("second-harvest-sv", "raw-shfb.json", 100,
  (p) => Object.keys(p.locations).length,
  async () => {
    const r = await jget("https://www.shfb.org/wp-admin/admin-ajax.php?action=mmfl_get_data");
    const j = await r.json();
    j.fetchedAt = today();
    return j;
  });

// 7. Alameda County Community Food Bank (GraphQL)
await source("alameda-county-food-bank", "raw-accfb.json", 100,
  (p) => p.locations.length,
  async () => {
    const gql = async (q) => {
      const r = await jget("https://accfbfnfaust.wpengine.com/index.php?graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      return r.json();
    };
    const locs = await gql(
      "{ locations(first: 2000) { nodes { title locationFields { agencyIdentifier additionalDetails alertMessage addressLine1 addressLine2 archive city displayName fbcAgencyCategoryCode zipCode latitude longitude } } } }"
    );
    const sch = await gql(
      "{ locationSchedules(first: 5000) { nodes { locationScheduleFeilds { agencyNo weeks dayOfWeek startTime1 startTime2 endTime1 endTime2 } } } }"
    );
    return {
      fetchedAt: today(),
      locations: locs.data.locations.nodes,
      schedules: sch.data.locationSchedules.nodes,
    };
  });

// 8. Central California Food Bank (Super Store Finder XML)
await source("central-ca-food-bank", "raw-ccfb.xml", 100,
  (p) => (p.match(/<item>/g) ?? []).length,
  async () => {
    const r = await jget("https://ccfoodbank.org/wp-content/plugins/superstorefinder-wp/ssf-wp-xml.php");
    return r.text();
  });

// 9. CAPK Bakersfield (WP Go Maps markers)
await source("capk", "raw-capk.json", 50,
  (p) => p.length,
  async () => {
    const r = await jget("https://www.capk.org/wp-json/wpgmza/v1/markers");
    return r.json();
  });

console.log(failures ? `Done with ${failures} failed source(s).` : "All sources fetched.");
process.exit(0); // failed sources keep stale data; normalize still runs
