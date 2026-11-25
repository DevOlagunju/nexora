import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { addGiftCardRate, updateGiftCardRate } from "@/lib/services/giftcards";
import { createGiftCardSellOrder } from "@/lib/services/trades";
import { createQuote } from "@/lib/services/quotes";
import { updateRate } from "@/lib/services/desk";
import * as mobile from "@/app/api/mobile/route";
import * as brandsRoute from "@/app/api/v1/giftcards/brands/route";
import { makeAdmin, makeCustomer, settle } from "../helpers/fixtures";

const ctx = { ip: "127.0.0.1" };
const card = (over: Record<string, unknown> = {}) => ({ brand: "AMAZON", faceValueUsd: 100, cardCode: `CODE-${Math.random().toString(36).slice(2, 10)}`, payoutMethod: "WALLET", ...over });
const variant = (country: string, cardType: "ECODE" | "PHYSICAL") =>
  prisma.giftCardRate.findUniqueOrThrow({ where: { brand_country_cardType: { brand: "AMAZON", country, cardType } } });
const brandRate = () => prisma.rate.findUniqueOrThrow({ where: { kind_symbol: { kind: "GIFTCARD", symbol: "AMAZON" } } });

beforeAll(async () => {
  await prisma.rate.create({
    data: { kind: "GIFTCARD", symbol: "AMAZON", displayName: "Amazon", sellRateNgn: 1200, buyRateNgn: 0, minAmount: 25, maxAmount: 500 },
  });
  await prisma.giftCardRate.createMany({
    data: [
      { brand: "AMAZON", country: "US", cardType: "ECODE", rateNgn: 1200, minFaceUsd: 25, maxFaceUsd: 500, isDefault: true },
      { brand: "AMAZON", country: "US", cardType: "PHYSICAL", rateNgn: 1150, minFaceUsd: 25, maxFaceUsd: 500 },
      { brand: "AMAZON", country: "GB", cardType: "ECODE", rateNgn: 1080, minFaceUsd: 25, maxFaceUsd: 200, denominations: "25,50,100" },
    ],
  });
});

describe("selling a gift card", () => {
  it("prices it by its country and card type", async () => {
    const user = await makeCustomer();
    const res = await createGiftCardSellOrder(user, card({ country: "US", cardType: "PHYSICAL" }), ctx);
    expect(res.ok).toBe(true);
    const order = await prisma.giftCardOrder.findFirstOrThrow({ where: { userId: user.id } });
    expect(order).toMatchObject({ country: "US", cardType: "PHYSICAL", rateNgn: 1150, amountNgn: 115_000 });
    await settle();
  });

  it("still works for the current mobile app, which sends a country name and no card type", async () => {
    const user = await makeCustomer();
    // Exactly what nexora-mobile sends today.
    const res = await createGiftCardSellOrder(user, card({ country: "UK", faceValueUsd: 50 }), ctx);
    expect(res.ok).toBe(true);
    const order = await prisma.giftCardOrder.findFirstOrThrow({ where: { userId: user.id } });
    expect(order).toMatchObject({ country: "GB", cardType: "ECODE", rateNgn: 1080, amountNgn: 54_000 });

    const noCountry = await createGiftCardSellOrder(user, card(), ctx);
    expect(noCountry.ok).toBe(true);
    expect(await prisma.giftCardOrder.findFirstOrThrow({ where: { userId: user.id, country: "US" } })).toMatchObject({ cardType: "ECODE", rateNgn: 1200 });
    await settle();
  });

  it("refuses a country the desk is not buying, and says which ones it is", async () => {
    const user = await makeCustomer();
    const res = await createGiftCardSellOrder(user, card({ country: "Germany" }), ctx);
    expect(res).toMatchObject({ ok: false, status: 422 });
    expect(!res.ok && res.error).toBe("We're not buying Amazon gift cards from Germany right now. We buy: USA, UK.");
    expect(await prisma.giftCardOrder.count({ where: { userId: user.id } })).toBe(0);
  });

  it("enforces a variant's accepted values and limits", async () => {
    const user = await makeCustomer();
    expect(await createGiftCardSellOrder(user, card({ country: "GB", faceValueUsd: 75 }), ctx)).toMatchObject({ ok: false, status: 422 });
    expect(await createGiftCardSellOrder(user, card({ country: "US", faceValueUsd: 501 }), ctx)).toMatchObject({ ok: false, status: 422 });
    expect(await prisma.giftCardOrder.count({ where: { userId: user.id } })).toBe(0);
  });

  it("stops every variant when the brand is switched off", async () => {
    const admin = await makeAdmin();
    const user = await makeCustomer();
    const brand = await brandRate();
    await updateRate(admin, { id: brand.id, isActive: false });
    try {
      expect(await createGiftCardSellOrder(user, card({ country: "US" }), ctx)).toMatchObject({ ok: false });
    } finally {
      await updateRate(admin, { id: brand.id, isActive: true });
    }
  });
});

