import { prisma } from "@/lib/db";
import { listAssetNetworks } from "@/lib/services/assets";
import { data, open } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/assets  Tradable crypto assets and the networks each one moves on.
 * Comes from the admin-managed registry, never from a list in the client.
 *
 * `network` is the asset's default network (send no `network` with an order to use it).
 * `networks` lists every network the asset can use: `sell` means it can be sent to Nexora on
 * that network, `buy` that Nexora can send it out on it. Deposit addresses are not listed
 * here; an order returns the address to send to.
 */
export const GET = open(async () => {
  const [rates, networks] = await Promise.all([
    prisma.rate.findMany({
      where: { kind: "CRYPTO", isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { symbol: true, displayName: true, minAmount: true, maxAmount: true },
    }),
    listAssetNetworks({ includeAddresses: false }),
  ]);
  return data(
    rates
      .map((r) => {
        const own = networks
          .filter((n) => n.symbol === r.symbol)
          .map((n) => ({
            network: n.network,
            networkName: n.networkName,
            isDefault: n.isDefault,
            sell: n.sell,
            buy: n.buy,
            confirmations: n.confirmations,
            note: n.note,
          }));
        return { ...r, network: (own.find((n) => n.isDefault) ?? own[0])?.network ?? null, networks: own };
      })
      .filter((a) => a.networks.length > 0),
  );
});
