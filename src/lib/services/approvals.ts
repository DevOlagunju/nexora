import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/security";
import { notifyAdmin } from "@/lib/notify";
import { errorMessage, log } from "@/lib/log";
import { roundNgn } from "@/lib/money";
import { can, type Permission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth";
import { addAssetNetwork, updateAssetNetwork } from "@/lib/services/assets";
import { creditWallet, debitWallet } from "@/lib/services/wallet";
import { pushNotification } from "@/lib/services/notifications";
import { fail, ok, type ServiceResult } from "@/lib/services/result";

/**
 * Two-person approval (maker-checker, specification section 13). A sensitive change is requested by
 * one staff member and applied only when a different staff member with the same permission approves
 * it. The database refuses a decision by the person who asked.
 *
 * Each action knows how to check a request without applying it (so nothing invalid waits for
 * approval), how to tell whether its target changed since the request, and how to apply it.
 */

type Staff = Pick<SessionUser, "id" | "role" | "staffRole">;
type Prepared = { payload: unknown; summary: string; targetVersion: string | null };

type ActionDef = {
  permission: Permission;
  label: string;
  prepare(staff: Staff, input: unknown): Promise<ServiceResult<Prepared>>;
  /** The target's current version, compared with the one recorded at request time. */
  currentVersion(payload: unknown): Promise<string | null>;
  apply(approver: Staff, payload: unknown, requestId: string): Promise<ServiceResult<string>>;
};

const REQUEST_LIFETIME_MS = 72 * 3_600_000;

/** Amounts to the kobo: an approver must see exactly what will be posted, not a rounded figure. */
const formatNgn = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

// ---------------------------------------------------------------- wallet adjustments

export const ADJUSTMENT_REASONS = {
  FAILED_PAYOUT: "Payout failed outside the system",
  DUPLICATE_CHARGE: "Customer charged twice",
  MISSED_CREDIT: "Credit that never reached the wallet",
  GOODWILL: "Goodwill or compensation",
  CORRECTION: "Correcting a desk error",
} as const;

const adjustmentSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter the customer's email."),
  direction: z.enum(["CREDIT", "DEBIT"], { error: "Choose credit or debit." }),
  amountNgn: z.coerce.number().positive("Enter an amount above 0.").max(10_000_000, "Adjustments above ₦10,000,000 must go through finance directly."),
  reasonCode: z.enum(Object.keys(ADJUSTMENT_REASONS) as [keyof typeof ADJUSTMENT_REASONS, ...Array<keyof typeof ADJUSTMENT_REASONS>], { error: "Choose a reason." }),
  note: z.string().trim().min(10, "Explain the adjustment (at least 10 characters).").max(500),
});
type AdjustmentPayload = { userId: string; email: string; direction: "CREDIT" | "DEBIT"; amountNgn: number; reasonCode: keyof typeof ADJUSTMENT_REASONS; note: string };

const ledgerAdjustment: ActionDef = {
  permission: "ledger.adjust",
  label: "Wallet adjustment",
  async prepare(_staff, input) {
    const parsed = adjustmentSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
    const d = parsed.data;
    const user = await prisma.user.findUnique({ where: { email: d.email }, select: { id: true, fullName: true, walletBalanceNgn: true } });
    if (!user) return fail("No customer with that email.", 404);
    const amountNgn = roundNgn(d.amountNgn);
    if (d.direction === "DEBIT" && amountNgn > user.walletBalanceNgn) {
      return fail(`The wallet holds ${formatNgn(user.walletBalanceNgn)}; a debit cannot take it below zero.`, 422);
    }
    const payload: AdjustmentPayload = { userId: user.id, email: d.email, direction: d.direction, amountNgn, reasonCode: d.reasonCode, note: d.note };
    return ok({
      payload,
      summary: `${d.direction === "CREDIT" ? "Credit" : "Debit"} ${formatNgn(amountNgn)} ${d.direction === "CREDIT" ? "to" : "from"} ${user.fullName} (${d.email}). Reason: ${ADJUSTMENT_REASONS[d.reasonCode]}. ${d.note}`,
      targetVersion: null,
    });
  },
  async currentVersion() {
    return null;
  },
  async apply(approver, raw, requestId) {
    const p = raw as AdjustmentPayload;
    const movement = {
      userId: p.userId,
      amountNgn: p.amountNgn,
      // One adjustment per approved request: approving twice cannot post twice.
      reference: `adj:${requestId}`,
      description: `Adjustment: ${ADJUSTMENT_REASONS[p.reasonCode]}`,
      kind: "adjustment" as const,
      source: `approval:${requestId}`,
    };
    const done = await prisma.$transaction((tx) => (p.direction === "CREDIT" ? creditWallet(tx, movement) : debitWallet(tx, movement)));
    if (!done) {
      return p.direction === "DEBIT"
        ? fail("The wallet no longer holds enough for this debit. Nothing was posted.", 409)
        : fail("This adjustment was already posted.", 409);
    }
    void pushNotification(p.userId, {
      title: p.direction === "CREDIT" ? `${formatNgn(p.amountNgn)} added to your wallet` : `${formatNgn(p.amountNgn)} taken from your wallet`,
      body: `${ADJUSTMENT_REASONS[p.reasonCode]}. Contact support if you have questions.`,
      href: "/dashboard/wallet",
    });
    return ok(`${p.direction === "CREDIT" ? "Credited" : "Debited"} ${formatNgn(p.amountNgn)} ${p.direction === "CREDIT" ? "to" : "from"} ${p.email}.`);
  },
};

