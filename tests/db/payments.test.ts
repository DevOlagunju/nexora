import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { completeTestPayment, settlePayment } from "@/lib/services/payments";
import { balanceOf, ledgerBalanceOf, makeCustomer, settle } from "../helpers/fixtures";

/**
 * Incoming payments, using the non-production test gateway (the same code path as
 * Paystack, minus the network). Credits must follow the provider's verified result only.
 */

let n = 0;
async function makePayment(userId: string, amountNgn: number, extra: { purpose?: "WALLET_FUNDING" | "CRYPTO_BUY"; orderId?: string } = {}) {
  return prisma.payment.create({
    data: {
      reference: `NXF-TEST-${Date.now().toString(36)}-${n++}`,
      userId,
      purpose: extra.purpose ?? "WALLET_FUNDING",
      orderId: extra.orderId,
      amountNgn,
      provider: "test",
    },
  });
}

describe("payment settlement", () => {
  it("does not credit a payment the provider has not confirmed", async () => {
    const user = await makeCustomer();
    const p = await makePayment(user.id, 5_000);

    const s = await settlePayment(p.reference, "test");
    expect(s?.status).toBe("PENDING");
    expect(await balanceOf(user.id)).toBe(0);
  });

  it("credits a confirmed payment exactly once, however many times it is settled", async () => {
    const user = await makeCustomer();
    const p = await makePayment(user.id, 5_000);

    await completeTestPayment(p.reference, "paid");
    // Webhook, return page and reconcile sweep can all land on the same payment.
    await Promise.all([settlePayment(p.reference, "webhook"), settlePayment(p.reference, "return"), settlePayment(p.reference, "reconcile")]);

    expect(await balanceOf(user.id)).toBe(5_000);
    expect(await ledgerBalanceOf(user.id)).toBe(5_000);
    expect(await prisma.walletEntry.count({ where: { reference: `fund:${p.reference}` } })).toBe(1);
    await settle();
  });

  it("does not credit a cancelled checkout", async () => {
    const user = await makeCustomer();
    const p = await makePayment(user.id, 5_000);

    const s = await completeTestPayment(p.reference, "cancelled");
    expect(s?.status).toBe("ABANDONED");
    expect(await balanceOf(user.id)).toBe(0);
  });

  it("funds a card-paid buy order: credit and debit net to zero and the order moves to review", async () => {
    const user = await makeCustomer();
    const order = await prisma.cryptoOrder.create({
      data: {
        reference: `NXB-TEST-${Date.now().toString(36)}-${n++}`,
        userId: user.id,
        symbol: "USDT",
        network: "TRC20",
        side: "BUY",
        amountCrypto: 10,
        rateNgn: 1_520,
        amountNgn: 15_200,
        userReceiveAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
        status: "AWAITING_DEPOSIT",
      },
    });
    const p = await makePayment(user.id, 15_200, { purpose: "CRYPTO_BUY", orderId: order.id });

    const s = await completeTestPayment(p.reference, "paid");
    expect(s?.orderFunded).toBe(true);

    const funded = await prisma.cryptoOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(funded.status).toBe("UNDER_REVIEW");
    expect(funded.paymentRef).toBe(`wallet:${order.reference}`);
    expect(await balanceOf(user.id)).toBe(0);
    expect(await ledgerBalanceOf(user.id)).toBe(0);
    await settle();
  });

  it("keeps the money in the wallet when the order was cancelled before the payment landed", async () => {
    const user = await makeCustomer();
    const order = await prisma.cryptoOrder.create({
      data: {
        reference: `NXB-TEST-${Date.now().toString(36)}-${n++}`,
        userId: user.id,
        symbol: "USDT",
        network: "TRC20",
        side: "BUY",
        amountCrypto: 10,
        rateNgn: 1_520,
        amountNgn: 15_200,
        status: "CANCELLED",
      },
    });
    const p = await makePayment(user.id, 15_200, { purpose: "CRYPTO_BUY", orderId: order.id });

    const s = await completeTestPayment(p.reference, "paid");
    expect(s?.status).toBe("SUCCESS");
    expect(s?.orderFunded).toBe(false);
    expect(await balanceOf(user.id)).toBe(15_200);
    expect((await prisma.cryptoOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    await settle();
  });
});
