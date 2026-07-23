import { supportWhatsAppUrl } from "@/lib/support";

export function ContactSupport({
  reference,
  status,
}: {
  reference: string;
  status: string;
}) {
  const url = supportWhatsAppUrl(
    `Hi Nexora support, I need help with order ${reference} (status: ${status}).`,
  );
  if (!url) return null;

  return (
    <div className="ops-hint mt-4">
      Something went wrong with this order.{" "}
      <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline">
        Contact support on WhatsApp
      </a>
    </div>
  );
}