// ---------------------------------------------------------------- deposit addresses and networks

const assetNetworkUpdate: ActionDef = {
  permission: "wallets.manage",
  label: "Asset network change",
  async prepare(staff, input) {
    const checked = await updateAssetNetwork(staff, input, { dryRun: true });
    if (!checked.ok) return checked;
    return ok({ payload: input, summary: checked.data!.summary, targetVersion: checked.data!.targetVersion });
  },
  async currentVersion(payload) {
    const id = (payload as { id?: string }).id;
    const row = id ? await prisma.assetNetwork.findUnique({ where: { id }, select: { updatedAt: true } }) : null;
    return row?.updatedAt.toISOString() ?? "missing";
  },
  async apply(approver, payload) {
    const res = await updateAssetNetwork(approver, payload);
    return res.ok ? ok(res.message ?? "Applied.") : res;
  },
};

const assetNetworkAdd: ActionDef = {
  permission: "wallets.manage",
  label: "New asset network",
  async prepare(staff, input) {
    const checked = await addAssetNetwork(staff, input, { dryRun: true });
    if (!checked.ok) return checked;
    return ok({ payload: input, summary: checked.data!.summary, targetVersion: checked.data!.targetVersion });
  },
  async currentVersion() {
    return "new";
  },
  async apply(approver, payload) {
    const res = await addAssetNetwork(approver, payload);
    return res.ok ? ok(res.message ?? "Applied.") : res;
  },
};

export const APPROVAL_ACTIONS = {
  "ledger.adjustment": ledgerAdjustment,
  "asset_network.update": assetNetworkUpdate,
  "asset_network.add": assetNetworkAdd,
} as const;
export type ApprovalAction = keyof typeof APPROVAL_ACTIONS;

// ---------------------------------------------------------------- the workflow

/** Records a request for a sensitive change. Nothing changes until someone else approves it. */
export async function requestApproval(
  staff: Staff,
  action: ApprovalAction,
  input: unknown,
  reason?: string,
): Promise<ServiceResult<{ id: string }>> {
  const def = APPROVAL_ACTIONS[action];
  if (!can(staff, def.permission)) return fail("Your role cannot request this change.", 403);
  const prepared = await def.prepare(staff, input);
  if (!prepared.ok) return prepared;

  const request = await prisma.approvalRequest.create({
    data: {
      action,
      payload: JSON.stringify(prepared.data.payload),
      summary: prepared.data.summary.slice(0, 1_000),
      targetVersion: prepared.data.targetVersion,
      reason: reason?.trim().slice(0, 500) || null,
      requestedById: staff.id,
      expiresAt: new Date(Date.now() + REQUEST_LIFETIME_MS),
    },
  });
  await writeAudit("approval.requested", { userId: staff.id, meta: { id: request.id, action, summary: request.summary } });
  void notifyAdmin("approval.requested", { id: request.id, action, summary: request.summary, requestedBy: staff.id });
  return ok({ id: request.id }, `Sent for approval: ${def.label.toLowerCase()}. Another staff member must approve it before it takes effect.`);
}

const decisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

