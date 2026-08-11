import { SettingsForm } from "@/app/components/SettingsForm";
import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getContainer().getSettings();
  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Local control plane</p>
          <h1>Settings</h1>
        </div>
      </header>
      <SettingsForm initial={settings} />
    </main>
  );
}
