import { prisma } from "@/lib/db";
import { data, open } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/assets  Tradable crypto assets and the network each one settles on.
 * Comes from the admin-managed registry, never from a list in the client.
 */
export const GET = open(async () => {
  const [wallets, rates] = await Promise.all([
    prisma.platformWallet.findMany({ where: { isActive: true }, select: { symbol: true, network: true } }),
    prisma.rate.findMany({
      where: { kind: "CRYPTO", isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { symbol: true, displayName: true, minAmount: true, maxAmount: true },
    }),
  ]);
  const network = new Map(wallets.map((w) => [w.symbol, w.network]));
  return data(rates.filter((r) => network.has(r.symbol)).map((r) => ({ ...r, network: network.get(r.symbol)! })));
});
