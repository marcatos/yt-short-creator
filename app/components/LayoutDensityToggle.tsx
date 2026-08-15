"use client";

import { useEffect, useState } from "react";

import {
  applyLayoutDensity,
  LAYOUT_DENSITY_KEY,
  parseLayoutDensity,
  type LayoutDensity,
} from "@/app/lib/layout-density";

const OPTIONS: Array<{ value: LayoutDensity; label: string }> = [
  { value: "normal", label: "Normale" },
  { value: "compact", label: "Compatto" },
];

export function LayoutDensityToggle() {
  const [density, setDensity] = useState<LayoutDensity>("normal");

  useEffect(() => {
    const stored = parseLayoutDensity(
      window.localStorage.getItem(LAYOUT_DENSITY_KEY),
    );
    setDensity(stored);
    applyLayoutDensity(stored);
  }, []);

  function select(next: LayoutDensity) {
    setDensity(next);
    window.localStorage.setItem(LAYOUT_DENSITY_KEY, next);
    applyLayoutDensity(next);
  }

  return (
    <div className="layout-density" role="group" aria-label="Densità layout">
      {OPTIONS.map((option) => (
        <button
          aria-pressed={density === option.value}
          key={option.value}
          onClick={() => select(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
