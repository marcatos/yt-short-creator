import type { ClockPort } from "@/src/ports/clock";

export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}
