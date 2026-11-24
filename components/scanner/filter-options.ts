import type { Pattern, Timeframe, ZoneSide } from "@/lib/scanner/types";
import type { ZoneFilters } from "@/hooks/use-zones";

/** Shared scanner filter options — used by the Overview panel and /scanner. */
export const TIMEFRAMES: Array<Timeframe | "ALL"> = [
  "ALL",
  "1H",
  "4H",
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "1Y",
];

/** Compact identifiers shown inside dense chip rows. */
export const TF_LABELS: Record<string, string> = {
  ALL: "All",
  "1H": "1H",
  "4H": "4H",
  "1D": "1D",
  "1W": "1W",
  "1M": "1M",
  "3M": "3M",
  "6M": "6M",
  "1Y": "1Y",
};

/** Human labels used for tooltips and active-filter chips. */
export const TF_TITLES: Record<string, string> = {
  ALL: "All timeframes",
  "1H": "Hourly",
  "4H": "4 hour",
  "1D": "Daily",
  "1W": "Weekly",
  "1M": "Monthly",
  "3M": "Quarterly",
  "6M": "Half-yearly",
  "1Y": "Yearly",
};

export const SIDES: Array<ZoneSide | "ALL"> = ["ALL", "DEMAND", "SUPPLY"];
export const SIDE_LABELS: Record<string, string> = {
  ALL: "Both",
  DEMAND: "Demand",
  SUPPLY: "Supply",
};

export const PATTERNS: Array<Pattern | "ALL"> = ["ALL", "DBR", "RBR", "RBD", "DBD"];

export const LIFECYCLES = [
  "ALL",
  "CONFIRMED_FRESH",
  "TOUCHED_ONCE",
  "RETESTED",
  "BROKEN",
] as const;

export const LIFECYCLE_LABELS: Record<string, string> = {
  ALL: "All",
  CONFIRMED_FRESH: "Fresh",
  TOUCHED_ONCE: "Tested",
  RETESTED: "Retested",
  BROKEN: "Broken",
};

export const SORT_OPTIONS: Array<{
  value: NonNullable<ZoneFilters["sort"]>;
  label: string;
}> = [
  { value: "composite_score", label: "Composite Score" },
  { value: "score", label: "Formation Score" },
  { value: "distance_pct", label: "Distance %" },
  { value: "formation_ts", label: "Formation Date" },
];

export const COMPOSITE_UNAVAILABLE_REASON =
  "Unavailable until composite scores are populated.";
