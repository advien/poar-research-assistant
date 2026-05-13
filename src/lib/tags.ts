/**
 * POAR controlled tag vocabulary.
 *
 * Spans prosthetics, orthotics, assistive & rehabilitation robotics,
 * neurorehabilitation, biomechanics, sensors / control, clinical context,
 * and methodology.
 *
 * The vocabulary is structured (not just a flat list) so we can:
 *   - render it grouped by category in the UI,
 *   - prompt Claude with category-organised lists during metadata extraction,
 *   - normalise common acronyms / synonyms ("BCI" -> "brain-computer-interface"),
 *   - extend with new domains without touching any consumer code.
 *
 * Backward compatibility: the flat `PO_TAGS` export is preserved as the
 * authoritative allow-list of canonical slugs, so any existing import keeps
 * working.
 */

export type TagCategory =
  | "prosthetics"
  | "orthotics"
  | "robotics"
  | "neurorehabilitation"
  | "biomechanics"
  | "sensors_control"
  | "clinical_context"
  | "methods";

export const CATEGORY_ORDER: readonly TagCategory[] = [
  "prosthetics",
  "orthotics",
  "robotics",
  "neurorehabilitation",
  "biomechanics",
  "sensors_control",
  "clinical_context",
  "methods",
] as const;

export const CATEGORY_LABELS: Record<TagCategory, string> = {
  prosthetics: "Prosthetics",
  orthotics: "Orthotics",
  robotics: "Robotics",
  neurorehabilitation: "Neurorehabilitation",
  biomechanics: "Biomechanics",
  sensors_control: "Sensors & Control",
  clinical_context: "Clinical Context",
  methods: "Methods",
};

export type TagDef = {
  /** Canonical lower-case hyphenated slug. The only form ever stored. */
  slug: string;
  category: TagCategory;
  /** Optional pretty label. Defaults to a humanised slug. */
  label?: string;
  /** Common acronyms / synonyms / spellings that should normalise to `slug`. */
  aliases?: readonly string[];
};

// =============================================================================
// VOCABULARY
// Add new entries here; everything else is derived.
// =============================================================================

