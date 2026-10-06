import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useStore } from "../lib/store";
import { Icon } from "../components/Icon";

function Countdown({ deadline }: { deadline: number }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round(deadline - Date.now() / 1000)));
  useEffect(() => {
    const timer = window.setInterval(() => setLeft(Math.max(0, Math.round(deadline - Date.now() / 1000))), 500);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return <strong>{left} s</strong>;
}

export function AccountPage() {
  const { status, refreshStatus } = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const heading = (
    <div className="page-head">
      <h1>
        <span className="prompt" aria-hidden="true">
          ❯
        </span>
        Account
      </h1>
    </div>
  );
  if (!status) {
    return (
      <>
        {heading}
        <p className="empty">Loading…</p>
      </>
    );
  }
  const { wrapper } = status;
  const login = wrapper.login;
  const inProgress = login.state === "running" || login.state === "awaiting_2fa";
  // wrapper-lite logs every status poll; those lines say nothing useful.
  const logLines = wrapper.log_tail.filter((line) => !line.includes("request: GET /status"));
  const step = login.state === "awaiting_2fa" ? 2 : login.state === "running" ? 1 : 0;

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.login(email, password);
      setPassword(""); // do not keep it in the page once it has been sent
      refreshStatus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The sign-in could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.submitCode(code);
      setCode("");
      refreshStatus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The code could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {heading}

      {!wrapper.reachable ? (
        <div className="callout callout-bad" role="alert">
          <span className="callout-icon">
            <Icon name="warning" size={20} />
          </span>
          <div>
            The wrapper container is not answering. Check <code>docker compose ps</code> and{" "}
            <code>docker compose logs wrapper</code>.
          </div>
        </div>
      ) : wrapper.ready ? (
        <div className="callout callout-ok">
          <span className="tag callout-tag">ok</span>
          <div>
            <strong>Signed in to Apple Music.</strong> Store: {wrapper.regions.join(", ")}. Downloads are ready.
          </div>
        </div>
      ) : wrapper.phase === "starting" ? (
        <div className="callout">
          <span className="callout-icon">
            <Icon name="info" size={20} />
          </span>
          <div>A session exists; the wrapper is starting.</div>
        </div>
      ) : !inProgress ? (
        <div className="callout callout-warn">
          <span className="callout-icon">
            <Icon name="warning" size={20} />
          </span>
          <div>
            <strong>Not signed in.</strong> Sign in once; the session is kept until Apple ends it.
          </div>
        </div>
      ) : null}

      {login.state === "failed" && (
        <div className="callout callout-bad" role="alert">
          <span className="callout-icon">
            <Icon name="warning" size={20} />
          </span>
          <div>{login.message}</div>
        </div>
      )}
      {error && (
        <div className="callout callout-bad" role="alert">
          <span className="callout-icon">
            <Icon name="warning" size={20} />
          </span>
          <div>{error}</div>
        </div>
      )}

      <div className="card form">
        <ol className="steps" aria-label="Sign-in steps">
          {["Apple ID", "Code", "Done"].map((label, index) => (
            <li key={label} className={`tag ${index === step ? "tag-accent" : index < step ? "tag-ok" : "tag-ghost"}`} aria-current={index === step ? "step" : undefined}>
              {String(index + 1).padStart(2, "0")} {label}
            </li>
          ))}
        </ol>

        {login.state === "awaiting_2fa" ? (
          <form className="stack" onSubmit={submitCode}>
            <p>
              Apple sent a 6-digit code to your trusted devices. Enter it within{" "}
              {login.twofa_deadline ? <Countdown deadline={login.twofa_deadline} /> : "a minute"}.
            </p>
            <div className="field">
              <label className="field-label" htmlFor="code">
                Verification code
              </label>
              <input
                id="code"
                className="input code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                autoFocus
                required
              />
            </div>
            <div>
              <button className="button button-primary" disabled={busy || code.length !== 6}>
                Verify
              </button>
            </div>
            <p className="small muted">
              If a device only shows Allow / Don't Allow, tap Allow to see the code, or get one under Settings, then your
              name, then Sign-In &amp; Security, then Get Verification Code.
            </p>
          </form>
        ) : login.state === "running" ? (
          <p role="status">
            <span className="prompt" aria-hidden="true">
          ❯
        </span>{" "}
            {login.message || "Contacting Apple…"}
          </p>
        ) : (
          <form className="stack" onSubmit={submitLogin}>
            <p className="muted">
              {wrapper.session ? "Sign in again with" : "Sign in with"} an Apple ID that has an active Apple Music
              subscription.
            </p>
            <div className="field">
              <label className="field-label" htmlFor="apple-id">
                Apple ID
              </label>
              <input
                id="apple-id"
                className="input"
                type="email"
                autoComplete="username"
                autoCapitalize="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <button className="button button-primary" disabled={busy}>
                Sign in
              </button>
            </div>
            <p className="small muted">
              The password is passed to the sign-in process once and is not stored anywhere; only Apple's session
              tokens are kept. This page is served without encryption, so sign in from a network you trust.
              {wrapper.session && " Signing in again replaces the current session and pauses downloads while it runs."}
            </p>
          </form>
        )}
      </div>

      {logLines.length > 0 && (
        <section className="section" aria-labelledby="wrapper-log-heading">
          <div className="section-head">
            <h2 id="wrapper-log-heading">Wrapper log</h2>
          </div>
          <div className="terminal">
            <div className="terminal-bar" aria-hidden="true">
              <i />
              <i />
              <i />
              <span>wrapper.log</span>
            </div>
            <pre className="terminal-body" tabIndex={0} aria-label="Wrapper log">
              {logLines.join("\n")}
            </pre>
          </div>
        </section>
      )}
    </>
  );
}
