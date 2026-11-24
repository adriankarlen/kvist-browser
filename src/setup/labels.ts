import type { InputMode } from "../shared/config";
import type { Region } from "../shared/layout";
import type { Density } from "../shared/setup";
import type { Step } from "./setup.program";

export interface Choice<V> {
  readonly value: V;
  readonly label: string;
  readonly hint: string;
}

export const STEP_TITLES: Readonly<Record<Step, string>> = {
  recipe: "Pick a look",
  input: "How do you drive it?",
  urlbar: "Where does the URL bar go?",
  tabs: "Tabs and spacing",
  search: "Search engine",
  done: "Ready",
};

export const INPUT_MODES: ReadonlyArray<Choice<InputMode>> = [
  {
    value: "standard",
    label: "Standard",
    hint: "The shortcuts every other browser uses: Ctrl/Cmd+L, T, W, F.",
  },
  {
    value: "vim",
    label: "Vim",
    hint: "Modal keys: j/k to scroll, f to follow links, o to open, : for commands.",
  },
];

const URL_BAR: Partial<Record<Region, Choice<Region>>> = {
  top: { value: "top", label: "Top", hint: "A bar above the page, always there." },
  bottom: { value: "bottom", label: "Bottom", hint: "A bar below the page, always there." },
  floating: {
    value: "floating",
    label: "Command palette",
    hint: "Hidden until summoned, then a floating box over the page.",
  },
};

const capitalized = (region: Region): string => region[0]!.toUpperCase() + region.slice(1);

/** Only the regions this Kvist supports are offered, so a new one shows up by itself. */
export const urlBarChoices = (regions: ReadonlyArray<Region>): ReadonlyArray<Choice<Region>> =>
  regions.map(
    (region) => URL_BAR[region] ?? { value: region, label: capitalized(region), hint: "" },
  );

const EDGE_HINTS: Partial<Record<Region, string>> = {
  top: "A row across the top.",
  bottom: "A row across the bottom.",
  left: "A column down the left side.",
  right: "A column down the right side.",
};

export const tabChoices = (regions: ReadonlyArray<Region>): ReadonlyArray<Choice<Region>> =>
  regions.map((region) => ({
    value: region,
    label: capitalized(region),
    hint: EDGE_HINTS[region] ?? "",
  }));

export const DENSITY_CHOICES: ReadonlyArray<Choice<Density>> = [
  { value: "compact", label: "Compact", hint: "Tighter rows, more page." },
  { value: "normal", label: "Normal", hint: "The recipe's own spacing." },
  { value: "comfortable", label: "Comfortable", hint: "Roomier rows and padding." },
];

export const regionLabel = (region: Region): string =>
  URL_BAR[region]?.label ?? capitalized(region);