export const TAG_VOCABULARY: readonly TagDef[] = [
  // ---------- Prosthetics ----------
  { slug: "transtibial",            category: "prosthetics", aliases: ["tt", "below-knee", "bk-amputation"] },
  { slug: "transfemoral",           category: "prosthetics", aliases: ["tf", "above-knee", "ak-amputation"] },
  { slug: "transhumeral",           category: "prosthetics" },
  { slug: "transradial",            category: "prosthetics" },
  { slug: "partial-foot",           category: "prosthetics" },
  { slug: "hip-disarticulation",    category: "prosthetics" },
  { slug: "socket",                 category: "prosthetics" },
  { slug: "liner",                  category: "prosthetics" },
  { slug: "suspension",             category: "prosthetics" },
  { slug: "alignment",              category: "prosthetics" },
  { slug: "sach-foot",              category: "prosthetics", label: "SACH foot" },
  { slug: "esr-foot",               category: "prosthetics", label: "ESR foot" },
  { slug: "microprocessor-knee",    category: "prosthetics" },
  { slug: "myoelectric",            category: "prosthetics" },
  { slug: "body-powered",           category: "prosthetics" },
  { slug: "osseointegration",       category: "prosthetics" },
  { slug: "powered-prosthesis",     category: "prosthetics" },
  { slug: "powered-ankle",          category: "prosthetics" },
  { slug: "powered-knee",           category: "prosthetics" },
  { slug: "multi-articulating-hand", category: "prosthetics" },
  { slug: "prosthetic-control",     category: "prosthetics" },
  { slug: "neuroprosthetics",       category: "prosthetics" },

  // ---------- Orthotics ----------
  { slug: "afo",                    category: "orthotics", label: "AFO", aliases: ["ankle-foot-orthosis"] },
  { slug: "kafo",                   category: "orthotics", label: "KAFO", aliases: ["knee-ankle-foot-orthosis"] },
  { slug: "tlso",                   category: "orthotics", label: "TLSO", aliases: ["thoraco-lumbo-sacral-orthosis"] },
  { slug: "scoliosis-brace",        category: "orthotics" },
  { slug: "wrist-hand-orthosis",    category: "orthotics", aliases: ["who"] },
  { slug: "spinal-orthosis",        category: "orthotics" },

  // ---------- Robotics ----------
  { slug: "assistive-robotics",     category: "robotics", aliases: ["assistive-robot"] },
  { slug: "rehabilitation-robotics", category: "robotics", aliases: ["rehabilitation-robot", "rehab-robotics", "rehab-robot"] },
  { slug: "wearable-robotics",      category: "robotics", aliases: ["wearable-robot"] },
  { slug: "soft-robotics",          category: "robotics" },
  { slug: "exoskeleton",            category: "robotics" },
  { slug: "lower-limb-exoskeleton", category: "robotics" },
  { slug: "upper-limb-exoskeleton", category: "robotics" },
  { slug: "soft-exosuit",           category: "robotics", aliases: ["exosuit"] },
  { slug: "end-effector-robot",     category: "robotics" },
  { slug: "robotic-gait-training",  category: "robotics" },
  { slug: "robotic-rehabilitation", category: "robotics" },
  { slug: "robotic-grasping",       category: "robotics" },
  { slug: "robot-assisted-therapy", category: "robotics" },
  { slug: "robot-assisted-gait",    category: "robotics" },
  { slug: "robot-assisted-upper-limb", category: "robotics" },
  { slug: "human-robot-interaction", category: "robotics", aliases: ["hri"] },
  { slug: "human-machine-interface", category: "robotics", aliases: ["hmi"] },
  { slug: "teleoperation",          category: "robotics" },
  { slug: "shared-control",         category: "robotics" },
  { slug: "intent-detection",       category: "robotics" },
  { slug: "biomechatronics",        category: "robotics" },
  { slug: "assistive-devices",      category: "robotics" },
  { slug: "rehabilitation-engineering", category: "robotics" },
  { slug: "tele-rehabilitation",    category: "robotics", aliases: ["telerehab", "telerehabilitation"] },

  // ---------- Neurorehabilitation ----------
  { slug: "neurorehabilitation",    category: "neurorehabilitation", aliases: ["neuro-rehab", "neuro-rehabilitation"] },
  { slug: "stroke-rehabilitation",  category: "neurorehabilitation" },
  { slug: "stroke",                 category: "neurorehabilitation" },
  { slug: "spinal-cord-injury",     category: "neurorehabilitation", aliases: ["sci"] },
  { slug: "cerebral-palsy",         category: "neurorehabilitation", aliases: ["cp"] },
  { slug: "brain-computer-interface", category: "neurorehabilitation", aliases: ["bci", "bmi", "brain-machine-interface"] },
  { slug: "functional-electrical-stimulation", category: "neurorehabilitation", aliases: ["fes"] },
  { slug: "motor-learning",         category: "neurorehabilitation" },
  { slug: "gait-rehabilitation",    category: "neurorehabilitation" },
  { slug: "balance-training",       category: "neurorehabilitation" },

  // ---------- Biomechanics ----------
  { slug: "lower-limb",             category: "biomechanics" },
  { slug: "upper-limb",             category: "biomechanics" },
  { slug: "biomechanics",           category: "biomechanics" },
  { slug: "gait",                   category: "biomechanics" },
  { slug: "locomotion",             category: "biomechanics" },
  { slug: "kinematics",             category: "biomechanics" },
  { slug: "kinematic-analysis",     category: "biomechanics" },
  { slug: "kinetics",               category: "biomechanics" },
  { slug: "movement-analysis",      category: "biomechanics" },
  { slug: "motion-capture",         category: "biomechanics", aliases: ["mocap"] },
  { slug: "dynamic-stability",      category: "biomechanics" },
  { slug: "balance",                category: "biomechanics" },
  { slug: "postural-control",       category: "biomechanics" },
  { slug: "energy-cost",            category: "biomechanics" },
  { slug: "metabolic-cost",         category: "biomechanics" },

  // ---------- Sensors & Control ----------
  { slug: "emg",                    category: "sensors_control", label: "EMG", aliases: ["electromyography"] },
  { slug: "semg",                   category: "sensors_control", label: "sEMG", aliases: ["surface-emg"] },
  { slug: "eeg",                    category: "sensors_control", label: "EEG", aliases: ["electroencephalography"] },
  { slug: "imu",                    category: "sensors_control", label: "IMU", aliases: ["inertial-measurement-unit"] },
  { slug: "imu-fusion",             category: "sensors_control" },
  { slug: "sensor-fusion",          category: "sensors_control" },
  { slug: "wearable-sensors",       category: "sensors_control" },
  { slug: "robotic-sensing",        category: "sensors_control" },
  { slug: "force-torque-sensor",    category: "sensors_control" },
  { slug: "force-feedback",         category: "sensors_control" },
  { slug: "haptics",                category: "sensors_control" },
  { slug: "haptic-feedback",        category: "sensors_control" },
  { slug: "series-elastic-actuator", category: "sensors_control", label: "SEA", aliases: ["sea"] },
  { slug: "impedance-control",      category: "sensors_control" },
  { slug: "admittance-control",     category: "sensors_control" },
  { slug: "adaptive-control",       category: "sensors_control" },
  { slug: "model-predictive-control", category: "sensors_control", label: "MPC", aliases: ["mpc"] },
  { slug: "reinforcement-learning", category: "sensors_control", label: "RL", aliases: ["rl"] },

  // ---------- Clinical Context ----------
  { slug: "pediatric",              category: "clinical_context" },
  { slug: "geriatric",              category: "clinical_context" },
  { slug: "diabetic",               category: "clinical_context" },
  { slug: "vascular",               category: "clinical_context" },
  { slug: "trauma",                 category: "clinical_context" },
  { slug: "congenital",             category: "clinical_context" },
  { slug: "outcome-measures",       category: "clinical_context" },
  { slug: "patient-reported",       category: "clinical_context" },
  { slug: "user-experience",        category: "clinical_context" },

  // ---------- Methods ----------
  { slug: "rct",                    category: "methods", label: "RCT", aliases: ["randomized-controlled-trial"] },
  { slug: "case-series",            category: "methods" },
  { slug: "review",                 category: "methods" },
  { slug: "systematic-review",      category: "methods" },
  { slug: "finite-element",         category: "methods", aliases: ["fea", "fem"] },
  { slug: "machine-learning",       category: "methods", aliases: ["ml"] },
  { slug: "deep-learning",          category: "methods", aliases: ["dl"] },
  { slug: "simulation",             category: "methods" },
  { slug: "usability-study",        category: "methods" },
] as const;

