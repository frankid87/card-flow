import { GamePieceResponse } from "../types";
import HP_Bar from "./HP_Bar";
import Element_Icon from "./Element_Icon";
import Evolved_Crown from "./Evolved_Crown";

const PLACEHOLDER = "/placeholder-piece.png";

interface PieceRendererProps {
  data: GamePieceResponse;
  state: { current_hp: number; is_evolved: boolean };
}

export default function PieceRenderer({ data, state }: PieceRendererProps) {
  const imageUrl = data.artwork?.image_url || PLACEHOLDER;

  return (
    <div className="relative w-full h-full">
      {/* Circular piece image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={data.name}
        className="w-full h-full rounded-full object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src = PLACEHOLDER;
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
