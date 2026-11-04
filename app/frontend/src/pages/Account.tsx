import { useState } from "react";
import { useSecondsLeft, useSignIn } from "../lib/hooks/signIn";
import { Icon } from "../components/Icon";
import { accountState } from "../components/Layout";
import { Notice, span } from "../components/tiles";

function Countdown({ deadline }: { deadline: number }) {
  return <strong className="num">{useSecondsLeft(deadline)} s</strong>;
}

export function AccountPage() {
  const {
    status, wrapper, login, inProgress, logLines, step,
    email, setEmail, password, setPassword, code, setCode, error, busy, submitLogin, submitCode,
  } = useSignIn();
  const account = accountState(status);
  // Signed in, the form waits behind a button: signing in again is rare.
  const [again, setAgain] = useState(false);

  return (
    <div className="page">
      <header className="top">
        <h1>Account</h1>
      </header>
      {!status || !wrapper || !login ? (
        <p className="empty">Loading…</p>
      ) : (
        <>
          {(login.state === "failed" || error || !wrapper.reachable || wrapper.phase === "needs_fix") && (
            <>
              {!wrapper.reachable && (
                <Notice tone="bad" role="alert">
                  The wrapper container is not answering. Check <code>docker compose ps</code> and <code>docker compose logs wrapper</code>.
                </Notice>
              )}
              {wrapper.reachable && wrapper.phase === "needs_fix" && (
                <Notice tone="bad" role="alert">
                  <strong>The wrapper cannot use its volumes.</strong> {wrapper.problem}
                </Notice>
              )}
              {login.state === "failed" && <Notice tone="bad" role="alert">{login.message}</Notice>}
              {error && <Notice tone="bad" role="alert">{error}</Notice>}
            </>
          )}

          <div className="bento">
            <section className="tile" style={span(2, 4, 6)} aria-labelledby="signin-heading">
              <div className="tile-head">
                <Icon name="note" size={16} />
                Apple Music
              </div>
              <p className={`big ${account.tone === "ok" ? "ok" : account.tone}`} id="signin-heading">
                {account.text}
              </p>
              <p className="muted">
                {wrapper.ready
                  ? `Store: ${wrapper.regions.join(", ")}. Downloads are ready.`
                  : wrapper.phase === "starting"
                    ? "A session exists; the wrapper is starting."
                    : inProgress
                      ? "Signing in…"
                      : "Sign in once; the session is kept until Apple ends it."}
              </p>
              {wrapper.ready && !again && login.state !== "running" && login.state !== "awaiting_2fa" ? (
                <div className="actions">
                  <button className="btn btn-gray btn-small" onClick={() => setAgain(true)}>
                    Sign in again
                  </button>
                </div>
              ) : (
              <>
              <div className="tile-bar" style={{ marginTop: 8 }}>
                <h2>{wrapper.session ? "Sign in again" : "Sign in"}</h2>
                <ol className="steps" aria-label="Sign-in steps">
                  {["Apple ID", "Code", "Done"].map((label, index) => (
                    <li
                      key={label}
                      className={`pill${index === step ? " pill-accent" : index < step ? " pill-ok" : ""}`}
                      aria-current={index === step ? "step" : undefined}
                    >
                      {index < step && <Icon name="check" size={12} weight={3} />}
                      {index + 1}. {label}
                    </li>
                  ))}
                </ol>
              </div>

              {login.state === "awaiting_2fa" ? (
                <form className="form" onSubmit={submitCode}>
                  <p>
                    Apple sent a 6-digit code to your trusted devices. Enter it within{" "}
                    {login.twofa_deadline ? <Countdown deadline={login.twofa_deadline} /> : "a minute"}.
                  </p>
                  <div>
                    <label className="field-label" htmlFor="code">
                      Verification code
                    </label>
                    <input
                      id="code"
                      className="field-input code-input"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="\d{6}"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>
                  <div className="actions">
                    <button className="btn btn-filled" disabled={busy || code.length !== 6}>
                      Verify
                    </button>
                  </div>
                  <p className="help">
                    If a device only shows Allow / Don't Allow, tap Allow to see the code, or get one under Settings, then your name, then
                    Sign-In &amp; Security, then Get Verification Code.
                  </p>
                </form>
              ) : login.state === "running" ? (
                <p role="status" className="muted">
                  {login.message || "Contacting Apple…"}
                </p>
              ) : (
                <form className="form" onSubmit={submitLogin}>
                  <p className="muted">Use an Apple ID with an active Apple Music subscription.</p>
                  <div>
                    <label className="field-label" htmlFor="apple-id">
                      Apple ID
                    </label>
                    <input
                      id="apple-id"
                      className="field-input"
                      type="email"
                      autoComplete="username"
                      autoCapitalize="off"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="password">
                      Password
                    </label>
                    <input
                      id="password"
                      className="field-input"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="actions">
                    <button className="btn btn-filled" disabled={busy}>
                      Sign in
                    </button>
                  </div>
                  <p className="help">
                    The password is passed to the sign-in process once and is not stored; only Apple's session tokens are kept. This page is
                    served without encryption, so sign in from a network you trust.
                    {wrapper.session && " Signing in again replaces the current session and pauses downloads while it runs."}
                  </p>
                </form>
              )}
              </>
              )}
            </section>

            {logLines.length > 0 && (
              <section className="tile tile-console" style={span(2, 4, 6)} aria-labelledby="log-heading">
                <div className="tile-head" id="log-heading">
                  <Icon name="terminal" size={16} />
                  Wrapper log
                </div>
                <pre className="console" tabIndex={0} aria-label="Wrapper log">
                  {logLines.join("\n")}
                </pre>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