describe("quoting a gift card", () => {
  it("locks the variant's price, and the order keeps the quoted card even if the request says otherwise", async () => {
    const user = await makeCustomer();
    const quote = await createQuote(user, { kind: "GIFTCARD", side: "SELL", symbol: "AMAZON", amount: 100, country: "USA", cardType: "physical" }, ctx);
    if (!quote.ok) throw new Error(quote.error);
    expect(quote.data).toMatchObject({ country: "US", cardType: "PHYSICAL", rateNgn: 1150, amountNgn: 115_000 });

    const order = await createGiftCardSellOrder(user, card({ quoteId: quote.data.id, country: "GB", cardType: "ECODE", faceValueUsd: 25 }), ctx);
    expect(order.ok).toBe(true);
    expect(await prisma.giftCardOrder.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({
      country: "US",
      cardType: "PHYSICAL",
      faceValueUsd: 100,
      amountNgn: 115_000,
    });
    await settle();
  });

  it("refuses to quote a value the variant does not accept", async () => {
    const user = await makeCustomer();
    expect(await createQuote(user, { kind: "GIFTCARD", side: "SELL", symbol: "AMAZON", amount: 60, country: "GB" }, ctx)).toMatchObject({ ok: false, status: 422 });
  });
});

describe("desk changes", () => {
  const form = (v: { id: string; rateNgn: number; minFaceUsd: number; maxFaceUsd: number | null }, over: Record<string, unknown> = {}) => ({
    id: v.id,
    rateNgn: String(v.rateNgn),
    minFaceUsd: String(v.minFaceUsd),
    maxFaceUsd: v.maxFaceUsd === null ? "" : String(v.maxFaceUsd),
    denominations: "",
    isActive: "on",
    isDefault: "",
    ...over,
  });

  it("keeps the brand's headline rate equal to its default variant", async () => {
    const admin = await makeAdmin();
    const def = await variant("US", "ECODE");
    expect((await updateGiftCardRate(admin, form(def, { rateNgn: "1234.5", maxFaceUsd: "800", isDefault: "on" }))).ok).toBe(true);
    expect(await brandRate()).toMatchObject({ sellRateNgn: 1234.5, minAmount: 25, maxAmount: 800 });

    // A non-default variant's price does not move the headline.
    const phys = await variant("US", "PHYSICAL");
    expect((await updateGiftCardRate(admin, form(phys, { rateNgn: "999" }))).ok).toBe(true);
    expect((await brandRate()).sellRateNgn).toBe(1234.5);
  });

  it("moves the default rather than leaving none, and the headline follows", async () => {
    const admin = await makeAdmin();
    expect(await updateGiftCardRate(admin, form(await variant("US", "ECODE")))).toMatchObject({ ok: false, status: 409 });

    const gb = await variant("GB", "ECODE");
    expect((await updateGiftCardRate(admin, form(gb, { isDefault: "on", denominations: "25,50,100" }))).ok).toBe(true);
    expect(await prisma.giftCardRate.count({ where: { brand: "AMAZON", isDefault: true } })).toBe(1);
    expect((await brandRate()).sellRateNgn).toBe(1080);

    const us = await variant("US", "ECODE");
    expect((await updateGiftCardRate(admin, form(us, { isDefault: "on" }))).ok).toBe(true);
    expect((await brandRate()).sellRateNgn).toBe(us.rateNgn);
  });

  it("will not switch off the default, or save a bad list or range", async () => {
    const admin = await makeAdmin();
    const us = await variant("US", "ECODE");
    expect(await updateGiftCardRate(admin, form(us, { isDefault: "on", isActive: "" }))).toMatchObject({ ok: false });
    expect(await updateGiftCardRate(admin, form(us, { isDefault: "on", denominations: "25, lots" }))).toMatchObject({ ok: false, status: 422 });
    expect(await updateGiftCardRate(admin, form(us, { isDefault: "on", minFaceUsd: "100", maxFaceUsd: "50" }))).toMatchObject({ ok: false, status: 422 });
  });

  it("records the old and new price of every change", async () => {
    const admin = await makeAdmin();
    const phys = await variant("US", "PHYSICAL");
    await updateGiftCardRate(admin, form(phys, { rateNgn: "1111" }));
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { userId: admin.id, action: "admin.giftcard_rate_update" } });
    const meta = JSON.parse(audit.meta ?? "{}") as { from: { rateNgn: number }; to: { rateNgn: number } };
    expect([meta.from.rateNgn, meta.to.rateNgn]).toEqual([phys.rateNgn, 1111]);
  });

  it("adds a new country switched off, and refuses a duplicate", async () => {
    const admin = await makeAdmin();
    const res = await addGiftCardRate(admin, { brand: "amazon", country: "Australia", cardType: "ECODE", rateNgn: "1000", minFaceUsd: "25" });
    expect(res.ok).toBe(true);
    expect(await variant("AU", "ECODE")).toMatchObject({ isActive: false, isDefault: false, rateNgn: 1000, maxFaceUsd: null });
    expect(await addGiftCardRate(admin, { brand: "AMAZON", country: "AU", cardType: "ECODE", rateNgn: "1000", minFaceUsd: "25" })).toMatchObject({ ok: false, status: 409 });
    expect(await addGiftCardRate(admin, { brand: "AMAZON", country: "Narnia", cardType: "ECODE", rateNgn: "1000", minFaceUsd: "25" })).toMatchObject({ ok: false, status: 422 });
  });

  it("only switches a gift card brand on or off from the main rates list, never its price", async () => {
    const admin = await makeAdmin();
    const brand = await brandRate();
    const res = await updateRate(admin, { id: brand.id, sellRateNgn: 1, buyRateNgn: 1, isActive: true });
    expect(res.ok).toBe(true);
    expect((await brandRate()).sellRateNgn).toBe(brand.sellRateNgn);
  });
});

