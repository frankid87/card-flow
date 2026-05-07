import { useState } from "react";
import { GamePieceResponse } from "../types";
import HP_Bar from "./HP_Bar";
import Element_Icon from "./Element_Icon";
import Evolved_Crown from "./Evolved_Crown";

interface PieceRendererProps {
  data: GamePieceResponse;
  state: { current_hp: number; is_evolved: boolean };
}

/** SVG data URI for a fallback piece icon (a simple circle with a ?) */
function fallbackSvgUri(name: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="30" fill="#d1d5db" stroke="#9ca3af" stroke-width="2"/>
    <text x="32" y="42" text-anchor="middle" font-size="28" fill="#6b7280" font-family="sans-serif">${name.charAt(0).toUpperCase()}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export default function PieceRenderer({ data, state }: PieceRendererProps) {
  const [imgSrc, setImgSrc] = useState<string>(
    data.artwork?.image_url || fallbackSvgUri(data.name)
  );

  return (
    <div className="relative w-full h-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imgSrc}
        alt={data.name}
        className="w-full h-full rounded-full object-cover"
        onError={() => {
          // Fallback to SVG if image fails to load
          setImgSrc(fallbackSvgUri(data.name));
        }}
      />

      {/* HP Bar overlay — bottom */}
      <div className="absolute bottom-0 left-0 right-0">
        <HP_Bar current_hp={state.current_hp} base_hp={data.base_hp} testId={`hp-current-${data.id}`} />
      </div>

      {/* Element Icon overlay — top-left */}
      <div className="absolute top-0 left-0">
        <Element_Icon element={data.element} />
      </div>

      {/* Evolved Crown overlay — top-right, only when evolved */}
      {state.is_evolved && (
        <div className="absolute top-0 right-0">
          <Evolved_Crown />
        </div>
      )}
    </div>
  );
}
