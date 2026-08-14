/**
 * Static sim-rig hardware block for YouTube descriptions.
 * Never generate this via LLM — load from config and render per language.
 */

export type HardwareConfig = {
  cpu: string;
  gpu: string;
  ram: string;
  rig: string;
  wheelbase: string;
  wheel: string;
  pedals: string;
  seat: string;
  buttonBox: string;
  flagIndicator: string;
  monitors: string;
  resolution: string;
};

export type HardwareField = keyof HardwareConfig;

export type HardwareGroupId = "pc" | "simRig" | "monitors";

export type HardwareGroup = {
  id: HardwareGroupId;
  heading: Record<HardwareLanguage, string>;
  fields: HardwareField[];
};

/** Default Marcato / S.Marcato 42 Racing desk — sourced from video `_0H55Bo383k`. */
export const DEFAULT_HARDWARE: HardwareConfig = {
  cpu: "AMD Ryzen 7 9800X3D",
  gpu: "NVIDIA GeForce RTX 4070 12GB",
  ram: "32GB DDR5 6000MHz",
  rig: "TREQ One",
  wheelbase: "VRS DirectForce Pro 20Nm",
  wheel: "Formula VRS DirectForce Pro",
  pedals: "SimRuito PD-1 Load Cell",
  seat: "Next Level Racing ERS3",
  buttonBox: "PXN CB1",
  flagIndicator: "Sector 17 LED iFlag",
  monitors: 'Triple Samsung Odyssey G5 32"',
  resolution: "7680×1440",
};

export type HardwareLanguage = "it" | "en";

export const HARDWARE_GROUPS: HardwareGroup[] = [
  {
    id: "pc",
    heading: { it: "PC", en: "PC" },
    fields: ["cpu", "gpu", "ram"],
  },
  {
    id: "simRig",
    heading: { it: "SIM RIG", en: "SIM RIG" },
    fields: [
      "rig",
      "wheelbase",
      "wheel",
      "pedals",
      "seat",
      "buttonBox",
      "flagIndicator",
    ],
  },
  {
    id: "monitors",
    heading: { it: "MONITOR", en: "MONITORS" },
    fields: ["monitors", "resolution"],
  },
];

const LABELS: Record<
  HardwareLanguage,
  {
    heading: string;
    fields: Record<HardwareField, string>;
  }
> = {
  it: {
    heading: "🛠️ LA MIA POSTAZIONE SIM RACING",
    fields: {
      cpu: "CPU",
      gpu: "GPU",
      ram: "RAM",
      rig: "Cockpit",
      wheelbase: "Base volante",
      wheel: "Volante",
      pedals: "Pedaliera",
      seat: "Sedile",
      buttonBox: "Button box",
      flagIndicator: "Indicatore bandiere",
      monitors: "Monitor",
      resolution: "Risoluzione",
    },
  },
  en: {
    heading: "🛠️ MY SIM RACING SETUP",
    fields: {
      cpu: "CPU",
      gpu: "GPU",
      ram: "RAM",
      rig: "Rig",
      wheelbase: "Wheelbase",
      wheel: "Wheel",
      pedals: "Pedals",
      seat: "Seat",
      buttonBox: "Button box",
      flagIndicator: "Flag indicator",
      monitors: "Monitors",
      resolution: "Resolution",
    },
  },
};

export function hardwareFieldLabel(
  field: HardwareField,
  language: HardwareLanguage,
): string {
  return LABELS[language].fields[field];
}

function pickField(
  value: string | undefined,
  fallback: string,
): string {
  return value === undefined ? fallback : value.trim();
}

export function renderHardwareBlock(
  hardware: HardwareConfig,
  language: HardwareLanguage,
): string {
  const labels = LABELS[language];
  const groups = HARDWARE_GROUPS.map((group) => {
    const lines = group.fields
      .filter((key) => hardware[key]?.trim())
      .map((key) => `• ${labels.fields[key]}: ${hardware[key].trim()}`);
    if (lines.length === 0) return "";
    return [group.heading[language], ...lines].join("\n");
  }).filter((block) => block.length > 0);
  if (groups.length === 0) return "";
  return [labels.heading, ...groups].join("\n\n");
}

export function mergeHardware(
  partial: Partial<HardwareConfig> | null | undefined,
  defaults: HardwareConfig = DEFAULT_HARDWARE,
): HardwareConfig {
  const merged = { ...defaults };
  for (const group of HARDWARE_GROUPS) {
    for (const field of group.fields) {
      merged[field] = pickField(partial?.[field], defaults[field]);
    }
  }
  return merged;
}
