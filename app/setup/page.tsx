import { HardwareForm } from "@/app/components/HardwareForm";
import { PageHeader } from "@/app/components/PageHeader";
import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const hardware = await getContainer().getHardware();
  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="YouTube descriptions"
        title="Setup"
        description="Desk hardware block appended to full-video descriptions (IT + EN)."
      />
      <HardwareForm initial={hardware} />
    </main>
  );
}
