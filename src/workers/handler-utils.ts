export function requireStringPayload(
  payload: Record<string, unknown>,
  key: string,
): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Job payload missing required string field: ${key}`);
  }
  return value;
}

export function requireNumberPayload(
  payload: Record<string, unknown>,
  key: string,
): number {
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Job payload missing required number field: ${key}`);
  }
  return value;
}
