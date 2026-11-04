import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useStore } from "../store";
import type { Settings } from "../types";

/** The download settings as saved, a draft being edited, and saving it. */
export function useSettingsDraft() {
  const { notify } = useStore();
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

  const dirty = Boolean(draft && saved) && JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const undo = () => setDraft(saved);

  async function save(event?: FormEvent) {
    event?.preventDefault();
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
  return { saved, draft, set, dirty, undo, save, saving, error };
}
