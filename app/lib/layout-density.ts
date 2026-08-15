export const LAYOUT_DENSITY_KEY = "ui.layoutDensity";
export const LAYOUT_DENSITY_VALUES = ["normal", "compact"] as const;

export type LayoutDensity = (typeof LAYOUT_DENSITY_VALUES)[number];

export function parseLayoutDensity(value: string | null | undefined): LayoutDensity {
  return value === "compact" ? "compact" : "normal";
}

export function applyLayoutDensity(density: LayoutDensity): void {
  if (typeof document === "undefined") return;
  if (density === "compact") {
    document.documentElement.setAttribute("data-layout", "compact");
    return;
  }
  document.documentElement.removeAttribute("data-layout");
}

export const LAYOUT_DENSITY_BOOTSTRAP = `(function(){try{if(localStorage.getItem("${LAYOUT_DENSITY_KEY}")==="compact")document.documentElement.setAttribute("data-layout","compact");}catch(e){}})();`;
