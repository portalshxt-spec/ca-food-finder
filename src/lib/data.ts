import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LocationsFile } from "./types";

let cached: LocationsFile | null = null;

/** Server-side loader for the normalized locations dataset. */
export function getLocationsFile(): LocationsFile {
  if (!cached) {
    cached = JSON.parse(
      readFileSync(join(process.cwd(), "data", "locations.json"), "utf8")
    ) as LocationsFile;
  }
  return cached;
}
