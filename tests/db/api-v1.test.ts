import { describe, expect, it, vi } from "vitest";

// Outside a Next request there is no cookie jar; these tests authenticate with bearer tokens.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import * as register from "@/app/api/v1/auth/register/route";
import * as login from "@/app/api/v1/auth/login/route";
import * as me from "@/app/api/v1/users/me/route";
import * as rates from "@/app/api/v1/rates/route";
import * as withdrawals from "@/app/api/v1/withdrawals/route";
import * as cryptoOrder from "@/app/api/v1/crypto/orders/[id]/route";
import * as giftOrders from "@/app/api/v1/giftcards/orders/route";
import * as walletTx from "@/app/api/v1/wallets/transactions/route";
import * as webhooks from "@/app/api/v1/webhooks/[provider]/route";
import { balanceOf, makeCustomer, makeSellOrder, settle, TEST_PIN } from "../helpers/fixtures";

type Handler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

let ipSeq = 1;
/** Calls a route handler the way Next does. Each call gets its own client IP so rate limits do not interfere. */
async function call<P = Record<string, never>>(
  handler: Handler<P>,
  opts: { method?: string; path?: string; token?: string; body?: unknown; key?: string; params?: P } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.9.0.${ipSeq++ % 250}` };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.key) headers["idempotency-key"] = opts.key;
  const res = await handler(
    new Request(`http://api.test${opts.path ?? "/api/v1/x"}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    { params: Promise.resolve(opts.params ?? ({} as P)) },
  );
  // Response bodies are asserted field by field below, so the test reads them as loose JSON.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, headers: res.headers, json: (await res.json()) as Record<string, any> };
}

async function signedInCustomer(balanceNgn = 0) {
  const customer = await makeCustomer({ balanceNgn });
  const row = await prisma.user.findUniqueOrThrow({ where: { id: customer.id } });
  const token = await createSession(
    { id: row.id, email: row.email, fullName: row.fullName, phone: row.phone, role: row.role },
    { setCookie: false },
  );
  return { ...customer, token };
}

const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

describe("v1 conventions", () => {
  it("wraps success in { data } and tags every response with a request id", async () => {
    const res = await call(rates.GET, { path: "/api/v1/rates" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.data)).toBe(true);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 401 with { error: { code, message } } when nobody is signed in", async () => {
    const res = await call(me.GET, { path: "/api/v1/users/me" });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });

  it("rejects a body that is not a JSON object", async () => {
    const { token } = await signedInCustomer();
    const res = await call(withdrawals.POST, { method: "POST", token, key: `k-${uniq()}`, body: [1, 2, 3] });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("bad_request");
  });
});

describe("v1 auth", () => {
  it("registers, signs in, and reads the profile with the returned token", async () => {
    const id = uniq();
    const account = {
      fullName: "Chidi Test",
      email: `chidi-${id}@example.test`,
      phone: `0803${String(Date.now()).slice(-7)}`,
      password: "Str0ng!Passw0rd#2026",
    };
    const created = await call(register.POST, { method: "POST", body: account });
    expect(created.status).toBe(201);
    expect(created.json.data.token).toBeTruthy();
    expect(created.json.data.user.email).toBe(account.email);

    const signedIn = await call(login.POST, { method: "POST", body: { email: account.email, password: account.password } });
    expect(signedIn.status).toBe(200);

    const profile = await call(me.GET, { token: signedIn.json.data.token });
    expect(profile.status).toBe(200);
    expect(profile.json.data.user.email).toBe(account.email);
    expect(profile.json.data.wallet).toEqual({ balanceNgn: 0, hasPin: false });
    expect(JSON.stringify(profile.json)).not.toMatch(/passwordHash|transactionPinHash/);
  });

  it("gives every sign-in its own session, even several in the same second", async () => {
    const customer = await makeCustomer();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: customer.id } });
    const who = { id: row.id, email: row.email, fullName: row.fullName, phone: row.phone, role: row.role };

    // Back to back, with no delay: a double-tapped login, or register followed at once by login.
    const tokens = await Promise.all(Array.from({ length: 5 }, () => createSession(who, { setCookie: false })));

    expect(new Set(tokens).size).toBe(5);
    expect(await prisma.session.count({ where: { userId: customer.id } })).toBe(5);
    for (const token of tokens) expect((await call(me.GET, { token })).status).toBe(200);
  });

  it("refuses a wrong password without saying which part was wrong", async () => {
    const res = await call(login.POST, { method: "POST", body: { email: "nobody@example.test", password: "whatever-123" } });
    expect(res.status).toBe(401);
    expect(res.json.error.message).toBe("Invalid email or password.");
  });
});

