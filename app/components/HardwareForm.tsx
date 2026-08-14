"use client";

import { useMemo, useState } from "react";

import {
  HARDWARE_GROUPS,
  hardwareFieldLabel,
  renderHardwareBlock,
  type HardwareConfig,
  type HardwareField,
} from "@/src/domain/hardware";

export function HardwareForm({ initial }: { initial: HardwareConfig }) {
  const [hardware, setHardware] = useState(initial);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const previewIt = useMemo(
    () => renderHardwareBlock(hardware, "it"),
    [hardware],
  );
  const previewEn = useMemo(
    () => renderHardwareBlock(hardware, "en"),
    [hardware],
  );

  function updateField(field: HardwareField, value: string) {
    setHardware((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/hardware", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hardware),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to save setup");
      }
      setHardware(body.hardware as HardwareConfig);
      setMessage("Setup saved. Applied on the next editorial job.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Setup update failed",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="settings-grid">
      <section className="settings-card">
        <p className="eyebrow">Postazione</p>
        {HARDWARE_GROUPS.map((group) => (
          <fieldset key={group.id} className="hardware-group">
            <legend>{group.heading.en}</legend>
            {group.fields.map((field) => {
              const labelEn = hardwareFieldLabel(field, "en");
              const labelIt = hardwareFieldLabel(field, "it");
              return (
                <label key={field}>
                  {labelEn}
                  {labelIt !== labelEn ? <span>{labelIt}</span> : null}
                  <input
                    value={hardware[field]}
                    onChange={(event) =>
                      updateField(field, event.target.value)
                    }
                  />
                </label>
              );
            })}
          </fieldset>
        ))}
        <button
          className="button button-primary"
          disabled={pending}
          onClick={save}
        >
          Save setup
        </button>
        <p className="form-status" aria-live="polite">
          {pending ? "Saving…" : message}
        </p>
      </section>

      <section className="settings-card">
        <p className="eyebrow">Description preview</p>
        <h2>Italian</h2>
        <pre className="hardware-preview">{previewIt || "—"}</pre>
        <h2>English</h2>
        <pre className="hardware-preview">{previewEn || "—"}</pre>
        <p className="muted">
          This block is appended to every full-video description. Leave a field
          blank to omit it. The LLM never invents these specs.
        </p>
      </section>
    </div>
  );
}