// =============================================================================
// DERIVED LOOKUPS
// =============================================================================

/** Flat allow-list of canonical slugs. Stable export name for back-compat. */
export const PO_TAGS: readonly string[] = TAG_VOCABULARY.map((t) => t.slug);

/** Same set as a Set for O(1) membership checks. */
export const PO_TAG_SET: ReadonlySet<string> = new Set(PO_TAGS);

export type POTag = (typeof TAG_VOCABULARY)[number]["slug"];

/** Tags grouped by category, in CATEGORY_ORDER. */
export const TAGS_BY_CATEGORY: Record<TagCategory, TagDef[]> = (() => {
  const out = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, [] as TagDef[]])) as Record<
    TagCategory,
    TagDef[]
  >;
  for (const t of TAG_VOCABULARY) out[t.category].push(t);
  return out;
})();

// Build a normalisation table at module load. Maps every accepted form
// (slug, alias, raw acronym, common spelling variants) to its canonical slug.
const NORMALISE_TABLE: Map<string, string> = (() => {
  const m = new Map<string, string>();
  const register = (key: string, slug: string) => {
    const k = key.trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");
    if (k && !m.has(k)) m.set(k, slug);
  };
  for (const t of TAG_VOCABULARY) {
    register(t.slug, t.slug);
    if (t.label) register(t.label, t.slug);
    for (const a of t.aliases ?? []) register(a, t.slug);
    // Tolerate the un-hyphenated form too: "imu fusion" / "imufusion".
    register(t.slug.replace(/-/g, ""), t.slug);
  }
  return m;
})();

/** Pretty label for display. Falls back to the slug itself. */
export function labelFor(slug: string): string {
  const def = TAG_VOCABULARY.find((t) => t.slug === slug);
  return def?.label ?? slug;
}

/** Returns the canonical slug for any accepted form, or null if unknown. */
export function normalizeTag(input: string): POTag | null {
  if (!input) return null;
  const k = input.trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");
  return (NORMALISE_TABLE.get(k) ?? null) as POTag | null;
}

/** Apply normalizeTag, drop unknowns, dedupe (preserving first-occurrence order). */
export function dedupeAndNormalizeTags(input: readonly string[]): POTag[] {
  const out: POTag[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const slug = normalizeTag(raw);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/** Group an arbitrary tag list by category for UI rendering.
 *  Unknown tags (legacy or user-typed) bucket into "_unknown". */
export function groupTagsByCategory(tags: readonly string[]): {
  groups: { category: TagCategory; tags: string[] }[];
  unknown: string[];
} {
  const buckets = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, [] as string[]])) as Record<
    TagCategory,
    string[]
  >;
  const unknown: string[] = [];
  for (const t of tags) {
    const def = TAG_VOCABULARY.find((d) => d.slug === t);
    if (def) buckets[def.category].push(t);
    else unknown.push(t);
  }
  const groups = CATEGORY_ORDER.filter((c) => buckets[c].length > 0).map((c) => ({
    category: c,
    tags: buckets[c],
  }));
  return { groups, unknown };
}
