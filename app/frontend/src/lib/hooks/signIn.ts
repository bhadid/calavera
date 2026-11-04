import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useStore } from "../store";

/** Seconds left until a Unix-seconds deadline, counting down. */
export function useSecondsLeft(deadline: number | null) {
  const left = () => (deadline ? Math.max(0, Math.round(deadline - Date.now() / 1000)) : 0);
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    setSeconds(left());
    if (!deadline) return;
    const timer = window.setInterval(() => setSeconds(left()), 500);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);
  return seconds;
}

/** Signing in to Apple Music: Apple ID and password, then the two-factor code. */
export function useSignIn() {
  const { status, refreshStatus } = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  const wrapper = status?.wrapper;
  const login = wrapper?.login;
  const inProgress = login?.state === "running" || login?.state === "awaiting_2fa";
  // wrapper-lite logs every status poll; those lines say nothing useful.
  const logLines = (wrapper?.log_tail ?? []).filter((line) => !line.includes("request: GET /status"));
  const step = login?.state === "awaiting_2fa" ? 2 : login?.state === "running" ? 1 : 0;
  return {
    status, wrapper, login, inProgress, logLines, step,
    email, setEmail, password, setPassword, code, setCode: (v: string) => setCode(v.replace(/\D/g, "")),
    error, busy, submitLogin, submitCode,
  };
}
