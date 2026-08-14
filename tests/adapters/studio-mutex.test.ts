import { describe, expect, it } from "vitest";

import { withStudioLock } from "@/src/adapters/youtube/studio-mutex";

describe("withStudioLock", () => {
  it("serializes concurrent callers", async () => {
    const order: string[] = [];
    let startedFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      startedFirst = resolve;
    });
    let unblockFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      unblockFirst = resolve;
    });

    const first = withStudioLock(async () => {
      order.push("a-start");
      startedFirst();
      await firstGate;
      order.push("a-end");
      return 1;
    });

    await firstStarted;

    const second = withStudioLock(async () => {
      order.push("b-start");
      order.push("b-end");
      return 2;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["a-start"]);

    unblockFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("releases the lock when the critical section throws", async () => {
    await expect(
      withStudioLock(async () => {
        throw new Error("studio boom");
      }),
    ).rejects.toThrow("studio boom");

    await expect(withStudioLock(async () => "ok")).resolves.toBe("ok");
  });
});
