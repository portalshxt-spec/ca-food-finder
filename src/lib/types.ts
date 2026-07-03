export type LocationType = "food_pantry" | "meal_site" | "donation_dropoff";

export interface FoodLocation {
  id: string;
  name: string;
  type: LocationType;
  description: string | null;
  address: string | null;
  lat: number;
  lng: number;
  metro: string | null;
  phone: string | null;
  website: string | null;
  hoursRaw: string | null;
  services: {
    givesFood: boolean;
    servesMeals: boolean;
    acceptsDonations: boolean | "unverified";
  };
  acceptedItems: string[] | null;
  eligibility: string | null;
  languages: string[] | null;
  dietaryOptions: string[] | null;
  wheelchair: string | null;
  source: string;
  sourceUrl: string;
  lastUpdated: string;
  verified: boolean;
}

export interface Metro {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface LocationsFile {
  generatedAt: string;
  metros: Metro[];
  locations: FoodLocation[];
}

export type ReportIssueType =
  | "closed_permanently"
  | "wrong_hours"
  | "wrong_address"
  | "wrong_phone"
  | "other";

export interface DataReport {
  id: string;
  locationId: string;
  locationName: string;
  issueType: ReportIssueType;
  details: string;
  createdAt: string;
  status: "new" | "reviewed" | "resolved";
}

export const TYPE_LABELS: Record<LocationType, string> = {
  food_pantry: "Food Pantry",
  meal_site: "Free Meals",
  donation_dropoff: "Donation Drop-off",
};

export const ISSUE_LABELS: Record<ReportIssueType, string> = {
  closed_permanently: "Permanently closed",
  wrong_hours: "Wrong hours",
  wrong_address: "Wrong address",
  wrong_phone: "Wrong phone number",
  other: "Something else",
};
