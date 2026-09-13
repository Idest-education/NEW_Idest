"use client";

import { useRef } from "react";
import type { ReactNode } from "react";
import styles from "./spotlight-card.module.css";

/**
 * Adapted from reactbits.dev's Spotlight Card: a border-lit hover glow that
 * tracks the cursor. Kept zero-radius and re-tinted to the brand's warm
 * palette instead of the original dark-theme white glow.
 */
export function SpotlightCard({
  children,
  className = "",
  spotlightColor = "rgba(240, 148, 66, 0.16)",
}: {
  children: ReactNode;
  className?: string;
  spotlightColor?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    el.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
    el.style.setProperty("--spotlight-color", spotlightColor);
  };

  return (
    <div ref={ref} onMouseMove={handleMouseMove} className={`${styles.spotlight} ${className}`}>
      {children}
    </div>
  );
}
