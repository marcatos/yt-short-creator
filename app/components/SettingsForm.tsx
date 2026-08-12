"use client";

import { useState } from "react";

import type { SettingsView } from "@/src/application/settings";
import { BRAND_VOICE_PROFILES } from "@/src/ports/settings-repository";

export function SettingsForm({ initial }: { initial: SettingsView }) {
  const [brandRoot, setBrandRoot] = useState(initial.brandRoot);
  const [logLevel, setLogLevel] = useState(initial.logLevel);
  const [defaultPrivacy, setDefaultPrivacy] = useState(initial.defaultPrivacy);
  const [videoEncoderPreference, setVideoEncoderPreference] = useState(
    initial.videoEncoderPreference ?? "auto_igpu",
  );
  const [brandVoiceProfile, setBrandVoiceProfile] = useState(
    initial.brandVoiceProfile,
  );
  const [italianVoiceProfile, setItalianVoiceProfile] = useState(
    initial.italianVoiceProfile,
  );
  const [shortsBurnInCaptions, setShortsBurnInCaptions] = useState(
    initial.shortsBurnInCaptions,
  );
  const [fullBurnInCaptions, setFullBurnInCaptions] = useState(
    initial.fullBurnInCaptions,
  );
  const [voiceDuckDb, setVoiceDuckDb] = useState(initial.voiceDuckDb);
  const [enableVoiceOverPipeline, setEnableVoiceOverPipeline] = useState(
    initial.enableVoiceOverPipeline,
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
          brandVoiceProfile,
          italianVoiceProfile,
          shortsBurnInCaptions,
          fullBurnInCaptions,
          voiceDuckDb,
          enableVoiceOverPipeline,
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
        <div className="field-pair">
          <label>
            English voice
            <select
              value={brandVoiceProfile}
              onChange={(event) =>
                setBrandVoiceProfile(
                  event.target.value as SettingsView["brandVoiceProfile"],
                )
              }
            >
              {BRAND_VOICE_PROFILES.map((voice) => (
                <option key={voice} value={voice}>
                  {voice}
                </option>
              ))}
            </select>
          </label>
          <label>
            Italian voice
            <select
              value={italianVoiceProfile}
              onChange={(event) =>
                setItalianVoiceProfile(
                  event.target.value as SettingsView["italianVoiceProfile"],
                )
              }
            >
              {BRAND_VOICE_PROFILES.map((voice) => (
                <option key={`it-${voice}`} value={voice}>
                  {voice}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">
          English defaults to coral. Italian defaults to ash with a younger,
          brisker delivery — coral often sounds older/slower in Italian.
        </p>
        <div className="field-pair">
          <label>
            Voice ducking (dB)
            <input
              type="number"
              value={voiceDuckDb}
              onChange={(event) => setVoiceDuckDb(event.target.valueAsNumber)}
            />
          </label>
        </div>
        <label>
          <input
            type="checkbox"
            checked={enableVoiceOverPipeline}
            onChange={(event) =>
              setEnableVoiceOverPipeline(event.target.checked)
            }
          />
          Enable voice-over pipeline
        </label>
        <label>
          <input
            type="checkbox"
            checked={shortsBurnInCaptions}
            onChange={(event) => setShortsBurnInCaptions(event.target.checked)}
          />
          Burn captions into shorts
        </label>
        <label>
          <input
            type="checkbox"
            checked={fullBurnInCaptions}
            onChange={(event) => setFullBurnInCaptions(event.target.checked)}
          />
          Burn captions into full videos
        </label>
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
