import { useAccent } from "../lib/accent";
import { accentTokens, type AccentChoice } from "../lib/accentColour";
import { bytes } from "../lib/format";
import { useSettingsDraft } from "../lib/hooks/settings";
import { useStore } from "../lib/store";
import { useTheme, type Theme } from "../lib/theme";
import type { Settings } from "../lib/types";
import { Segmented, Switch } from "../components/Controls";
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

// A few accent colours to choose from, as in the Appearance settings of macOS.
const ACCENTS: { name: string; hue: number }[] = [
  { name: "Red", hue: 21 },
  { name: "Orange", hue: 55 },
  { name: "Yellow", hue: 95 },
  { name: "Green", hue: 145 },
  { name: "Teal", hue: 195 },
  { name: "Blue", hue: 255 },
  { name: "Purple", hue: 300 },
  { name: "Pink", hue: 345 },
];

function AccentSwatches({ choice, onChange }: { choice: AccentChoice; onChange: (choice: AccentChoice) => void }) {
  const options = [{ name: "Monochrome", hue: -1 }, ...ACCENTS];
  const current = choice.mono ? "Monochrome" : (ACCENTS.find((a) => a.hue === choice.hue)?.name ?? "");
  return (
    <div className="swatches" role="radiogroup" aria-labelledby="accent-label">
      {options.map((option) => {
        const mono = option.hue < 0;
        const colour = mono ? "" : accentTokens({ hue: option.hue, mono: false })["--ac-b-l"];
        return (
          <label key={option.name} className={`swatch-option${mono ? " swatch-mono" : ""}`} style={mono ? undefined : { background: colour }} title={option.name}>
            <input
              type="radio"
              name="accent"
              checked={current === option.name}
              onChange={() => onChange(mono ? { ...choice, mono: true } : { hue: option.hue, mono: false })}
            />
            <span className="sr-only">{option.name}</span>
          </label>
        );
      })}
      <span className="swatch-name" aria-hidden="true">
        {current || "Custom"}
      </span>
    </div>
  );
}

// Where this copy's source code can be obtained. The licence (AGPL-3.0)
// requires offering the source to everyone who uses the app over a network:
// if you run a modified version for others, point this at your own source.
const SOURCE_URL = "https://github.com/bhadid/calavera";

export function SettingsPage() {
  const { status } = useStore();
  const { saved, draft, set, dirty, undo, save, saving, error } = useSettingsDraft();
  const [accent, setAccent] = useAccent();
  const [theme, setTheme] = useTheme();

  return (
    <div className="page">
      <header className="top">
        <h1>Settings</h1>
      </header>
      {error && <Notice tone="bad" role="alert">{error}</Notice>}

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
      {/* Kept in this browser, so outside the form above. */}
      <div className="bento">
        <section className="tile" style={span(2, 4, 6)} aria-label="Appearance">
          <div>
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
                <strong id="accent-label">Accent colour</strong>
                <span>Monochrome, or a colour for buttons, links and status. Kept in this browser.</span>
              </div>
              <div className="setting-control">
                <AccentSwatches choice={accent} onChange={setAccent} />
              </div>
            </div>
          </div>
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
