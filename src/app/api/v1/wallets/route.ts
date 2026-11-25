import { getWalletOverview } from "@/lib/services/wallet";
import { activeGatewayName } from "@/lib/payments/gateway";
import { paymentConfig } from "@/lib/payment-rules";
import { authed, data } from "@/lib/api/v1";

export const dynamic = "force-dynamic";

/** GET /api/v1/wallets  Naira wallet: balance, what can be withdrawn, recent activity, and how it can be funded. */
export const GET = authed(async ({ user }) => {
  const cfg = paymentConfig();
  return data({
    currency: "NGN",
    ...(await getWalletOverview(user.id)),
    funding: { provider: activeGatewayName(), minNgn: cfg.minFundingNgn, maxNgn: cfg.maxFundingNgn },
  });
});