/** Approves (and applies) or rejects a pending request. Never by the person who asked. */
export async function decideApproval(approver: Staff, input: unknown): Promise<ServiceResult<null>> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid input");
  const { id, decision } = parsed.data;
  const note = parsed.data.note || null;

  const request = await prisma.approvalRequest.findUnique({ where: { id } });
  if (!request) return fail("Request not found.", 404);
  const def = APPROVAL_ACTIONS[request.action as ApprovalAction];
  if (!def) return fail("Unknown kind of request.", 422);
  if (request.requestedById === approver.id) return fail("You cannot decide on your own request. Ask another staff member.", 403);
  if (!can(approver, def.permission)) return fail("Your role cannot approve this kind of change.", 403);
  if (request.status !== "PENDING") return fail(`This request is already ${request.status.toLowerCase()}.`, 409);
  if (request.expiresAt <= new Date()) {
    await prisma.approvalRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "EXPIRED" } });
    return fail("This request expired. Ask for the change again.", 409);
  }
  if (decision === "approve" && !note && request.action === "ledger.adjustment") {
    return fail("Add a note saying what you checked before approving a wallet adjustment.", 422);
  }

  // Claim the decision first, so two approvers clicking at once cannot both apply it.
  const { count } = await prisma.approvalRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: decision === "approve" ? "APPROVED" : "REJECTED", decidedById: approver.id, decidedAt: new Date(), decisionNote: note },
  });
  if (count === 0) return fail("Someone decided on this request a moment ago. Reload.", 409);

  if (decision === "reject") {
    await writeAudit("approval.rejected", { userId: approver.id, meta: { id, action: request.action, requestedBy: request.requestedById, note } });
    return ok(null, "Request rejected. Nothing was changed.");
  }

  let outcome: ServiceResult<string>;
  try {
    const payload = JSON.parse(request.payload) as unknown;
    const current = await def.currentVersion(payload);
    outcome =
      request.targetVersion !== null && current !== request.targetVersion
        ? fail("What this request changes was edited after it was requested. Nothing was applied; ask for the change again.", 409)
        : await def.apply(approver, payload, id);
  } catch (err) {
    log.error("approvals: apply failed", { id, action: request.action, error: errorMessage(err) });
    outcome = fail("Applying the change failed. Nothing was changed.", 500);
  }

  await prisma.approvalRequest.update({
    where: { id },
    data: outcome.ok ? { result: outcome.data } : { status: "FAILED", result: outcome.error },
  });
  await writeAudit(outcome.ok ? "approval.approved" : "approval.failed", {
    userId: approver.id,
    meta: { id, action: request.action, requestedBy: request.requestedById, note, result: outcome.ok ? outcome.data : outcome.error },
  });
  return outcome.ok ? ok(null, `Approved and applied. ${outcome.data}`) : fail(outcome.error, outcome.status);
}

/** The person who asked can withdraw a request that is still pending. */
export async function cancelApproval(staff: Staff, input: { id?: unknown }): Promise<ServiceResult<null>> {
  const id = String(input.id ?? "");
  const { count } = await prisma.approvalRequest.updateMany({
    where: { id, requestedById: staff.id, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });
  if (count === 0) return fail("Only your own pending requests can be cancelled.", 409);
  await writeAudit("approval.cancelled", { userId: staff.id, meta: { id } });
  return ok(null, "Request cancelled.");
}

/** Pending requests, and the latest decisions, for the desk. Expired ones are closed on the way. */
export async function listApprovals() {
  await prisma.approvalRequest.updateMany({ where: { status: "PENDING", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
  const who = { select: { id: true, fullName: true, email: true } } as const;
  const [pending, recent] = await Promise.all([
    prisma.approvalRequest.findMany({ where: { status: "PENDING" }, orderBy: { requestedAt: "asc" }, include: { requestedBy: who } }),
    prisma.approvalRequest.findMany({
      where: { status: { not: "PENDING" } },
      orderBy: { requestedAt: "desc" },
      take: 15,
      include: { requestedBy: who, decidedBy: who },
    }),
  ]);
  return { pending, recent };
}

export const approvalLabel = (action: string) => APPROVAL_ACTIONS[action as ApprovalAction]?.label ?? action;
export const approvalPermission = (action: string) => APPROVAL_ACTIONS[action as ApprovalAction]?.permission ?? null;
