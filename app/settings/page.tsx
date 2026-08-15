import { PageHeader } from "@/app/components/PageHeader";
import { SettingsForm } from "@/app/components/SettingsForm";
import { getContainer } from "@/src/lib/container";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getContainer().getSettings();
  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="Local control plane"
        title="Settings"
        description="Brand path, encoder, voice-over, captions, and masked secret status."
      />
      <SettingsForm initial={settings} />
    </main>
  );
}
