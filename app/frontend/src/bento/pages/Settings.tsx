import { type CSSProperties } from "react";
import { useAccent } from "../../lib/accent";
import { DEFAULT_ACCENT, DEPTH, depthTrack, hueName, hueTrack } from "../../lib/accentColour";
import { bytes } from "../../lib/format";
import { useSettingsDraft } from "../../lib/hooks/settings";
import { useStore } from "../../lib/store";
import { useTheme, type Theme } from "../../lib/theme";
import type { Settings } from "../../lib/types";
import { switchUi } from "../../lib/ui";
import { Segmented, Switch } from "../../components/Controls";
import { DotsLogo } from "../components/DotsLogo";
import { Icon } from "../components/Icon";
import { Notice, span } from "../components/tiles";

const RATES: { value: Settings["max_sample_rate"]; label: string }[] = [
  { value: 44100, label: "44.1" },
  { value: 48000, label: "48" },
  { value: 96000, label: "96" },
  { value: 192000, label: "192 kHz" },
];
const COVERS: { value: Settings["cover_size"]; label: string }[] = [
  { value: 1400, label: "1400" },
  { value: 3000, label: "3000" },
  { value: 5000, label: "5000 px" },
];
const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "Automatic" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// Where this copy's source code can be obtained. The licence (AGPL-3.0)
// requires offering the source to everyone who uses the app over a network:
// if you run a modified version for others, point this at your own source.
const SOURCE_URL = "https://github.com/bhadid/calavera";

