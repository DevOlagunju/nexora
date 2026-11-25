#!/usr/bin/env node
/**
 * Read-only post-deploy smoke test. Creates no data.
 *   npm run smoke -- https://staging.yourdomain.com
 *   SMOKE_EMAIL=... SMOKE_PASSWORD=... npm run smoke -- https://...   (also checks a real login)
 */
const base = (process.argv[2] || process.env.SMOKE_URL || "http://localhost:3000").replace(/\/$/, "");
let failed = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`  ok    ${name}${detail ? `  (${detail})` : ""}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const get = (path, init) => fetch(base + path, { ...init, signal: AbortSignal.timeout(15_000) });
const postJson = (path, body, headers = {}) =>
  get(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

console.log(`Smoke testing ${base}\n`);

await check("health: app + database", async () => {
  const res = await get("/api/health");
  const json = await res.json();
  assert(res.status === 200 && json.db === "ok", `status ${res.status} ${JSON.stringify(json)}`);
  return `db ${json.latencyMs}ms, version ${json.version}`;
});

await check("security headers", async () => {
  const res = await get("/");
  assert(res.status === 200, `home returned ${res.status}`);
  assert(res.headers.get("x-frame-options") === "DENY", "missing X-Frame-Options");
  assert(res.headers.get("x-content-type-options") === "nosniff", "missing nosniff");
  if (base.startsWith("https://")) assert(res.headers.get("strict-transport-security"), "missing HSTS");
});

await check("public pages render", async () => {
  for (const p of ["/rates", "/login", "/register"]) {
    const res = await get(p);
    assert(res.status === 200, `${p} -> ${res.status}`);
  }
});

await check("desk rates available", async () => {
  const res = await get("/api/ngn-rates");
  const json = await res.json();
  assert(res.ok && json.desk?.USDT?.sell > 0, `no USDT rate (${res.status})`);
  return `USDT sell ₦${Math.round(json.desk.USDT.sell)}`;
});

await check("protected API rejects anonymous", async () => {
  const res = await get("/api/mobile");
  assert(res.status === 401, `expected 401, got ${res.status}`);
});

await check("bad login rejected", async () => {
  const res = await postJson("/api/auth", { action: "login", email: "smoke-nobody@example.com", password: "Wrong-Pass-123" });
  assert(res.status === 401 || res.status === 429, `expected 401, got ${res.status}`);
});

await check("Paystack webhook rejects unsigned calls", async () => {
  const res = await postJson("/api/webhooks/paystack", { event: "transfer.success" }, { "x-paystack-signature": "bad" });
  assert(res.status === 401 || res.status === 503, `expected 401/503, got ${res.status}`);
  return res.status === 503 ? "Paystack not configured" : "";
});

await check("cron endpoint is protected", async () => {
  const res = await get("/api/cron/sync-rates");
  assert(res.status === 401 || res.status === 503, `expected 401/503, got ${res.status}`);
});

if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
  await check("real account login + logout", async () => {
    const res = await postJson("/api/auth", { action: "login", email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD });
    const json = await res.json();
    assert(res.ok && json.token, `login failed: ${json.error ?? res.status}`);
    const me = await get("/api/mobile", { headers: { Authorization: `Bearer ${json.token}` } });
    assert(me.ok, `dashboard ${me.status}`);
    await postJson("/api/auth", { action: "logout" }, { Authorization: `Bearer ${json.token}` });
  });
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll smoke checks passed");
process.exit(failed ? 1 : 0);
