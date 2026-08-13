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
  pedals: string;
  seat: string;
  buttonBox: string;
  monitors: string;
  resolution: string;
};

/** Default Marcato / S.Marcato 42 Racing desk — edit via config/hardware.json. */
export const DEFAULT_HARDWARE: HardwareConfig = {
  cpu: "AMD Ryzen (desktop)",
  gpu: "NVIDIA GeForce RTX",
  ram: "32 GB+",
  rig: "Sim racing cockpit",
  wheelbase: "Direct drive wheelbase",
  pedals: "Load-cell pedals",
  seat: "Bucket seat",
  buttonBox: "Button box",
  monitors: "Triple / ultrawide",
  resolution: "1440p+",
};

export type HardwareLanguage = "it" | "en";

const LABELS: Record<
  HardwareLanguage,
  {
    heading: string;
    fields: Record<keyof HardwareConfig, string>;
  }
> = {
  it: {
    heading: "Setup / Hardware",
    fields: {
      cpu: "CPU",
      gpu: "GPU",
      ram: "RAM",
      rig: "Cockpit",
      wheelbase: "Base volante",
      pedals: "Pedaliera",
      seat: "Sedile",
      buttonBox: "Button box",
      monitors: "Monitor",
      resolution: "Risoluzione",
    },
  },
  en: {
    heading: "Setup / Hardware",
    fields: {
      cpu: "CPU",
      gpu: "GPU",
      ram: "RAM",
      rig: "Rig",
      wheelbase: "Wheelbase",
      pedals: "Pedals",
      seat: "Seat",
      buttonBox: "Button box",
      monitors: "Monitors",
      resolution: "Resolution",
    },
  },
};

const FIELD_ORDER: (keyof HardwareConfig)[] = [
  "cpu",
  "gpu",
  "ram",
  "rig",
  "wheelbase",
  "pedals",
  "seat",
  "buttonBox",
  "monitors",
  "resolution",
];

export function renderHardwareBlock(
  hardware: HardwareConfig,
  language: HardwareLanguage,
): string {
  const labels = LABELS[language];
  const lines = FIELD_ORDER.filter((key) => hardware[key]?.trim()).map(
    (key) => `${labels.fields[key]}: ${hardware[key].trim()}`,
  );
  if (lines.length === 0) return "";
  return [`${labels.heading}:`, ...lines].join("\n");
}

export function mergeHardware(
  partial: Partial<HardwareConfig> | null | undefined,
  defaults: HardwareConfig = DEFAULT_HARDWARE,
): HardwareConfig {
  return {
    cpu: partial?.cpu?.trim() || defaults.cpu,
    gpu: partial?.gpu?.trim() || defaults.gpu,
    ram: partial?.ram?.trim() || defaults.ram,
    rig: partial?.rig?.trim() || defaults.rig,
    wheelbase: partial?.wheelbase?.trim() || defaults.wheelbase,
    pedals: partial?.pedals?.trim() || defaults.pedals,
    seat: partial?.seat?.trim() || defaults.seat,
    buttonBox: partial?.buttonBox?.trim() || defaults.buttonBox,
    monitors: partial?.monitors?.trim() || defaults.monitors,
    resolution: partial?.resolution?.trim() || defaults.resolution,
  };
}
