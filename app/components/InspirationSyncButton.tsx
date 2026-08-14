"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function InspirationSyncButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function syncNow(): Promise<void> {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/inspiration/sync", { method: "POST" });
      if (!response.ok) {
        throw new Error("Could not queue Inspiration sync");
      }
      setMessage("Sync queued");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Inspiration sync failed",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="library-generate">
      <button
        className="button button-primary"
        disabled={pending}
        onClick={syncNow}
        type="button"
      >
        {pending ? "Queueing…" : "Sync now"}
      </button>
      {message ? (
        <p aria-live="polite" className="muted library-generate-status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="job-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
