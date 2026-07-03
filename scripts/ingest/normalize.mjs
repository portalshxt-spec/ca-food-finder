/**
 * Normalize raw source data into the canonical locations schema.
 * Input:  data/raw-osm.json  (Overpass API response)
 * Output: data/locations.json (normalized, deduped, metro-tagged)
 *
 * Run: node scripts/ingest/normalize.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The 10 launch metros (center coords) — used to tag each location.
const METROS = [
  { id: "los-angeles", name: "Los Angeles", lat: 34.0522, lng: -118.2437 },
  { id: "san-diego", name: "San Diego", lat: 32.7157, lng: -117.1611 },
  { id: "san-jose", name: "San Jose", lat: 37.3382, lng: -121.8863 },
  { id: "san-francisco", name: "San Francisco", lat: 37.7749, lng: -122.4194 },
  { id: "fresno", name: "Fresno", lat: 36.7378, lng: -119.7871 },
  { id: "sacramento", name: "Sacramento", lat: 38.5816, lng: -121.4944 },
  { id: "long-beach", name: "Long Beach", lat: 33.7701, lng: -118.1937 },
  { id: "oakland", name: "Oakland", lat: 37.8044, lng: -122.2712 },
  { id: "bakersfield", name: "Bakersfield", lat: 35.3733, lng: -119.0187 },
  { id: "anaheim", name: "Anaheim", lat: 33.8366, lng: -117.9143 },
];
const METRO_RADIUS_KM = 50;

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestMetro(lat, lng) {
  let best = null;
  let bestKm = Infinity;
  for (const m of METROS) {
    const km = haversineKm(lat, lng, m.lat, m.lng);
    if (km < bestKm) {
      bestKm = km;
      best = m;
    }
  }
  return bestKm <= METRO_RADIUS_KM ? best.id : null;
}

function buildAddress(tags) {
  const num = tags["addr:housenumber"];
  const street = tags["addr:street"];
  const city = tags["addr:city"];
  const zip = tags["addr:postcode"];
  const line1 = [num, street].filter(Boolean).join(" ");
  const line2 = [city, zip ? `CA ${zip}` : city ? "CA" : null]
    .filter(Boolean)
    .join(", ");
  return [line1, line2].filter(Boolean).join(", ") || null;
}

// --- OSM source adapter ---
function fromOsm(raw, fetchedAt) {
  const out = [];
  for (const el of raw.elements) {
    const tags = el.tags ?? {};
    if (!tags.name) continue; // unnamed points aren't actionable for users
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;

    const kind = tags.social_facility;
    const type = kind === "soup_kitchen" ? "meal_site" : "food_pantry";
    out.push({
      id: `osm-${el.type}-${el.id}`,
      name: tags.name,
      type, // food_pantry | meal_site | donation_dropoff
      description: tags.description ?? null,
      address: buildAddress(tags),
      lat,
      lng,
      metro: nearestMetro(lat, lng),
      phone: tags.phone ?? tags["contact:phone"] ?? null,
      website: tags.website ?? tags["contact:website"] ?? null,
      hoursRaw: tags.opening_hours ?? null, // OSM opening_hours syntax
      services: {
        givesFood: true,
        servesMeals: type === "meal_site",
        // Most food banks accept public donations, but unverified — the UI
        // must present this as "call to confirm".
        acceptsDonations: type === "food_pantry" ? "unverified" : false,
      },
      acceptedItems: null,
      eligibility: null,
      languages: null,
      dietaryOptions: null,
      wheelchair: tags.wheelchair ?? null,
      source: "openstreetmap",
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      lastUpdated: fetchedAt,
      verified: false,
    });
  }
  return out;
}

// --- USDA Summer Meals source adapter ---
const USDA_DAYS = {
  M: "Mo",
  T: "Tu",
  W: "We",
  TH: "Th",
  F: "Fr",
  S: "Sa",
  SA: "Sa",
  SU: "Su",
};

function usdaTime(t) {
  // "8:30am-9:15am" -> "08:30-09:15" (OSM style, parseable by src/lib/hours)
  const m = t
    .toLowerCase()
    .replace(/\s/g, "")
    .match(/^(\d{1,2}):(\d{2})(am|pm)-(\d{1,2}):(\d{2})(am|pm)$/);
  if (!m) return null;
  const to24 = (h, min, ap) => {
    let hh = +h % 12;
    if (ap === "pm") hh += 12;
    return `${String(hh).padStart(2, "0")}:${min}`;
  };
  return `${to24(m[1], m[2], m[3])}-${to24(m[4], m[5], m[6])}`;
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fromUsda(raw, fetchedAt) {
  const out = [];
  for (const f of raw.features) {
    const a = f.attributes;
    if (!a.Site_Name || a.X == null || a.Y == null) continue;
    if (a.End_date && a.End_date < Date.now()) continue; // season over

    const days = (a.Days_of_operation ?? "")
      .split(",")
      .map((d) => USDA_DAYS[d.trim().toUpperCase()])
      .filter(Boolean);
    const times = [
      a.Breakfast_Time2,
      a.Snack_Time_AM2,
      a.Lunch_Time2,
      a.Snack_Time_PM2,
      a.Dinner_Supper_Time2,
    ]
      .filter(Boolean)
      .map(usdaTime)
      .filter(Boolean);
    const hoursRaw =
      days.length && times.length ? `${days.join(",")} ${times.join(",")}` : null;

    const zip = (a.Site_Zip ?? "").slice(0, 5);
    const address =
      [a.Site_Address1, a.Site_Address2].filter(Boolean).join(", ") +
      (a.Site_City ? `, ${titleCase(a.Site_City)}, CA${zip ? " " + zip : ""}` : "");
    const season =
      a.Start_date && a.End_date
        ? ` Serving ${fmtDate(a.Start_date)} – ${fmtDate(a.End_date)}.`
        : "";

    out.push({
      id: `usda-${a.GlobalID}`,
      name: titleCase(a.Site_Name),
      type: "meal_site",
      description: `Free summer meals for kids and teens 18 and under.${season}${
        a.Sponsoring_Organization ? ` Sponsored by ${titleCase(a.Sponsoring_Organization)}.` : ""
      }`,
      address: address || null,
      lat: a.Y,
      lng: a.X,
      metro: nearestMetro(a.Y, a.X),
      phone: a.Site_Phone || null,
      website: null,
      hoursRaw,
      services: { givesFood: true, servesMeals: true, acceptsDonations: false },
      acceptedItems: null,
      eligibility:
        "Kids and teens 18 and under — free, no ID, sign-up, or application needed.",
      languages: null,
      dietaryOptions: null,
      wheelchair: null,
      source: "usda-summer-meals",
      sourceUrl: "https://www.fns.usda.gov/summer/sitefinder",
      lastUpdated: raw.fetchedAt ?? fetchedAt,
      verified: false,
    });
  }
  return out;
}

function titleCase(s) {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(Of|And|The|At|In)\b/g, (w) => w.toLowerCase());
}

// --- SF-Marin Food Bank locator adapter (foodlocator.sfmfoodbank.org) ---
const DAYNAME_TO_OSM = {
  sunday: "Su",
  monday: "Mo",
  tuesday: "Tu",
  wednesday: "We",
  thursday: "Th",
  friday: "Fr",
  saturday: "Sa",
};

function sfmTime(t) {
  // "12:00 pm" -> "12:00"
  const m = (t ?? "").toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (!m) return null;
  let hh = +m[1] % 12;
  if (m[3] === "pm") hh += 12;
  return `${String(hh).padStart(2, "0")}:${m[2]}`;
}

function fromSfMarin(raw, fetchedAt) {
  const seen = new Map(); // kind-id -> location
  for (const v of raw.variants) {
    const groups = [
      ["ngn", v.ngns],
      ["sfp", v.sfps],
      ["efb", v.efbs],
    ];
    for (const [kind, list] of groups) {
      for (const p of list ?? []) {
        const key = `${kind}-${p.id}`;
        if (seen.has(key) || p.lat == null || p.lng == null) continue;

        const day = DAYNAME_TO_OSM[(p.distro_day ?? "").toLowerCase()];
        const start = sfmTime(p.distro_start);
        const end = sfmTime(p.distro_end);
        const hoursRaw = day && start && end ? `${day} ${start}-${end}` : null;

        let eligibility;
        if (kind === "sfp") {
          eligibility = "Seniors (60+) — free monthly grocery box.";
        } else if (kind === "efb") {
          eligibility = "Anyone in urgent need — emergency food, no enrollment needed.";
        } else if (p.senior) {
          eligibility = "Seniors — weekly pantry; enroll on site or by phone.";
        } else {
          eligibility =
            "Open to all adults and families — weekly pantry; enroll on site." +
            (p.waitlisted ? " Currently has a waitlist." : "");
        }

        const nextDates = [p.distro_next, p.distro_next2, p.distro_next3]
          .filter(Boolean)
          .join(", ");

        seen.set(key, {
          id: `sfm-${key}`,
          name: p.name,
          type: "food_pantry",
          description:
            `${
              kind === "efb"
                ? "Emergency food box site"
                : kind === "sfp"
                ? "Senior grocery program"
                : "Weekly neighborhood grocery pantry"
            } run with the San Francisco-Marin Food Bank.` +
            (nextDates ? ` Upcoming distributions: ${nextDates}.` : ""),
          address: [p.address, p.city ? `${p.city}, CA` : null, p.zip]
            .filter(Boolean)
            .join(", "),
          lat: p.lat,
          lng: p.lng,
          metro: nearestMetro(p.lat, p.lng),
          phone: p.phone ?? null,
          website: "https://foodlocator.sfmfoodbank.org",
          hoursRaw,
          services: {
            givesFood: true,
            servesMeals: false,
            acceptsDonations: false,
          },
          acceptedItems: null,
          eligibility,
          languages: (p.languages ?? []).length ? p.languages : null,
          dietaryOptions: p.lowcook ? ["low-cook / no-cook options"] : null,
          wheelchair: p.wheelchair ? "yes" : null,
          source: "sf-marin-food-bank",
          sourceUrl: "https://foodlocator.sfmfoodbank.org",
          lastUpdated: raw.fetchedAt ?? fetchedAt,
          verified: true, // operator's own live data, incl. next distro dates
        });
      }
    }
  }
  return [...seen.values()];
}

// --- Feeding San Diego adapter (Storepoint locator API) ---
const SP_DAYS = [
  ["monday", "Mo"],
  ["tuesday", "Tu"],
  ["wednesday", "We"],
  ["thursday", "Th"],
  ["friday", "Fr"],
  ["saturday", "Sa"],
  ["sunday", "Su"],
];

function spHours(loc) {
  // Storepoint per-day fields like "9:00 AM - 11:00 AM"; empty = closed/unknown
  const parts = [];
  for (const [field, osm] of SP_DAYS) {
    const v = (loc[field] ?? "").trim();
    const m = v
      .toLowerCase()
      .replace(/\s/g, "")
      .match(/^(\d{1,2})(?::(\d{2}))?(am|pm)-(\d{1,2})(?::(\d{2}))?(am|pm)$/);
    if (!m) continue;
    const to24 = (h, min, ap) => {
      let hh = +h % 12;
      if (ap === "pm") hh += 12;
      return `${String(hh).padStart(2, "0")}:${min ?? "00"}`;
    };
    parts.push(`${osm} ${to24(m[1], m[2], m[3])}-${to24(m[4], m[5], m[6])}`);
  }
  return parts.length ? parts.join("; ") : null;
}

function fromStorepoint(raw, fetchedAt, { sourceId, operator, sourceUrl }) {
  const out = [];
  const locs = raw.results?.locations ?? raw.locations ?? [];
  for (const p of locs) {
    if (!p.name || p.loc_lat == null || p.loc_long == null) continue;
    let schedule = null;
    try {
      const cf = JSON.parse(p.custom_fields ?? "{}");
      schedule = Object.values(cf).filter(Boolean).join(" · ") || null;
    } catch {
      /* ignore malformed custom fields */
    }
    // Some networks (e.g. LA) put the schedule in the description field
    const descText = (p.description ?? "").replace(/<[^>]+>/g, " ").trim();
    const tags = (p.tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const isMeal = tags.some((t) => /meal/i.test(t));

    out.push({
      id: `${sourceId}-${p.id}`,
      name: p.name,
      type: isMeal ? "meal_site" : "food_pantry",
      description:
        `Free food distribution with ${operator}.` +
        (schedule ? ` Schedule: ${schedule}.` : "") +
        (descText ? ` ${descText}` : "") +
        (tags.length ? ` (${tags.join(", ")})` : ""),
      address: (p.streetaddress ?? "").replace(/, (US|United States)$/, "") || null,
      lat: p.loc_lat,
      lng: p.loc_long,
      metro: nearestMetro(p.loc_lat, p.loc_long),
      phone: p.phone || null,
      website: p.website || sourceUrl,
      hoursRaw: spHours(p),
      services: { givesFood: true, servesMeals: isMeal, acceptsDonations: false },
      acceptedItems: null,
      eligibility: "Open to the community — no documentation required.",
      languages: null,
      dietaryOptions: null,
      wheelchair: null,
      source: sourceId,
      sourceUrl,
      lastUpdated: raw.fetchedAt ?? fetchedAt,
      verified: true, // operator's own locator data
    });
  }
  return out;
}

