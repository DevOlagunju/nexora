/**
 * End-to-end money-flow check against a THROWAWAY database (never dev/prod).
 *   createdb -T nexora nexora_flow_check        (a copy of the dev database)
 *   DATABASE_URL=postgresql://.../nexora_flow_check npx tsx --conditions=react-server scripts/flow-check.mts
 * Needs the demo users (npm run db:seed-demo) in that copy.
 */
import "dotenv/config";

if (!/flow[-_]check/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Refusing to run: DATABASE_URL must point at a flow-check copy.");
}

const { prisma } = await import("../src/lib/db");
const wallet = await import("../src/lib/services/wallet");
const desk = await import("../src/lib/services/desk");
const trades = await import("../src/lib/services/trades");
const alerts = await import("../src/lib/services/rate-alerts");
const payments = await import("../src/lib/services/payments");

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond || detail === undefined ? "" : `  -> ${JSON.stringify(detail)}`}`);
  if (!cond) failures++;
}
const ctx = { ip: "127.0.0.1" };
const balance = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id }, select: { walletBalanceNgn: true } })).walletBalanceNgn;

const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
const demo = await prisma.user.findUniqueOrThrow({ where: { email: "demo@nexora.local" } });
const pending = await prisma.user.findUniqueOrThrow({ where: { email: "pending@nexora.local" } });
const actor = { id: demo.id, email: demo.email };
await prisma.user.update({ where: { id: demo.id }, data: { transactionPinHash: null } });
// The ledger is immutable, so the wallet is emptied by posting an adjustment, not by deleting history.
const opening = await balance(demo.id);
if (opening > 0) {
  await prisma.$transaction((tx) =>
    wallet.debitWallet(tx, {
      userId: demo.id,
      amountNgn: opening,
      reference: `flow-check:reset:${Date.now()}`,
      description: "Flow-check reset",
      kind: "adjustment",
    }),
  );
}

// 1. Wallet-payout gift sale credits exactly once
const gift = await trades.createGiftCardSellOrder(
  actor,
  { brand: "APPLE", country: "USA", faceValueUsd: 50, cardCode: "FLOW-TEST-1234", payoutMethod: "WALLET" },
  ctx,
);
check("gift order created", gift.ok, gift);
if (!gift.ok) process.exit(1);
const giftId = gift.data.id;
const amount = gift.data.amountNgn;
const done = await desk.updateOrderStatus(admin, "gift", { id: giftId, status: "COMPLETED" });
check("desk completes wallet order", done.ok, done);
check("wallet credited", (await balance(demo.id)) === amount, await balance(demo.id));
const again = await desk.updateOrderStatus(admin, "gift", { id: giftId, status: "COMPLETED", adminNote: "resave" });
check("re-save is allowed", again.ok, again);
check("no double credit", (await balance(demo.id)) === amount, await balance(demo.id));

// 2. PIN + withdrawal + cancel
const weak = await wallet.setTransactionPin(actor, { password: "DemoPass2026", pin: "1234", confirmPin: "1234" }, ctx);
check("weak PIN rejected", !weak.ok);
const badPw = await wallet.setTransactionPin(actor, { password: "nope", pin: "2580", confirmPin: "2580" }, ctx);
check("wrong account password rejected", !badPw.ok);
const pin = await wallet.setTransactionPin(actor, { password: "DemoPass2026", pin: "2580", confirmPin: "2580" }, ctx);
check("PIN set", pin.ok, pin);
const wrongPin = await wallet.requestWithdrawal(actor, { amountNgn: 5_000, pin: "9999" }, ctx);
check("wrong PIN refused", !wrongPin.ok && wrongPin.status === 401, wrongPin);
const tooMuch = await wallet.requestWithdrawal(actor, { amountNgn: amount, pin: "2580" }, ctx);
check("amount + fee over balance refused", !tooMuch.ok, tooMuch);
const wd = await wallet.requestWithdrawal(actor, { amountNgn: 5_000, pin: "2580" }, ctx);
check("withdrawal requested", wd.ok, wd);
check("balance debited amount + fee", (await balance(demo.id)) === amount - 5_050, await balance(demo.id));
const w1 = await prisma.withdrawal.findFirstOrThrow({ where: { userId: demo.id }, orderBy: { createdAt: "desc" } });
const cancel = await wallet.cancelWithdrawal(actor, { id: w1.id });
check("customer cancel refunds", cancel.ok && (await balance(demo.id)) === amount, await balance(demo.id));
const cancelTwice = await wallet.cancelWithdrawal(actor, { id: w1.id });
check("second cancel refused", !cancelTwice.ok);

// 3. Desk reject refunds; mark-paid closes
await wallet.requestWithdrawal(actor, { amountNgn: 3_000, pin: "2580" }, ctx);
const w2 = await prisma.withdrawal.findFirstOrThrow({ where: { userId: demo.id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
const rej = await wallet.processWithdrawal(admin, { id: w2.id, action: "reject", note: "Name mismatch" });
check("desk reject refunds", rej.ok && (await balance(demo.id)) === amount, rej);
await wallet.requestWithdrawal(actor, { amountNgn: 2_000, pin: "2580" }, ctx);
const w3 = await prisma.withdrawal.findFirstOrThrow({ where: { userId: demo.id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
const paid = await wallet.processWithdrawal(admin, { id: w3.id, action: "mark-paid", payoutRef: "GTB-123" });
check("desk mark paid", paid.ok, paid);
const rejPaid = await wallet.processWithdrawal(admin, { id: w3.id, action: "reject", note: "late" });
check("cannot reject a paid withdrawal", !rejPaid.ok);
const afterPaid = await balance(demo.id);
check("balance after paid withdrawal", afterPaid === amount - 2_050, afterPaid);

// 4. Buy crypto from wallet, desk rejects -> refund
const buy = await trades.createCryptoBuyOrder(
  actor,
  { symbol: "USDT", amountCrypto: 10, userReceiveAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", payFrom: "WALLET" },
  ctx,
);
check("wallet-paid buy created", buy.ok, buy);
if (buy.ok) {
  check("buy goes straight to review", buy.data.order.status === "UNDER_REVIEW");
  check("wallet debited for buy", (await balance(demo.id)) === Math.round((afterPaid - buy.data.order.amountNgn) * 100) / 100);
  const r = await desk.updateOrderStatus(admin, "crypto", { id: buy.data.order.id, status: "REJECTED", adminNote: "test" });
  check("rejecting wallet buy refunds", r.ok && (await balance(demo.id)) === afterPaid, r);
  const reopen = await desk.updateOrderStatus(admin, "crypto", { id: buy.data.order.id, status: "UNDER_REVIEW" });
  check("refunded wallet buy cannot be reopened", !reopen.ok);
}
const huge = await trades.createCryptoBuyOrder(
  actor,
  { symbol: "USDT", amountCrypto: 4_000, userReceiveAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", payFrom: "WALLET" },
  ctx,
);
check("wallet buy over balance refused", !huge.ok, huge);

// 5. Ledger integrity: balance == sum(credits) - sum(debits)
const entries = await prisma.walletEntry.findMany({ where: { userId: demo.id } });
const ledger = entries.reduce((s, e) => s + (e.direction === "CREDIT" ? e.amountNgn : -e.amountNgn), 0);
check("ledger reconciles with balance", Math.abs(ledger - (await balance(demo.id))) < 0.001, { ledger, bal: await balance(demo.id) });

// 6. Referral bonus once threshold reached
await prisma.user.update({ where: { id: pending.id }, data: { referredById: demo.id } });
await prisma.kycProfile.update({ where: { userId: pending.id }, data: { status: "APPROVED" } });
const before = await balance(demo.id);
const pg = await trades.createGiftCardSellOrder(
  { id: pending.id, email: pending.email },
  { brand: "AMAZON", country: "USA", faceValueUsd: 40, cardCode: "FLOW-REF-5678", payoutMethod: "WALLET" },
  ctx,
);
if (pg.ok) {
  await desk.updateOrderStatus(admin, "gift", { id: pg.data.id, status: "COMPLETED" });
  await new Promise((r) => setTimeout(r, 500));
  await wallet.maybeAwardReferral(pending.id);
  const bonus = (await balance(demo.id)) - before;
  check("referrer paid bonus exactly once", bonus === 1_000, bonus);
}

// 7. Rate alert fires once when the desk rate crosses it
const usdt = await prisma.rate.findFirstOrThrow({ where: { kind: "CRYPTO", symbol: "USDT" } });
const al = await alerts.createRateAlert(actor, { rateId: usdt.id, side: "SELL", direction: "ABOVE", targetNgn: usdt.sellRateNgn + 10 });
check("alert created", al.ok, al);
await desk.updateRate(admin, { id: usdt.id, sellRateNgn: usdt.sellRateNgn + 20, buyRateNgn: usdt.buyRateNgn, isActive: true });
const fired = await prisma.rateAlert.findFirst({ where: { userId: demo.id, isActive: false } });
check("alert triggered", !!fired?.triggeredAt);
check("second check fires nothing", (await alerts.checkRateAlerts()) === 0);
const notes = await prisma.notification.count({ where: { userId: demo.id } });
check("in-app notifications written", notes >= 5, notes);

// 8. Instant payment confirmation (test gateway): top-up, card-paid buy, idempotency, edge cases
const payCtx = { ip: "127.0.0.1", origin: "http://localhost:3000" };
const b0 = await balance(demo.id);
const top = await payments.startWalletFunding(actor, { amountNgn: 7_500 }, payCtx);
check("top-up checkout opened", top.ok && top.data.authorizationUrl.includes("/pay/test/"), top);
if (top.ok) {
  const pend = await payments.settlePayment(top.data.reference, "flow");
  check("unpaid checkout stays pending, no credit", pend?.status === "PENDING" && (await balance(demo.id)) === b0, pend);
  const paid = await payments.completeTestPayment(top.data.reference, "paid");
  check("payment confirmed instantly", paid?.status === "SUCCESS", paid);
  check("wallet credited by top-up", (await balance(demo.id)) === b0 + 7_500, await balance(demo.id));
  await Promise.all([1, 2, 3].map(() => payments.settlePayment(top.data.reference, "flow-dup")));
  check("webhook/return/poll repeats don't double-credit", (await balance(demo.id)) === b0 + 7_500, await balance(demo.id));
}

const tooSmall = await payments.startWalletFunding(actor, { amountNgn: 50 }, payCtx);
check("top-up below minimum refused", !tooSmall.ok);

const RECEIVE = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const b1 = await balance(demo.id);
const cardBuy = await trades.createCryptoBuyOrder(actor, { symbol: "USDT", amountCrypto: 10, userReceiveAddress: RECEIVE, payFrom: "CARD" }, ctx);
check("card buy order created unfunded", cardBuy.ok && cardBuy.data.order.status === "AWAITING_DEPOSIT", cardBuy);
if (cardBuy.ok) {
  const co = await payments.startBuyOrderCheckout(actor, { orderId: cardBuy.data.order.id }, payCtx);
  check("buy checkout opened", co.ok, co);
  if (co.ok) {
    const res = await payments.completeTestPayment(co.data.reference, "paid");
    const o = await prisma.cryptoOrder.findUniqueOrThrow({ where: { id: cardBuy.data.order.id } });
    check("paid buy order goes straight to the desk", res?.orderFunded === true && o.status === "UNDER_REVIEW", { res, status: o.status });
    check("card buy nets to zero in wallet", (await balance(demo.id)) === b1, await balance(demo.id));
    const rej = await desk.updateOrderStatus(admin, "crypto", { id: o.id, status: "REJECTED", adminNote: "flow" });
    check("desk rejection refunds card payment to wallet", rej.ok && (await balance(demo.id)) === b1 + o.amountNgn, await balance(demo.id));
  }
}

const late = await trades.createCryptoBuyOrder(actor, { symbol: "USDT", amountCrypto: 10, userReceiveAddress: RECEIVE, payFrom: "CARD" }, ctx);
if (late.ok) {
  const co = await payments.startBuyOrderCheckout(actor, { orderId: late.data.order.id }, payCtx);
  await trades.cancelUnfundedOrder(actor, { id: late.data.order.id }, ctx);
  const b2 = await balance(demo.id);
  const res = co.ok ? await payments.completeTestPayment(co.data.reference, "paid") : null;
  const o = await prisma.cryptoOrder.findUniqueOrThrow({ where: { id: late.data.order.id } });
  check(
    "payment for a cancelled order lands in wallet, order stays cancelled",
    res?.status === "SUCCESS" && !res.orderFunded && o.status === "CANCELLED" && (await balance(demo.id)) === b2 + late.data.order.amountNgn,
    { res, status: o.status },
  );
}

const ab = await payments.startWalletFunding(actor, { amountNgn: 1_000 }, payCtx);
if (ab.ok) {
  const b3 = await balance(demo.id);
  const res = await payments.completeTestPayment(ab.data.reference, "cancelled");
  check("cancelled checkout credits nothing", res?.status === "ABANDONED" && (await balance(demo.id)) === b3, res);
}

const forged = await trades.createCryptoBuyOrder(
  actor,
  { symbol: "USDT", amountCrypto: 10, userReceiveAddress: RECEIVE, payFrom: "BANK", paymentRef: "wallet:FAKE" },
  ctx,
);
check("customer can't forge a wallet: payment ref", !forged.ok, forged);
const ledgerAfter = await prisma.walletEntry.findMany({ where: { userId: demo.id } });
const net = ledgerAfter.reduce((s, e) => s + (e.direction === "CREDIT" ? e.amountNgn : -e.amountNgn), 0);
check("ledger still reconciles after payments", Math.abs(net - (await balance(demo.id))) < 0.01, { net, bal: await balance(demo.id) });

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
await prisma.$disconnect();
process.exit(failures ? 1 : 0);
