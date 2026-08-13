/** Compact Italian-style datetime for list rows: `13/08 14:32` */
export function formatListDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${minutes}`;
}

/** Compact count: 12400 → `12.4k` */
export function formatCompactCount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) {
    const k = value / 1000;
    return `${k >= 10 ? Math.round(k) : Number(k.toFixed(1))}k`;
  }
  const m = value / 1_000_000;
  return `${m >= 10 ? Math.round(m) : Number(m.toFixed(1))}M`;
}
