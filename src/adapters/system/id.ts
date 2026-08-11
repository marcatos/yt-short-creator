import { randomUUID } from "node:crypto";

import type { IdPort } from "@/src/ports/id";

export class UuidIdPort implements IdPort {
  generate(): string {
    return randomUUID();
  }
}
