import { useId } from "react";

/**
 * The Nexora "N" mark, drawn the same way as in the mobile app (nexora-mobile/components/brand.tsx):
 * two rounded strokes joined by a diagonal, in a green gradient or solid white.
 */
export function NexoraLogo({ size = 32, variant = "color", className }: { size?: number; variant?: "color" | "white"; className?: string }) {
  const id = `nx${useId().replace(/:/g, "")}`;
  const fill = variant === "white" ? "#ffffff" : `url(#${id})`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7CF0A6" />
          <stop offset="0.45" stopColor="#1DBA5C" />
          <stop offset="1" stopColor="#0B7A3B" />
        </linearGradient>
      </defs>
      <path
        d="M14 84 C10 84 8 81 8 77 L8 30 C8 19 21 14 29 22 L66 64 L66 77 C66 81 62 82 59 79 L30 46 L30 77 C30 81 27 84 23 84 Z"
        fill={fill}
      />
      <path
        d="M86 16 C90 16 92 19 92 23 L92 70 C92 81 79 86 71 78 L34 36 L34 23 C34 19 38 18 41 21 L70 54 L70 26 C70 19 77 14 86 16 Z"
        fill={fill}
        opacity={0.95}
      />
    </svg>
  );
}