describe("v1 idempotency", () => {
  const body = { amountNgn: 5_000, pin: TEST_PIN };

  it("requires an Idempotency-Key on a withdrawal and moves no money without one", async () => {
    const user = await signedInCustomer(20_000);
    const res = await call(withdrawals.POST, { method: "POST", token: user.token, body });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("idempotency_key_required");
    expect(await balanceOf(user.id)).toBe(20_000);
  });

  it("runs a retried withdrawal once and replays the first answer", async () => {
    const user = await signedInCustomer(20_000);
    const key = `wd-${uniq()}`;

    const first = await call(withdrawals.POST, { method: "POST", token: user.token, key, body });
    const retry = await call(withdrawals.POST, { method: "POST", token: user.token, key, body });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.headers.get("idempotent-replay")).toBe("true");
    expect(retry.json).toEqual(first.json);
    expect(await prisma.withdrawal.count({ where: { userId: user.id } })).toBe(1);
    expect(await balanceOf(user.id)).toBe(14_950);
    await settle();
  });

  it("runs a double-tap (two identical requests at once) only once", async () => {
    const user = await signedInCustomer(20_000);
    const key = `wd-${uniq()}`;

    const results = await Promise.all([
      call(withdrawals.POST, { method: "POST", token: user.token, key, body }),
      call(withdrawals.POST, { method: "POST", token: user.token, key, body }),
      call(withdrawals.POST, { method: "POST", token: user.token, key, body }),
    ]);

    // Each caller either got the result or was told the first request is still running.
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
    expect(await prisma.withdrawal.count({ where: { userId: user.id } })).toBe(1);
    expect(await balanceOf(user.id)).toBe(14_950);
    await settle();
  });

  it("rejects a key reused for a different request", async () => {
    const user = await signedInCustomer(20_000);
    const key = `wd-${uniq()}`;
    await call(withdrawals.POST, { method: "POST", token: user.token, key, body });
    const other = await call(withdrawals.POST, { method: "POST", token: user.token, key, body: { ...body, amountNgn: 9_000 } });

    expect(other.status).toBe(422);
    expect(other.json.error.code).toBe("idempotency_key_reused");
    expect(await prisma.withdrawal.count({ where: { userId: user.id } })).toBe(1);
    await settle();
  });

  it("keeps keys separate per user", async () => {
    const a = await signedInCustomer(20_000);
    const b = await signedInCustomer(20_000);
    const key = `shared-${uniq()}`;
    const ra = await call(withdrawals.POST, { method: "POST", token: a.token, key, body });
    const rb = await call(withdrawals.POST, { method: "POST", token: b.token, key, body });

    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    expect(rb.headers.get("idempotent-replay")).toBeNull();
    expect(rb.json.data.reference).not.toBe(ra.json.data.reference);
    await settle();
  });

  it("rejects a malformed key", async () => {
    const user = await signedInCustomer(20_000);
    const res = await call(withdrawals.POST, { method: "POST", token: user.token, key: "short", body });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("idempotency_key_invalid");
  });
});

describe("v1 data access", () => {
  it("does not let one customer read another customer's order", async () => {
    const owner = await signedInCustomer();
    const stranger = await signedInCustomer();
    const order = await makeSellOrder(owner.id);

    const mine = await call(cryptoOrder.GET, { token: owner.token, params: { id: order.id } });
    const theirs = await call(cryptoOrder.GET, { token: stranger.token, params: { id: order.id } });

    expect(mine.status).toBe(200);
    expect(mine.json.data.reference).toBe(order.reference);
    expect(theirs.status).toBe(404);
  });

  it("never returns a gift card code, encrypted or not", async () => {
    const user = await signedInCustomer();
    await prisma.giftCardOrder.create({
      data: {
        reference: `NXG-${uniq().toUpperCase()}`,
        userId: user.id,
        brand: "AMAZON",
        faceValueUsd: 100,
        rateNgn: 1_200,
        amountNgn: 120_000,
        cardCodeEncrypted: "SECRET-CIPHERTEXT",
        cardCodeIv: "SECRET-IV",
      },
    });

    const res = await call(giftOrders.GET, { token: user.token });
    expect(res.status).toBe(200);
    expect(res.json.data).toHaveLength(1);
    expect(res.json.data[0].amountNgn).toBe(120_000);
    expect(JSON.stringify(res.json)).not.toMatch(/SECRET|cardCode/);
  });

  it("pages through the wallet ledger with a cursor", async () => {
    const user = await signedInCustomer(1_000);
    const { creditWallet } = await import("@/lib/services/wallet");
    for (let i = 0; i < 4; i++) {
      await prisma.$transaction((tx) =>
        creditWallet(tx, { userId: user.id, amountNgn: 10 + i, reference: `page:${user.id}:${i}`, description: `Credit ${i}`, kind: "deposit" }),
      );
    }

    const page1 = await call(walletTx.GET, { token: user.token, path: "/api/v1/wallets/transactions?limit=3" });
    expect(page1.json.data.items).toHaveLength(3);
    expect(page1.json.data.nextCursor).toBeTruthy();

    const page2 = await call(walletTx.GET, {
      token: user.token,
      path: `/api/v1/wallets/transactions?limit=3&cursor=${page1.json.data.nextCursor}`,
    });
    expect(page2.json.data.items).toHaveLength(2);
    expect(page2.json.data.nextCursor).toBeNull();
    const ids = [...page1.json.data.items, ...page2.json.data.items].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(5);
  });
});

describe("v1 webhooks", () => {
  it("answers 404 for a provider it does not know", async () => {
    const res = await call(webhooks.POST, { method: "POST", body: {}, params: { provider: "nobody" } });
    expect(res.status).toBe(404);
  });

  it("does not accept an unsigned Paystack webhook", async () => {
    const before = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = "sk_test_unit_test_secret_key";
    try {
      const res = await call(webhooks.POST, {
        method: "POST",
        body: { event: "transfer.success", data: { transfer_code: "TRF_forged", reference: "nxp-NXW-FORGED" } },
        params: { provider: "paystack" },
      });
      expect(res.status).toBe(401);
    } finally {
      if (before === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = before;
    }
  });
});
