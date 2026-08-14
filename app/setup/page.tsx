import { HardwareForm } from "@/app/components/HardwareForm";
import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const hardware = await getContainer().getHardware();
  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p className="eyebrow">YouTube descriptions</p>
          <h1>Setup</h1>
        </div>
      </header>
      <HardwareForm initial={hardware} />
    </main>
  );
}
