import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_HARDWARE } from "@/src/domain/hardware";

const hardwareApi = vi.hoisted(() => ({
  getHardware: vi.fn(),
  updateHardware: vi.fn(),
}));

vi.mock("@/src/lib/container", () => ({
  getContainer: () => hardwareApi,
}));

import { GET, PATCH } from "@/app/api/hardware/route";

describe("hardware API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the stored postazione", async () => {
    hardwareApi.getHardware.mockResolvedValue(DEFAULT_HARDWARE);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hardware).toEqual(DEFAULT_HARDWARE);
  });

  it("saves a valid postazione", async () => {
    const next = { ...DEFAULT_HARDWARE, gpu: "RTX 4070" };
    hardwareApi.updateHardware.mockResolvedValue(next);

    const response = await PATCH(
      new Request("http://localhost/api/hardware", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }),
    );

    expect(hardwareApi.updateHardware).toHaveBeenCalledWith(next);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ hardware: next });
  });

  it("rejects an invalid payload", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/hardware", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gpu: "RTX 4070" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(hardwareApi.updateHardware).not.toHaveBeenCalled();
  });
});
