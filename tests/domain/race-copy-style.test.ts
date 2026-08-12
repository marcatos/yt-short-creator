import { describe, expect, it } from "vitest";

import {
  BRAND_TTS_INSTRUCTIONS,
  RACE_METADATA_STYLE,
  RACE_VOICE_OVER_STYLE,
  ttsInstructionsFor,
} from "@/src/domain/race-copy-style";

describe("race copy style", () => {
  it("locks first-person race narrative for VO and metadata", () => {
    expect(RACE_VOICE_OVER_STYLE).toMatch(/first person/i);
    expect(RACE_VOICE_OVER_STYLE).toMatch(/Do not speak chapter timestamps/i);
    expect(RACE_VOICE_OVER_STYLE).toMatch(/Do not repeatedly say the driver/i);
    expect(RACE_METADATA_STYLE).toMatch(/rig\/setup/i);
    expect(RACE_METADATA_STYLE).toMatch(/Do not start titles with/i);
    expect(BRAND_TTS_INSTRUCTIONS).toMatch(/Young adult male/i);
  });

  it("uses a younger brisker Italian delivery than English", () => {
    const it = ttsInstructionsFor("it");
    const en = ttsInstructionsFor("en");
    expect(it).toMatch(/mid-20s/i);
    expect(it).toMatch(/Brisk/i);
    expect(it).toMatch(/NOT a mature woman/i);
    expect(en).toMatch(/Young adult male/i);
    expect(it).not.toBe(en);
  });
});