// --- Vivery/AccessFood adapter (used by many food banks; Sacramento first) ---
function stripHtml(s) {
  return (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function fromVivery(raw, fetchedAt, { sourceId, operator, sourceUrl }) {
  const out = [];
  for (const p of raw.locations ?? []) {
    if (!p.locationName || p.latitude == null || p.longitude == null) continue;
    const langs = (p.serviceLanguages ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s.toLowerCase() !== "english");
    const diets = (p.dietRestrictions ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const types = (p.foodServiceTypes ?? "").toLowerCase();
    const isMeal = /meal|soup|dining/.test(types);
    const about = stripHtml(p.aboutUs).slice(0, 400);

    out.push({
      id: `${sourceId}-${p.locationId}`,
      name: p.locationName,
      type: isMeal ? "meal_site" : "food_pantry",
      description:
        (about || `Free food location in the ${operator} network.`) +
        (p.notes ? ` ${stripHtml(p.notes).slice(0, 300)}` : ""),
      address:
        [p.address1, p.address2].filter(Boolean).join(", ") +
        (p.city ? `, ${p.city}, ${p.state ?? "CA"} ${(p.zipCode ?? "").trim()}` : ""),
      lat: p.latitude,
      lng: p.longitude,
      metro: nearestMetro(p.latitude, p.longitude),
      phone: p.phone || p.contactPhone || null,
      website: p.website || sourceUrl,
      hoursRaw: null, // schedules live in a per-location endpoint; call ahead
      services: { givesFood: true, servesMeals: isMeal, acceptsDonations: false },
      acceptedItems: null,
      eligibility: "Open to the community — call to confirm any requirements.",
      languages: langs.length ? langs : null,
      dietaryOptions: diets.length ? diets : null,
      wheelchair: /wheelchair/i.test(p.locationFeatures ?? "") ? "yes" : null,
      source: sourceId,
      sourceUrl,
      lastUpdated: raw.fetchedAt ?? fetchedAt,
      verified: true, // food bank's own network data
    });
  }
  return out;
}

// --- Second Harvest of Silicon Valley adapter (mm-food-locator AJAX API) ---
const LONG_DAY_TO_OSM = {
  monday: "Mo",
  tuesday: "Tu",
  wednesday: "We",
  thursday: "Th",
  friday: "Fr",
  saturday: "Sa",
  sunday: "Su",
};

function fromShfb(raw, fetchedAt) {
  const out = [];
  const campaignsBySite = {};
  for (const c of Object.values(raw.campaigns ?? {})) {
    if (c.status && c.status !== "In Progress") continue;
    (campaignsBySite[c.siteId] ??= []).push(c);
  }
  const schedulesByCampaign = {};
  for (const s of Object.values(raw.schedules ?? {})) {
    (schedulesByCampaign[s.campaignId] ??= []).push(s);
  }

  for (const loc of Object.values(raw.locations ?? {})) {
    if (!loc.name || loc.lat == null || loc.lng == null) continue;
    const campaigns = campaignsBySite[loc.siteId] ?? [];
    if (!campaigns.length) continue; // no active program at this site

    const clauses = [];
    const scheduleNotes = [];
    let isMeal = false;
    for (const c of campaigns) {
      if (/meal|dining/i.test(`${c.type} ${c.originalType}`)) isMeal = true;
      for (const s of schedulesByCampaign[c.campaignId] ?? []) {
        const days = (s.daysOfWeek ?? "")
          .split(/[,;]/)
          .map((d) => LONG_DAY_TO_OSM[d.trim().toLowerCase()])
          .filter(Boolean);
        const t = (x) => (x ?? "").slice(0, 5);
        if (days.length && t(s.startTime) && t(s.endTime)) {
          if ((s.weeklyOccurrence ?? "Every") === "Every") {
            clauses.push(`${days.join(",")} ${t(s.startTime)}-${t(s.endTime)}`);
          } else {
            scheduleNotes.push(
              `${s.weeklyOccurrence} ${s.daysOfWeek} ${t(s.startTime)}-${t(s.endTime)}`
            );
          }
        }
      }
    }

    const c0 = campaigns[0];
    out.push({
      id: `shfb-${loc.siteId}`,
      name: loc.name,
      type: isMeal ? "meal_site" : "food_pantry",
      description:
        `Free groceries with Second Harvest of Silicon Valley.` +
        (c0.specialInstructions ? ` ${c0.specialInstructions}` : "") +
        (scheduleNotes.length ? ` Schedule: ${scheduleNotes.join("; ")}.` : ""),
      address: [loc.street, `${loc.city}, ${loc.state} ${loc.zip}`]
        .filter(Boolean)
        .join(", "),
      lat: loc.lat,
      lng: loc.lng,
      metro: nearestMetro(loc.lat, loc.lng),
      phone: null, // SHFB routes calls through their hotline
      website: "https://www.shfb.org/get-food/",
      hoursRaw: clauses.length ? clauses.join("; ") : null,
      services: { givesFood: true, servesMeals: isMeal, acceptsDonations: false },
      acceptedItems: null,
      eligibility:
        c0.programEligibility === "All" || !c0.programEligibility
          ? "Open to everyone — no documentation required."
          : `Eligibility: ${c0.programEligibility}. Call ahead to confirm.`,
      languages: null,
      dietaryOptions: null,
      wheelchair: null,
      source: "second-harvest-silicon-valley",
      sourceUrl: "https://www.shfb.org/get-food/",
      lastUpdated: raw.fetchedAt ?? fetchedAt,
      verified: true, // operator's own live locator data
    });
  }
  return out;
}

// --- Alameda County Community Food Bank adapter (FoodNow GraphQL) ---
function accfbTime(s) {
  // "1/1/1754 11:00:00 AM" — year 1753 is their null sentinel
  const m = (s ?? "").match(/(\d{4}) (\d{1,2}):(\d{2}):\d{2} (AM|PM)/);
  if (!m || m[1] === "1753") return null;
  let hh = +m[2] % 12;
  if (m[4] === "PM") hh += 12;
  return `${String(hh).padStart(2, "0")}:${m[3]}`;
}

function fromAccfb(raw, fetchedAt) {
  // dayOfWeek appears to be 1=Sunday … 7=Saturday (SQL convention)
  const DOW = [null, "Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const schedByAgency = {};
  for (const n of raw.schedules ?? []) {
    const f = n.locationScheduleFeilds;
    if (f?.agencyNo) (schedByAgency[f.agencyNo] ??= []).push(f);
  }

  const out = [];
  for (const n of raw.locations ?? []) {
    const f = n.locationFields;
    if (!f || f.archive || f.latitude == null || f.longitude == null) continue;
    const name = f.displayName || n.title;
    if (!name) continue;

    const clauses = [];
    const notes = [];
    for (const s of schedByAgency[f.agencyIdentifier] ?? []) {
      const day = DOW[s.dayOfWeek];
      const ranges = [
        [accfbTime(s.startTime1), accfbTime(s.endTime1)],
        [accfbTime(s.startTime2), accfbTime(s.endTime2)],
      ]
        .filter(([a, b]) => a && b)
        .map(([a, b]) => `${a}-${b}`);
      if (!day || !ranges.length) continue;
      if (s.weeks) notes.push(`weeks ${s.weeks}: ${day} ${ranges.join(",")}`);
      else clauses.push(`${day} ${ranges.join(",")}`);
    }

    const cat = (f.fbcAgencyCategoryCode ?? "").toUpperCase();
    const isMeal = /MEAL|SOUP|DINING|HOT/.test(cat);
    out.push({
      id: `accfb-${f.agencyIdentifier}`,
      name,
      type: isMeal ? "meal_site" : "food_pantry",
      description:
        `Free food with the Alameda County Community Food Bank network.` +
        (f.additionalDetails ? ` ${f.additionalDetails}.` : "") +
        (notes.length ? ` Schedule: ${notes.join("; ")}.` : "") +
        (f.alertMessage ? ` ⚠ ${f.alertMessage}` : ""),
      address: [f.addressLine1, f.addressLine2, `${f.city}, CA ${f.zipCode ?? ""}`]
        .filter(Boolean)
        .join(", "),
      lat: f.latitude,
      lng: f.longitude,
      metro: nearestMetro(f.latitude, f.longitude),
      phone: null,
      website: "https://www.foodnow.net/",
      hoursRaw: clauses.length ? clauses.join("; ") : null,
      services: { givesFood: true, servesMeals: isMeal, acceptsDonations: false },
      acceptedItems: null,
      eligibility: /no id/i.test(f.additionalDetails ?? "")
        ? "No ID required — open to everyone."
        : "Open to the community — call ahead to confirm any requirements.",
      languages: null,
      dietaryOptions: null,
      wheelchair: null,
      source: "alameda-county-food-bank",
      sourceUrl: "https://www.foodnow.net/",
      lastUpdated: raw.fetchedAt ?? fetchedAt,
      verified: true,
    });
  }
  return out;
}

// --- Central California Food Bank adapter (Super Store Finder XML) ---
function xmlField(item, tag) {
  const m = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m
    ? m[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
        .trim()
    : "";
}

function fromCcfb(xml, fetchedAt) {
  const out = [];
  for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    if (xmlField(item, "Closed_Pantry") === "true") continue; // no longer operating
    const name = xmlField(item, "location");
    const lat = parseFloat(xmlField(item, "latitude"));
    const lng = parseFloat(xmlField(item, "longitude"));
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const services = xmlField(item, "productsServices");
    const isStudent = xmlField(item, "Student_Pantry") === "true";
    const desc = xmlField(item, "description");
    const hours = xmlField(item, "operatingHours");

    out.push({
      id: `ccfb-${xmlField(item, "storeId")}`,
      name,
      type: "food_pantry",
      description:
        `Free food with the Central California Food Bank network.` +
        (desc ? ` ${desc}.` : "") +
        (services ? ` (${services})` : ""),
      address: xmlField(item, "address").replace(/\s+/g, " ") || null,
      lat,
      lng,
      metro: nearestMetro(lat, lng),
      phone: xmlField(item, "telephone") || null,
      website:
        xmlField(item, "website") ||
        "https://ccfoodbank.org/home/findfood/food-locator/",
      hoursRaw: null, // schedules are free-text (in description); can't parse safely
      services: { givesFood: true, servesMeals: false, acceptsDonations: false },
      acceptedItems: null,
      eligibility: isStudent
        ? "College students — student ID may be required."
        : "Open to the community — call ahead to confirm any requirements." +
          (hours ? ` Hours: ${hours}.` : ""),
      languages: null,
      dietaryOptions: null,
      wheelchair: null,
      source: "central-california-food-bank",
      sourceUrl: "https://ccfoodbank.org/home/findfood/food-locator/",
      lastUpdated: fetchedAt,
      verified: true,
    });
  }
  return out;
}

// --- CAPK (Bakersfield) adapter — WP Go Maps markers, food sites only ---
function fromCapk(raw, fetchedAt) {
  const out = [];
  for (const m of raw ?? []) {
    // CAPK's map mixes all programs (WIC, Head Start, offices); keep only
    // general food distribution sites. WIC is excluded: it serves only
    // pregnant women / young children, not the general public.
    if (!/food ?bank|pantry|food distribution|mobile food/i.test(m.title ?? ""))
      continue;
    const lat = parseFloat(m.lat);
    const lng = parseFloat(m.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      id: `capk-${m.id}`,
      name: `CAPK ${m.title}`.trim(),
      type: "food_pantry",
      description:
        "Community Action Partnership of Kern food bank site. CAPK also runs mobile food distributions around Kern County — see their calendar.",
      address: (m.address ?? "").replace(/, USA$/, "") || null,
      lat,
      lng,
      metro: nearestMetro(lat, lng),
      phone: "661-398-4520",
      website: "https://www.capk.org/food-bank/",
      hoursRaw: null,
      services: { givesFood: true, servesMeals: false, acceptsDonations: "unverified" },
      acceptedItems: null,
      eligibility: "Open to the community — call ahead to confirm.",
      languages: null,
      dietaryOptions: null,
      wheelchair: null,
      source: "capk",
      sourceUrl: "https://www.capk.org/food-bank/",
      lastUpdated: fetchedAt,
      verified: true,
    });
  }
  return out;
}

// --- dedupe: same-ish name within 150 m => keep the richer record ---
function richness(loc) {
  return [loc.address, loc.phone, loc.website, loc.hoursRaw].filter(Boolean)
    .length;
}
function normName(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function dedupe(locs) {
  const kept = [];
  for (const loc of locs) {
    const dup = kept.find(
      (k) =>
        normName(k.name) === normName(loc.name) &&
        haversineKm(k.lat, k.lng, loc.lat, loc.lng) < 0.15
    );
    if (!dup) kept.push(loc);
    else if (richness(loc) > richness(dup)) kept[kept.indexOf(dup)] = loc;
  }
  return kept;
}

// --- main ---
const fetchedAt = new Date().toISOString().slice(0, 10);
const rawOsm = JSON.parse(readFileSync(join(root, "data", "raw-osm.json")));
let locations = fromOsm(rawOsm, fetchedAt);
try {
  const rawSfm = JSON.parse(
    readFileSync(join(root, "data", "raw-sfmarin.json"))
  );
  locations = locations.concat(fromSfMarin(rawSfm, fetchedAt));
} catch {
  console.warn("no raw-sfmarin.json — skipping SF-Marin source");
}

const STOREPOINT_SOURCES = [
  {
    file: "raw-feedingsd.json",
    sourceId: "feeding-san-diego",
    operator: "Feeding San Diego",
    sourceUrl: "https://feedingsandiego.org/find-food/",
  },
  {
    file: "raw-lafb.json",
    sourceId: "la-regional-food-bank",
    operator: "the Los Angeles Regional Food Bank",
    sourceUrl: "https://www.lafoodbank.org/find-food/pantry-locator/",
  },
];
for (const src of STOREPOINT_SOURCES) {
  try {
    const raw = JSON.parse(readFileSync(join(root, "data", src.file)));
    locations = locations.concat(fromStorepoint(raw, fetchedAt, src));
  } catch {
    console.warn(`no ${src.file} — skipping ${src.operator}`);
  }
}

try {
  const rawSac = JSON.parse(
    readFileSync(join(root, "data", "raw-sacramento.json"))
  );
  locations = locations.concat(
    fromVivery(rawSac, fetchedAt, {
      sourceId: "sacramento-food-bank",
      operator: "Sacramento Food Bank & Family Services",
      sourceUrl: "https://sacramentofoodbank.org/find-food",
    })
  );
} catch {
  console.warn("no raw-sacramento.json — skipping Sacramento source");
}

try {
  const rawShfb = JSON.parse(readFileSync(join(root, "data", "raw-shfb.json")));
  locations = locations.concat(fromShfb(rawShfb, fetchedAt));
} catch {
  console.warn("no raw-shfb.json — skipping Second Harvest SV source");
}
try {
  const rawAccfb = JSON.parse(
    readFileSync(join(root, "data", "raw-accfb.json"))
  );
  locations = locations.concat(fromAccfb(rawAccfb, fetchedAt));
} catch {
  console.warn("no raw-accfb.json — skipping ACCFB source");
}
try {
  const rawCcfb = readFileSync(join(root, "data", "raw-ccfb.xml"), "utf8");
  locations = locations.concat(fromCcfb(rawCcfb, fetchedAt));
} catch {
  console.warn("no raw-ccfb.xml — skipping Central CA Food Bank source");
}
try {
  const rawCapk = JSON.parse(readFileSync(join(root, "data", "raw-capk.json")));
  locations = locations.concat(fromCapk(rawCapk, fetchedAt));
} catch {
  console.warn("no raw-capk.json — skipping CAPK source");
}

// USDA Summer Meals sites are for kids/teens 18-and-under only. This app
// serves people of ALL ages (homeless adults included), so the source is
// DISABLED. Flip to true if a family/kids mode is ever added.
const INCLUDE_KIDS_ONLY_SITES = false;
if (INCLUDE_KIDS_ONLY_SITES) {
  try {
    const rawUsda = JSON.parse(
      readFileSync(join(root, "data", "raw-usda.json"))
    );
    locations = locations.concat(fromUsda(rawUsda, fetchedAt));
  } catch {
    console.warn("no raw-usda.json — skipping USDA source");
  }
}
const before = locations.length;
locations = dedupe(locations);

const stats = {
  total: locations.length,
  dupesRemoved: before - locations.length,
  byMetro: {},
  byType: {},
  withHours: locations.filter((l) => l.hoursRaw).length,
  withPhone: locations.filter((l) => l.phone).length,
  withAddress: locations.filter((l) => l.address).length,
};
for (const l of locations) {
  stats.byMetro[l.metro ?? "outside-metros"] =
    (stats.byMetro[l.metro ?? "outside-metros"] ?? 0) + 1;
  stats.byType[l.type] = (stats.byType[l.type] ?? 0) + 1;
}

writeFileSync(
  join(root, "data", "locations.json"),
  JSON.stringify({ generatedAt: fetchedAt, metros: METROS, locations }, null, 1)
);
console.log(JSON.stringify(stats, null, 2));
