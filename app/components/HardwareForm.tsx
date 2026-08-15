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
      {HARDWARE_GROUPS.map((group) => (
        <section className="settings-section" key={group.id}>
          <div className="settings-section-header">
            <h2>{group.heading.en}</h2>
            {group.heading.it !== group.heading.en ? (
              <p>{group.heading.it}</p>
            ) : (
              <p>Fields included in the YouTube description hardware block.</p>
            )}
          </div>
          <fieldset className="hardware-group">
            <legend className="visually-hidden">{group.heading.en}</legend>
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
        </section>
      ))}

      <section className="settings-section">
        <div className="settings-section-header">
          <h2>Description preview</h2>
          <p>
            This block is appended to every full-video description. Leave a
            field blank to omit it. The LLM never invents these specs.
          </p>
        </div>
        <h3 className="hardware-preview-heading">Italian</h3>
        <pre className="hardware-preview">{previewIt || "—"}</pre>
        <h3 className="hardware-preview-heading">English</h3>
        <pre className="hardware-preview">{previewEn || "—"}</pre>
      </section>

      <div className="settings-save-bar">
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
      </div>
    </div>
  );
}
