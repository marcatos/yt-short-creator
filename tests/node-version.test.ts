import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

test("runtime Node major matches .nvmrc", () => {
  const required = readFileSync(".nvmrc", "utf8").trim().replace(/^v/, "").split(".")[0];
  const actual = process.versions.node.split(".")[0];
  expect(actual).toBe(required);
});
