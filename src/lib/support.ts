/** Public WhatsApp support link from env. Digits only, country code included (e.g. 234801...). */
export function supportWhatsAppDigits() {
  return (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "").replace(/\D/g, "");
}

export function supportWhatsAppUrl(message?: string) {
  const phone = supportWhatsAppDigits();
  if (!phone) return null;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${phone}${text}`;
}

export function isFailedOrderStatus(status: string) {
  return status === "REJECTED" || status === "CANCELLED";
}
