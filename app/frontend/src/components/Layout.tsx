import { NavLink, Outlet } from "react-router-dom";
import { bytes } from "../lib/format";
import { useStore } from "../lib/store";
import { useTheme } from "../lib/theme";
import type { Status } from "../lib/types";
import { Icon, type IconName } from "./Icon";
import { Skull } from "./Skull";

// The same four destinations are a row of tabs on wide screens and a bottom
// tab bar on phones.
const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "Queue", icon: "queue" },
  { to: "/search", label: "Search", icon: "search" },
  { to: "/settings", label: "Settings", icon: "settings" },
  { to: "/account", label: "Account", icon: "user" },
];

type Tone = "ok" | "wait" | "bad";

function accountState(status: Status | null): { tone: Tone; text: string } {
  if (!status) return { tone: "wait", text: "checking" };
  const { wrapper } = status;
  if (wrapper.ready) return { tone: "ok", text: `signed in (${wrapper.regions.join(", ")})` };
  if (!wrapper.reachable) return { tone: "bad", text: "wrapper offline" };
  if (wrapper.phase === "awaiting_2fa") return { tone: "wait", text: "code needed" };
  if (wrapper.phase === "starting" || wrapper.phase === "logging_in") return { tone: "wait", text: "connecting" };
  return { tone: "bad", text: "not signed in" };
}

// Typed on purpose: these marks are drawn by the device's own font, like
// characters in a terminal.
const TONE_MARK: Record<Tone, string> = { ok: "●", wait: "◐", bad: "✕" };
const TONE_CLASS: Record<Tone, string> = { ok: "good", wait: "wait", bad: "fail" };

function StatusLine() {
  const { status, connected, jobsLoaded } = useStore();
  const account = accountState(status);
  const library: { tone: Tone; text: string } = !status
    ? { tone: "wait", text: "checking" }
    : status.library.ok
      ? { tone: "ok", text: `ok, ${bytes(status.library.free_bytes)} free` }
      : { tone: "bad", text: "unavailable" };
  const link: { tone: Tone; text: string } = connected
    ? { tone: "ok", text: "live" }
    : { tone: jobsLoaded ? "bad" : "wait", text: jobsLoaded ? "reconnecting" : "connecting" };
  const items: { key: string; state: { tone: Tone; text: string }; to?: string }[] = [
    { key: "apple", state: account, to: "/account" },
    { key: "library", state: library, to: "/settings" },
    { key: "link", state: link },
  ];
  return (
    <div className="statusline" role="status">
      <div className="statusline-inner">
        {items.map(({ key, state, to }) => {
          const body = (
            <>
              <span className="key">{key}:</span>{" "}
              <span className={TONE_CLASS[state.tone]}>
                <span aria-hidden="true">{TONE_MARK[state.tone]}</span> {state.text}
              </span>
            </>
          );
          return to ? (
            <NavLink key={key} to={to}>
              {body}
            </NavLink>
          ) : (
            <span key={key}>{body}</span>
          );
        })}
      </div>
    </div>
  );
}

export function Layout() {
  const { toasts, dismiss, jobs, status } = useStore();
  const [theme, cycleTheme] = useTheme();
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  const account = accountState(status);
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" aria-label="Calavera, go to the queue">
            <Skull size={32} />
            <span>
              calavera
              <span className="cursor" aria-hidden="true" />
            </span>
          </NavLink>
          <nav className="nav" aria-label="Main">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === "/"} className="nav-link">
                <Icon name={item.icon} size={20} />
                <span>{item.label}</span>
                {item.to === "/" && active > 0 && (
                  <span className="nav-badge">
                    {active}
                    <span className="sr-only"> in progress</span>
                  </span>
                )}
                {item.to === "/account" && account.tone !== "ok" && (
                  <span className={`nav-dot tone-${account.tone}`}>
                    <span className="sr-only">{account.text}</span>
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-end">
            <button className="button button-small" onClick={cycleTheme} aria-label={`Theme: ${theme}. Change theme.`}>
              <Icon name={theme === "system" ? "auto" : theme === "light" ? "sun" : "moon"} size={16} />
              {theme === "system" ? "auto" : theme}
            </button>
          </div>
        </div>
      </header>
      <StatusLine />
      <main className="page">
        <Outlet />
      </main>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} className="toast" onClick={() => dismiss(t.id)} aria-label={`${t.message} Dismiss.`}>
            <span className={`tag ${t.kind === "error" ? "tag-bad" : t.kind === "success" ? "tag-ok" : "tag-info"}`}>
              {t.kind === "error" ? "error" : t.kind === "success" ? "ok" : "info"}
            </span>
            <span>{t.message}</span>
          </button>
        ))}
      </div>
    </>
  );
}
