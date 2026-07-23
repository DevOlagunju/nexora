"use client";

import { useState, useTransition } from "react";
import { revealGiftCardCodeAction } from "@/app/actions";

export function RevealGiftCode({ orderId, reference }: { orderId: string; reference: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onReveal() {
    setError(null);
    start(async () => {
      const res = await revealGiftCardCodeAction(orderId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.code) setCode(res.code);
    });
  }

  function onHide() {
    setCode(null);
  }

  return (
    <div className="mt-4 rounded-xl bg-ink px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-accent">
          {code ? (
            <>
              Code (desk only): <span className="select-all">{code}</span>
            </>
          ) : (
            <>Code encrypted · {reference} · masked until reveal</>
          )}
        </p>
        <div className="flex gap-2">
          {code ? (
            <button type="button" className="btn btn-ghost !px-3 !py-1 text-xs" onClick={onHide}>
              Hide
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary !px-3 !py-1 text-xs"
              disabled={pending}
              onClick={onReveal}
            >
              {pending ? "Revealing…" : "Reveal code"}
            </button>
          )}
        </div>
      </div>
      {error ? <p className="mt-2 text-red-300">{error}</p> : null}
      {!code ? (
        <p className="mt-1 text-[11px] text-white/50">Reveal is audited. Hide when done.</p>
      ) : null}
    </div>
  );
}
