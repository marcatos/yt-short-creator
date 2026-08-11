import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getContainer } from "@/src/lib/container";

const settingsSchema = z.object({
  brandRoot: z.string().trim().min(1),
  logLevel: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
  defaultPrivacy: z.enum(["public", "unlisted", "private"]),
});

export async function GET() {
  return NextResponse.json({ settings: await getContainer().getSettings() });
}

export async function PATCH(request: NextRequest) {
  const parsed = settingsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
  }
  try {
    const settings = await getContainer().updateSettings(parsed.data);
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Settings update failed" },
      { status: 500 },
    );
  }
}
