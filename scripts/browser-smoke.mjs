// Browser smoke test: drives headless Chrome over the DevTools protocol through
// the main routes of a running Calavera and reports console errors.
// Read-only: it queues nothing and changes no settings.
//
// Needs Node 22+ (built-in fetch and WebSocket) and a Chrome started with
// --remote-debugging-port=9222. See docs/DEVELOPMENT.md for the two commands.
//
//   BASE=http://app:8080 CHROME_HOST=chrome node scripts/browser-smoke.mjs
import dns from "node:dns/promises";
const host = (await dns.lookup(process.env.CHROME_HOST ?? "chrome")).address;
const base = process.env.BASE;
async function page(url) {
  const target = await (await fetch(`http://${host}:9222/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://${host}:9222`));
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description?.split("\n")[0] ?? "exception");
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error") errors.push(d.params.entry.text.slice(0, 140)); };
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send("Runtime.enable"); await send("Log.enable");
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Close the tab as well as the socket: every open tab keeps an event
  // stream to the app, and a browser allows only a few connections per site.
  const close = async () => { ws.close(); await fetch(`http://${host}:9222/json/close/${target.id}`).catch(() => {}); };
  return { ev, wait, errors, close };
}
const text = `(document.querySelector("main")?.innerText || "").replace(/\\s+/g, " ").slice(0, 110)`;
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? "  | " + detail : ""}`); };

let p = await page(base + "/nope"); await p.wait(3500);
check("unknown path redirects to the queue", (await p.ev("location.pathname")) === "/" && /ADD APPLE MUSIC LINKS/i.test(await p.ev(text)), await p.ev(text));
await p.ev(`document.querySelector('a[href="/settings"]').click()`); await p.wait(1500);
check("nav click opens Settings", (await p.ev("location.pathname")) === "/settings" && /Convert to FLAC/i.test(await p.ev(`document.querySelector("main").innerText`)));
check("active tab is marked", (await p.ev(`document.querySelector('a.nav-link.active')?.innerText.trim()`)) === "SETTINGS" || /settings/i.test(await p.ev(`document.querySelector('a.nav-link.active')?.innerText`)));
await p.ev("history.back()"); await p.wait(1200);
check("browser back returns to the queue", (await p.ev("location.pathname")) === "/");
check("no errors on these pages", p.errors.length === 0, p.errors.join(" ; ")); await p.close();

p = await page(base + "/search?q=hatebreed"); await p.wait(6000);
const cards = await p.ev(`document.querySelectorAll("article.album").length`);
check("search from URL shows albums", cards > 0, `${cards} album cards, field="${await p.ev(`document.querySelector('input[type=search]').value`)}"`);
await p.ev(`document.querySelector('a.chip')?.click()`); await p.wait(5000);
check("artist chip opens the artist page", /^\/artist\/\d+$/.test(await p.ev("location.pathname")) && (await p.ev(`document.querySelectorAll("article.album").length`)) > 0, await p.ev(`document.querySelector("h1")?.innerText`));
check("no errors on search/artist", p.errors.length === 0, p.errors.join(" ; ")); await p.close();

p = await page(base + "/account"); await p.wait(3000);
check("account page renders status", /Signed in to Apple Music/i.test(await p.ev(`document.querySelector("main").innerText`)));
check("covers allowed by CSP (no errors)", p.errors.length === 0, p.errors.join(" ; ")); await p.close();
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