export function SettingsPage() {
  const { status } = useStore();
  const { saved, draft, set, dirty, undo, save, saving, error } = useSettingsDraft();
  const [accent, setAccent, accentIsDefault] = useAccent();
  const [theme, , setTheme] = useTheme();

  return (
    <div>
      <header className="top">
        <h1>Settings</h1>
      </header>
      {error && (
        <div className="notices">
          <Notice tone="bad" role="alert">{error}</Notice>
        </div>
      )}

      {draft && saved ? (
        <form id="settings-form" onSubmit={save}>
          <div className="bento">
            <section className="tile" style={span(2, 4, 3)} aria-labelledby="group-format">
              <div className="tile-head" id="group-format">
                <Icon name="wave" size={16} />
                Format
              </div>
              <div>
                <div className="setting">
                  <div className="setting-text">
                    <strong id="flac-label">Convert to FLAC</strong>
                    <span id="flac-help">
                      Each track is converted from Apple Lossless and checked to decode to identical audio; only then is the original
                      deleted. Off keeps Apple Lossless (.m4a).
                    </span>
                  </div>
                  <div className="setting-control">
                    <Switch checked={draft.flac} onChange={(v) => set("flac", v)} labelledBy="flac-label" describedBy="flac-help" />
                  </div>
                </div>
                <div className="setting">
                  <div className="setting-text">
                    <strong>Highest sample rate</strong>
                    <span>The best version at or below this rate is downloaded.</span>
                  </div>
                  <div className="setting-control">
                    <Segmented label="Highest sample rate" value={draft.max_sample_rate} options={RATES} onChange={(v) => set("max_sample_rate", v)} />
                  </div>
                </div>
              </div>
            </section>

            <section className="tile" style={span(2, 4, 3)} aria-labelledby="group-metadata">
              <div className="tile-head" id="group-metadata">
                <Icon name="tag" size={16} />
                Metadata
              </div>
              <div>
                <div className="setting">
                  <div className="setting-text">
                    <strong id="lyrics-label">Embed lyrics</strong>
                    <span id="lyrics-help">Synced lyrics are stored in each track when Apple has them.</span>
                  </div>
                  <div className="setting-control">
                    <Switch checked={draft.lyrics} onChange={(v) => set("lyrics", v)} labelledBy="lyrics-label" describedBy="lyrics-help" />
                  </div>
                </div>
                <div className="setting">
                  <div className="setting-text">
                    <strong>Cover art size</strong>
                    <span>Square, in pixels. Larger covers make larger files.</span>
                  </div>
                  <div className="setting-control">
                    <Segmented label="Cover art size" value={draft.cover_size} options={COVERS} onChange={(v) => set("cover_size", v)} />
                  </div>
                </div>
                <div className="setting">
                  <label className="setting-text" htmlFor="language">
                    <strong>Metadata language</strong>
                    <span>For example en-GB. Must be one your store supports. Empty uses the store's own language.</span>
                  </label>
                  <div className="setting-control">
                    <input
                      id="language"
                      className="field-input"
                      type="text"
                      value={draft.language}
                      onChange={(e) => set("language", e.target.value.trim())}
                      placeholder="Default"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </div>
                </div>
                <div className="setting">
                  <label className="setting-text" htmlFor="storefront">
                    <strong>Store for search</strong>
                    <span>Two-letter country code. Empty uses the store of the signed-in account.</span>
                  </label>
                  <div className="setting-control">
                    <input
                      id="storefront"
                      className="field-input"
                      type="text"
                      value={draft.storefront}
                      onChange={(e) => set("storefront", e.target.value.trim().toLowerCase())}
                      placeholder={status ? `Automatic (${status.storefront})` : "Automatic"}
                      maxLength={2}
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </div>
                </div>
              </div>
            </section>
          </div>
        </form>
      ) : (
        !error && <p className="empty">Loading…</p>
      )}

      <h2 className="section-title">Appearance</h2>
      <p className="help" style={{ margin: "-6px 4px 12px" }}>Kept in this browser and applied at once.</p>
      {/* Kept in this browser, so outside the form above. */}
      <div className="bento">
        <section className="tile" style={span(2, 4, 4)} aria-label="Appearance">
          <div>
            <div className="setting">
              <div className="setting-text">
                <strong>Interface</strong>
                <span>Bento tiles, or the classic terminal look.</span>
              </div>
              <div className="setting-control">
                <Segmented
                  label="Interface"
                  value="bento"
                  options={[
                    { value: "bento", label: "Bento" },
                    { value: "classic", label: "Classic" },
                  ]}
                  onChange={(v) => v === "classic" && switchUi("classic")}
                />
              </div>
            </div>
            <div className="setting">
              <div className="setting-text">
                <strong>Appearance</strong>
                <span>Automatic follows the device.</span>
              </div>
              <div className="setting-control">
                <Segmented label="Appearance" value={theme} options={THEMES} onChange={setTheme} />
              </div>
            </div>
            <div className="setting">
              <div className="setting-text">
                <strong id="mono-label">Monochrome</strong>
                <span id="mono-help">No accent colour: black in the light appearance, white in the dark one.</span>
              </div>
              <div className="setting-control">
                <Switch checked={accent.mono} onChange={(mono) => setAccent({ ...accent, mono })} labelledBy="mono-label" describedBy="mono-help" />
              </div>
            </div>
            <div className="setting setting-wide">
              <label className="setting-text" htmlFor="accent-hue">
                <strong>Accent colour</strong>
                <span>Colour on the upper slider, depth on the lower one. The logo's colours turn with it.</span>
              </label>
              <div className="setting-control">
                <div className="accent-control">
                  <input
                    id="accent-hue"
                    className="hue"
                    type="range"
                    min={0}
                    max={359}
                    step={1}
                    value={accent.hue}
                    disabled={accent.mono}
                    aria-valuetext={`${hueName(accent.hue)}, ${accent.hue} degrees`}
                    style={{ "--hue-track": hueTrack(accent.depth) } as CSSProperties}
                    onChange={(e) => setAccent({ ...accent, hue: Number(e.target.value) })}
                  />
                  <input
                    className="hue"
                    type="range"
                    min={DEPTH.min}
                    max={DEPTH.max}
                    step={1}
                    value={accent.depth}
                    disabled={accent.mono}
                    aria-label="Depth of the accent colour"
                    aria-valuetext={`depth ${accent.depth}`}
                    style={{ "--hue-track": depthTrack(accent.hue) } as CSSProperties}
                    onChange={(e) => setAccent({ ...accent, depth: Number(e.target.value) })}
                  />
                  <div className="accent-foot">
                    <span>
                      <span className="swatch" aria-hidden="true" />
                      {accent.mono ? "Monochrome" : `${hueName(accent.hue)} · ${accent.hue}° · depth ${accent.depth}`}
                    </span>
                    <button type="button" className="btn btn-plain btn-small" disabled={accentIsDefault} onClick={() => setAccent(DEFAULT_ACCENT)}>
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="tile logo-preview" style={span(2, 4, 2)} aria-label="Logo and status colours">
          <div className="logo-pair" aria-hidden="true">
            <div className="logo-on-light">
              <DotsLogo size={96} />
            </div>
            <div className="logo-on-dark">
              <DotsLogo size={96} />
            </div>
          </div>
          <div className="pills" style={{ justifyContent: "center" }}>
            <span className="pill pill-ok">
              <Icon name="check" size={12} weight={3} />
              All good
            </span>
            <span className="pill pill-bad">
              <Icon name="warning" size={12} weight={2.4} />
              Needs attention
            </span>
          </div>
          <p className="help">The logo has a light and a dark set of colours. Status uses the accent and the logo's highlight colour.</p>
        </section>
      </div>

      <h2 className="section-title">About</h2>
      <div className="bento">
        <section className="tile" style={span(2, 4, 6)} aria-label="System">
          <dl className="facts-list">
            <dt>Library</dt>
            <dd>{status ? (status.library.ok ? `Available, ${bytes(status.library.free_bytes)} free` : status.library.problem) : "…"}</dd>
            <dt>Staging</dt>
            <dd>{status ? `${bytes(status.staging.free_bytes)} free` : "…"}</dd>
            <dt>Apple Music</dt>
            <dd>{status ? (status.wrapper.ready ? `Signed in, store ${status.wrapper.regions.join(", ")}` : "Not signed in") : "…"}</dd>
            <dt>Version</dt>
            <dd>{status?.version ?? "…"}</dd>
            <dt>Source</dt>
            <dd>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                {SOURCE_URL.replace("https://", "")}
              </a>{" "}
              · AGPL-3.0
            </dd>
          </dl>
          <p className="help">
            Albums are copied to Artist/Album. Existing folders are never overwritten, renamed or deleted; an album whose folder already
            exists is skipped.
          </p>
        </section>
      </div>
      {dirty && (
        <div className="savebar">
          <strong>Unsaved changes</strong>
          <div className="actions">
            <button type="button" className="btn btn-gray btn-small" disabled={saving} onClick={undo}>
              Undo
            </button>
            <button form="settings-form" className="btn btn-filled btn-small" disabled={saving}>
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
