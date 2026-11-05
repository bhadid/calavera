import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import "../lib/accent"; // applies the saved accent and draws the tab icon
import { leftReloadedPage } from "../lib/api";
import { bytes } from "../lib/format";
import { useStore } from "../lib/store";
import type { Status } from "../lib/types";
import { Backdrop } from "./Backdrop";
import { DotsLogo } from "./DotsLogo";
import { Icon, type IconName } from "./Icon";

// The same four destinations are a sidebar on wide screens and a tab bar on
// phones, as in Apple's own apps.
const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: "/search", label: "Search", icon: "search" },
  { to: "/queue", label: "Queue", icon: "queue" },
  { to: "/settings", label: "Settings", icon: "settings" },
  { to: "/account", label: "Account", icon: "user" },
];

export type Tone = "ok" | "warn" | "bad";

export function accountState(status: Status | null): { tone: Tone; text: string } {
  if (!status) return { tone: "warn", text: "Checking" };
  const { wrapper } = status;
  if (wrapper.ready) return { tone: "ok", text: "Signed in" };
  if (!wrapper.reachable) return { tone: "bad", text: "Wrapper offline" };
  if (wrapper.phase === "needs_fix") return { tone: "bad", text: "Needs a fix" };
  if (wrapper.phase === "awaiting_2fa") return { tone: "warn", text: "Code needed" };
  if (wrapper.phase === "starting" || wrapper.phase === "logging_in") return { tone: "warn", text: "Connecting" };
  return { tone: "bad", text: "Not signed in" };
}

export function libraryState(status: Status | null): { tone: Tone; text: string } {
  if (!status) return { tone: "warn", text: "Checking" };
  return status.library.ok ? { tone: "ok", text: `${bytes(status.library.free_bytes)} free` } : { tone: "bad", text: "Unavailable" };
}

function State({ tone, text }: { tone: Tone; text: string }) {
  return (
    <span className={`state ${tone}`}>
      <span className="dot" aria-hidden="true" />
      {text}
    </span>
  );
}

const BANNER_ICON = { success: "check", error: "warning", info: "info" } as const;

export function Layout() {
  const { toasts, dismiss, jobs, status, connected, jobsLoaded } = useStore();
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  const account = accountState(status);
  const library = libraryState(status);
  const link: { tone: Tone; text: string } = connected ? { tone: "ok", text: "Live" } : { tone: jobsLoaded ? "bad" : "warn", text: jobsLoaded ? "Reconnecting" : "Connecting" };

  // A reloaded page asks Apple afresh (lib/api.ts); that ends on leaving it.
  const location = useLocation();
  const arrived = useRef(true);
  useEffect(() => {
    if (arrived.current) arrived.current = false;
    else leftReloadedPage();
  }, [location.pathname]);

  return (
    <div className="app">
      <Backdrop />
      <aside className="sidebar">
        <NavLink to="/search" className="brand" aria-label="Calavera, go to search">
          <DotsLogo size={34} />
          Calavera
        </NavLink>
        <nav className="nav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon name={item.icon} size={22} />
              <span>{item.label}</span>
              {item.to === "/queue" && active > 0 && (
                <span className="count">
                  {active}
                  <span className="sr-only"> in the queue</span>
                </span>
              )}
              {item.to === "/account" && account.tone !== "ok" && (
                <span className="count warn">
                  <span aria-hidden="true">●</span>
                  <span className="sr-only">{account.text}</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="side-status" role="status">
          <NavLink to="/account">
            <span className="muted">Apple Music</span>
            <State {...account} />
          </NavLink>
          <NavLink to="/settings">
            <span className="muted">Library</span>
            <State {...library} />
          </NavLink>
          <div>
            <span className="muted">Connection</span>
            <State {...link} />
          </div>
        </div>
      </aside>

      <main className="main">
        {jobsLoaded && !connected && (
          <div className="connection" role="status">
            <Icon name="bolt" size={14} /> Connection lost. Reconnecting…
          </div>
        )}
        <div className="content">
          <Outlet />
        </div>
      </main>

      <nav className="tabbar" aria-label="Main">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
            <Icon name={item.icon} size={25} />
            <span>{item.label}</span>
            {item.to === "/queue" && active > 0 && (
              <span className="badge">
                {active}
                <span className="sr-only"> in the queue</span>
              </span>
            )}
            {item.to === "/account" && account.tone !== "ok" && (
              <span className="dot-warn">
                <span className="sr-only">{account.text}</span>
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="banners" role="status" aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} className={`banner banner-${t.kind}`} onClick={() => dismiss(t.id)} aria-label={`${t.message} Dismiss.`}>
            <Icon name={BANNER_ICON[t.kind]} size={20} />
            <span>{t.message}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Back to where the user came from; a directly opened link has no history. */
export function BackBar({ fallback = "/search", label = "Back" }: { fallback?: string; label?: string }) {
  return (
    <div className="backbar">
      <BackButton fallback={fallback} label={label} />
    </div>
  );
}

function BackButton({ fallback, label }: { fallback: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button className="back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(fallback))}>
      <Icon name="back" size={22} weight={2.4} />
      {label}
    </button>
  );
}