describe("what clients see", () => {
  it("v1 lists each brand's variants, with the default's rate at brand level", async () => {
    const res = await brandsRoute.GET(new Request("http://api.test/api/v1/giftcards/brands"), { params: Promise.resolve({}) });
    const json = (await res.json()) as { data: Array<{ brand: string; sellRateNgn: number; variants: Array<{ country: string; cardType: string; rateNgn: number; isDefault: boolean; denominations: number[] }> }> };
    const amazon = json.data.find((b) => b.brand === "AMAZON")!;
    const def = amazon.variants.find((x) => x.isDefault)!;

    expect(amazon.sellRateNgn).toBe(def.rateNgn);
    expect(amazon.variants.find((x) => x.country === "GB")).toMatchObject({ cardType: "ECODE", denominations: [25, 50, 100] });
    // Switched-off variants are not offered.
    expect(amazon.variants.find((x) => x.country === "AU")).toBeUndefined();
  });

  it("the current mobile app still gets one rate per brand, equal to the default variant", async () => {
    const user = await makeCustomer();
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const token = await createSession({ id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, role: u.role }, { setCookie: false });
    const res = await mobile.GET(new Request("http://api.test/api/mobile", { headers: { authorization: `Bearer ${token}` } }));
    const json = (await res.json()) as { rates: Array<{ kind: string; symbol: string; sellRateNgn: number }> };
    const amazon = json.rates.filter((r) => r.kind === "GIFTCARD" && r.symbol === "AMAZON");

    expect(amazon).toHaveLength(1);
    expect(amazon[0].sellRateNgn).toBe((await prisma.giftCardRate.findFirstOrThrow({ where: { brand: "AMAZON", isDefault: true } })).rateNgn);
  });
});
