"use client";

import { useEffect, useState, useRef } from "react";
import { BreachActivation } from "../types";

interface BreachAnimationProps {
  activations: BreachActivation[];
  onComplete: () => void;
}

/**
 * Maps element types to energetic colours for the Breach wave.
 */
const ELEMENT_COLORS: Record<string, { wave: string; glow: string }> = {
  Fire:    { wave: "rgba(255, 100, 0, 0.6)",   glow: "rgba(255, 150, 0, 0.25)" },
  Grass:   { wave: "rgba(50, 200, 50, 0.6)",    glow: "rgba(50, 220, 50, 0.25)" },
  Water:   { wave: "rgba(30, 144, 255, 0.6)",   glow: "rgba(30, 160, 255, 0.25)" },
  Electric:{ wave: "rgba(255, 215, 0, 0.6)",    glow: "rgba(255, 230, 0, 0.25)" },
  Air:     { wave: "rgba(180, 200, 255, 0.5)",  glow: "rgba(180, 200, 255, 0.2)" },
  Earth:   { wave: "rgba(139, 90, 43, 0.6)",    glow: "rgba(160, 110, 50, 0.25)" },
  Neutral: { wave: "rgba(180, 180, 180, 0.5)",  glow: "rgba(200, 200, 200, 0.2)" },
};

function getColors(element: string) {
  return ELEMENT_COLORS[element] ?? ELEMENT_COLORS.Neutral;
}

/**
 * Duration of the animation in milliseconds.
 */
const ANIMATION_DURATION = 800;

export default function BreachAnimation({ activations, onComplete }: BreachAnimationProps) {
  const [phase, setPhase] = useState<"expanding" | "shrinking" | "done">("expanding");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activations.length === 0) {
      onComplete();
      return;
    }

    // Expanding phase: 0 → 400ms
    const expandTimer = setTimeout(() => {
      setPhase("shrinking");
    }, ANIMATION_DURATION * 0.5);

    // Shrinking + done: 400 → 800ms
    const shrinkTimer = setTimeout(() => {
      setPhase("done");
      onComplete();
    }, ANIMATION_DURATION);

    return () => {
      clearTimeout(expandTimer);
      clearTimeout(shrinkTimer);
    };
  }, [activations, onComplete]);

  if (phase === "done") return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 100,
        overflow: "hidden",
      }}
    >
      {activations.map((activation) =>
        activation.affected_squares.map(([row, col], idx) => {
          const colors = getColors(activation.element);
          const isExpand = phase === "expanding";

          return (
            <div
              key={`breach-${activation.piece_id}-${row}-${col}-${idx}`}
              style={{
                position: "absolute",
                left: `${col * 4 + 0.25}rem`,
                top: `${row * 4 + 0.25}rem`,
                width: "3.5rem",
                height: "3.5rem",
                borderRadius: "50%",
                background: isExpand
                  ? `radial-gradient(circle, ${colors.wave} 0%, ${colors.glow} 50%, transparent 70%)`
                  : "transparent",
                transform: isExpand ? "scale(1.2)" : "scale(0.8)",
                opacity: isExpand ? 1 : 0,
                transition: `all ${ANIMATION_DURATION * 0.4}ms ease-out`,
                boxShadow: isExpand
                  ? `0 0 20px 6px ${colors.wave}, inset 0 0 12px 3px ${colors.glow}`
                  : "none",
              }}
            />
          );
        })
      )}
    </div>
  );
}
