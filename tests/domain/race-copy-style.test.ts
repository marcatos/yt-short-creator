import { describe, expect, it } from "vitest";

import {
  BRAND_TTS_INSTRUCTIONS,
  RACE_METADATA_STYLE,
  RACE_VOICE_OVER_STYLE,
} from "@/src/domain/race-copy-style";

describe("race copy style", () => {
  it("locks first-person race narrative for VO and metadata", () => {
    expect(RACE_VOICE_OVER_STYLE).toMatch(/first person/i);
    expect(RACE_VOICE_OVER_STYLE).toMatch(/Do not speak chapter timestamps/i);
    expect(RACE_VOICE_OVER_STYLE).toMatch(/Do not repeatedly say the driver/i);
    expect(RACE_METADATA_STYLE).toMatch(/rig\/setup/i);
    expect(RACE_METADATA_STYLE).toMatch(/Do not start titles with/i);
    expect(BRAND_TTS_INSTRUCTIONS).toMatch(/First-person/);
    expect(BRAND_TTS_INSTRUCTIONS).toMatch(/Simone Marcato/);
    expect(BRAND_TTS_INSTRUCTIONS).toMatch(/not third-person/i);
  });
});
