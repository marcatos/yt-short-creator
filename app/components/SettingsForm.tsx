"use client";

import { useState } from "react";

type SettingsView = {
  brandRoot: string;
  logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
  defaultPrivacy: "public" | "unlisted" | "private";
  videoEncoderPreference:
    | "auto_igpu"
    | "auto_dgpu"
    | "h264_qsv"
    | "h264_nvenc"
    | "h264_amf"
    | "h264_mf"
    | "libx264";
  secrets: {
    youtubeClientSecret: string;
    llmApiKey: string;
    ttsApiKey: string;
  };
};

export function SettingsForm({ initial }: { initial: SettingsView }) {
  const [brandRoot, setBrandRoot] = useState(initial.brandRoot);
  const [logLevel, setLogLevel] = useState(initial.logLevel);
  const [defaultPrivacy, setDefaultPrivacy] = useState(initial.defaultPrivacy);
  const [videoEncoderPreference, setVideoEncoderPreference] = useState(
    initial.videoEncoderPreference ?? "auto_igpu",
  );
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandRoot,
          logLevel,
          defaultPrivacy,
          videoEncoderPreference,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to save settings");
      setMessage("Settings saved. Applied on the next render job.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Settings update failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="settings-grid">
      <section className="settings-card">
        <p className="eyebrow">Workspace</p>
        <label>
          Brand pack path
          <input
            value={brandRoot}
            onChange={(event) => setBrandRoot(event.target.value)}
          />
        </label>
        <div className="field-pair">
          <label>
            Log level
            <select
              value={logLevel}
              onChange={(event) =>
                setLogLevel(event.target.value as SettingsView["logLevel"])
              }
            >
              <option>DEBUG</option>
              <option>INFO</option>
              <option>WARN</option>
              <option>ERROR</option>
            </select>
          </label>
          <label>
            Default privacy
            <select
              value={defaultPrivacy}
              onChange={(event) =>
                setDefaultPrivacy(
                  event.target.value as SettingsView["defaultPrivacy"],
                )
              }
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </label>
        </div>
        <label>
          Video encoder
          <select
            value={videoEncoderPreference}
            onChange={(event) =>
              setVideoEncoderPreference(
                event.target.value as SettingsView["videoEncoderPreference"],
              )
            }
          >
            <option value="auto_igpu">Auto — prefer iGPU (QSV / MF)</option>
            <option value="auto_dgpu">Auto — prefer discrete GPU (NVENC / AMF)</option>
            <option value="h264_qsv">Force Intel Quick Sync (iGPU)</option>
            <option value="h264_nvenc">Force NVIDIA NVENC</option>
            <option value="h264_amf">Force AMD AMF</option>
            <option value="h264_mf">Force Windows MediaFoundation</option>
            <option value="libx264">Force CPU (libx264)</option>
          </select>
        </label>
        <p className="muted">
          Prefer iGPU when gaming or other apps need the discrete GPU. Falls
          back automatically if the chosen encoder is unavailable.
        </p>
        <button className="button button-primary" disabled={pending} onClick={save}>
          Save settings
        </button>
        <p className="form-status" aria-live="polite">
          {pending ? "Saving…" : message}
        </p>
      </section>

      <section className="settings-card">
        <p className="eyebrow">Secret status</p>
        <h2>Credentials stay masked</h2>
        <dl className="secret-list">
          <div>
            <dt>YouTube client secret</dt>
            <dd>{initial.secrets.youtubeClientSecret}</dd>
          </div>
          <div>
            <dt>LLM API key</dt>
            <dd>{initial.secrets.llmApiKey}</dd>
          </div>
          <div>
            <dt>TTS API key</dt>
            <dd>{initial.secrets.ttsApiKey}</dd>
          </div>
        </dl>
        <p className="muted">
          Secret values are supplied through environment configuration and are
          never returned in full.
        </p>
      </section>
    </div>
  );
}
