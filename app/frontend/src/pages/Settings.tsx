import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { bytes } from "../lib/format";
import { useStore } from "../lib/store";
import type { Settings } from "../lib/types";
import { Segmented, Switch } from "../components/Controls";
import { Icon } from "../components/Icon";

const RATES: { value: Settings["max_sample_rate"]; label: string }[] = [
  { value: 44100, label: "44.1" },
  { value: 48000, label: "48" },
  { value: 96000, label: "96" },
  { value: 192000, label: "192 kHz" },
];

// Where this copy's source code can be obtained. The licence (AGPL-3.0)
// requires offering the source to everyone who uses the app over a network:
// if you run a modified version for others, point this at your own source.
const SOURCE_URL = "https://github.com/killparty/calavera";

const COVERS: { value: Settings["cover_size"]; label: string }[] = [
  { value: 1400, label: "1400" },
  { value: 3000, label: "3000" },
  { value: 5000, label: "5000 px" },
];

export function SettingsPage() {
  const { status, notify } = useStore();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .settings()
      .then((r) => {
        setSaved(r.settings);
        setDraft(r.settings);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "The settings could not be loaded."));
  }, []);

  const heading = (
    <div className="page-head">
      <h1>
        <span className="prompt" aria-hidden="true">
          ❯
        </span>
        Settings
      </h1>
    </div>
  );

  if (!draft || !saved) {
    return (
      <>
        {heading}
        {error ? (
          <div className="callout callout-bad" role="alert">
            <span className="callout-icon">
              <Icon name="warning" size={20} />
            </span>
            <div>{error}</div>
          </div>
        ) : (
          <p className="empty">Loading…</p>
        )}
      </>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft({ ...draft, [key]: value });

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const result = await api.saveSettings(draft);
      setSaved(result);
      setDraft(result);
      notify("Settings saved. They apply to downloads started from now on.", "success");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {heading}
      <form className="stack" onSubmit={save}>
        <section className="card group" aria-labelledby="group-format">
          <h2 className="group-title" id="group-format">
            Format
          </h2>
          <div className="setting setting-inline">
            <div className="setting-text">
              <strong id="flac-label">Convert to FLAC</strong>
              <span className="small muted" id="flac-help">
                Each track is converted from Apple Lossless and checked to decode to identical audio. Only then is the
                original deleted. Off keeps Apple Lossless (.m4a).
              </span>
            </div>
            <div className="setting-control">
              <Switch checked={draft.flac} onChange={(v) => set("flac", v)} labelledBy="flac-label" describedBy="flac-help" />
            </div>
          </div>
          <div className="setting">
            <div className="setting-text">
              <strong>Highest sample rate</strong>
              <span className="small muted">The best version at or below this rate is downloaded.</span>
            </div>
            <div className="setting-control">
              <Segmented label="Highest sample rate" value={draft.max_sample_rate} options={RATES} onChange={(v) => set("max_sample_rate", v)} />
            </div>
          </div>
        </section>

        <section className="card group" aria-labelledby="group-metadata">
          <h2 className="group-title" id="group-metadata">
            Metadata
          </h2>
          <div className="setting setting-inline">
            <div className="setting-text">
              <strong id="lyrics-label">Embed lyrics</strong>
              <span className="small muted" id="lyrics-help">
                Synced lyrics are stored in each track when Apple has them.
              </span>
            </div>
            <div className="setting-control">
              <Switch checked={draft.lyrics} onChange={(v) => set("lyrics", v)} labelledBy="lyrics-label" describedBy="lyrics-help" />
            </div>
          </div>
          <div className="setting">
            <div className="setting-text">
              <strong>Cover art size</strong>
              <span className="small muted">Square, in pixels. Larger covers make larger files.</span>
            </div>
            <div className="setting-control">
              <Segmented label="Cover art size" value={draft.cover_size} options={COVERS} onChange={(v) => set("cover_size", v)} />
            </div>
          </div>
          <div className="setting">
            <label className="setting-text" htmlFor="language">
              <strong>Metadata language</strong>
              <span className="small muted">
                For example en-GB. Artist, album and genre names come in this language. It must be one your store
                supports, otherwise Apple ignores it. Empty uses the store's own language.
              </span>
            </label>
            <div className="setting-control">
              <input
                id="language"
                className="input"
                type="text"
                value={draft.language}
                onChange={(e) => set("language", e.target.value.trim())}
                placeholder="default"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </div>
          <div className="setting">
            <label className="setting-text" htmlFor="storefront">
              <strong>Store for search</strong>
              <span className="small muted">Two-letter country code. Empty uses the store of the signed-in account.</span>
            </label>
            <div className="setting-control">
              <input
                id="storefront"
                className="input"
                type="text"
                value={draft.storefront}
                onChange={(e) => set("storefront", e.target.value.trim().toLowerCase())}
                placeholder={status ? `auto (${status.storefront})` : "auto"}
                maxLength={2}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </div>
        </section>

        {error && (
          <div className="callout callout-bad" role="alert">
            <span className="callout-icon">
              <Icon name="warning" size={20} />
            </span>
            <div>{error}</div>
          </div>
        )}

        {dirty && (
          <div className="card savebar">
            <strong>Unsaved changes</strong>
            <div className="savebar-actions">
              <button type="button" className="button button-small" disabled={saving} onClick={() => setDraft(saved)}>
                Undo
              </button>
              <button className="button button-small button-primary" disabled={saving}>
                Save
              </button>
            </div>
          </div>
        )}
      </form>

      <section className="section" aria-labelledby="system-heading">
        <div className="section-head">
          <h2 id="system-heading">System</h2>
        </div>
        <dl className="card facts">
          <dt>library</dt>
          <dd>{status ? (status.library.ok ? `available, ${bytes(status.library.free_bytes)} free` : status.library.problem) : "…"}</dd>
          <dt>staging</dt>
          <dd>{status ? `${bytes(status.staging.free_bytes)} free` : "…"}</dd>
          <dt>apple music</dt>
          <dd>{status ? (status.wrapper.ready ? `signed in, store ${status.wrapper.regions.join(", ")}` : "not signed in") : "…"}</dd>
          <dt>version</dt>
          <dd>{status?.version ?? "…"}</dd>
          <dt>source</dt>
          <dd>
            <a href={SOURCE_URL} target="_blank" rel="noreferrer">
              {SOURCE_URL.replace("https://", "")}
            </a>{" "}
            · AGPL-3.0
          </dd>
        </dl>
        <p className="small muted">
          Library rules: albums are copied to Artist/Album. Existing folders are never overwritten, renamed or deleted;
          an album whose folder already exists is skipped.
        </p>
      </section>
    </>
  );
}
