import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getContainer } from "@/src/lib/container";

const hardwareSchema = z.object({
  cpu: z.string(),
  gpu: z.string(),
  ram: z.string(),
  rig: z.string(),
  wheelbase: z.string(),
  wheel: z.string(),
  pedals: z.string(),
  seat: z.string(),
  buttonBox: z.string(),
  flagIndicator: z.string(),
  monitors: z.string(),
  resolution: z.string(),
});

export async function GET() {
  return NextResponse.json({ hardware: await getContainer().getHardware() });
}

export async function PATCH(request: NextRequest) {
  const parsed = hardwareSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid hardware" }, { status: 400 });
  }
  try {
    const hardware = await getContainer().updateHardware(parsed.data);
    return NextResponse.json({ hardware });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Hardware update failed",
      },
      { status: 500 },
    );
  }
}
