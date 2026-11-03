import type { OmniboxIcon, SectionId } from "@shared/omnibox/types";
import type { IconName } from "../../components/Icon.svelte";

/** The bar's semantic icons, as the desktop's Lucide names. */
const ICONS: Record<OmniboxIcon, IconName> = {
  search: "search",
  globe: "globe",
  calculator: "calculator",
  ruler: "ruler",
  clock: "clock",
  binary: "binary",
  star: "favorite",
  bookmark: "star",
  history: "history",
  settings: "settings",
  cloud: "cloud",
  archive: "archive",
  tab: "app-window",
  command: "command",
  highlighter: "highlighter",
  at: "at-sign",
};

export const iconOf = (icon: OmniboxIcon): IconName => ICONS[icon];

/** Section header icons. */
export const SECTION_ICONS: Record<SectionId, IconName> = {
  scopes: "at-sign",
  answer: "calculator",
  go: "globe",
  tabs: "app-window",
  favorites: "favorite",
  bookmarks: "star",
  history: "history",
  commands: "command",
  settings: "settings",
  remote: "cloud",
  archived: "archive",
  notes: "highlighter",
  web: "search",
};
