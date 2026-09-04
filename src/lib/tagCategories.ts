/**
 * A tag still belongs to nothing but the piece's free-form `tags` array — this is purely a display
 * grouping for the admin tag pickers and the public tag cloud, not a schema change. Hardcoded
 * rather than an editable admin UI: the vocabulary is small and grows rarely, and an uncategorized
 * tag (a brand-new one, or anything not worth categorizing) just falls into "other" instead of
 * breaking anything — nothing needs to be edited here for a new tag to work, only for it to be
 * grouped nicely.
 */
export interface TagCategory {
  name: string;
  tags: string[];
}

export const TAG_CATEGORIES: TagCategory[] = [
  {
    name: "Medium",
    tags: ["acrylic", "gouache", "ink", "oil", "pencil", "watercolor"],
  },
  { name: "Type", tags: ["painting", "sketchbook page"] },
  {
    name: "Trip/era",
    tags: [
      "2023 india trip",
      "2026 acadia trip",
      "2026 sierra trip",
      "2026 utah trip",
      "2026 whidbey island workshop",
      "first india trip",
      "first marks",
    ],
  },
  {
    name: "Place",
    tags: [
      "brooklyn",
      "california",
      "england",
      "florida",
      "manhattan",
      "mexico",
      "minnesota",
      "new england",
      "panama",
      "queens",
      "utah",
    ],
  },
  {
    name: "Institution",
    tags: ["museum", "national park", "world heritage site", "zoo"],
  },
  { name: "Season", tags: ["fall", "summer", "winter"] },
  { name: "Light", tags: ["evening", "morning", "overcast"] },
  {
    name: "Process",
    tags: [
      "abstract",
      "from imagination",
      "not my photo",
      "painted from life",
      "painted from photo",
      "painted from my own sketch",
    ],
  },
  {
    name: "Subject",
    tags: [
      "animals",
      "architecture",
      "beach",
      "bird",
      "boat",
      "brownstones",
      "church",
      "city scene",
      "dappled light",
      "indoor scene",
      "landscape",
      "meadow",
      "mountains",
      "park",
      "people",
      "portrait",
      "rocks",
      "sidewalk",
      "skeleton",
      "statue",
      "water",
    ],
  },
];

const TAG_TO_CATEGORY = new Map<string, string>();
for (const category of TAG_CATEGORIES) {
  for (const tag of category.tags) TAG_TO_CATEGORY.set(tag, category.name);
}

export function categoryForTag(tag: string): string | undefined {
  return TAG_TO_CATEGORY.get(tag);
}
