interface Element_IconProps {
  element: string;
}

const ELEMENT_STYLES: Record<string, { bg: string; label: string }> = {
  Fire:     { bg: "bg-red-500",    label: "🔥 Fire" },
  Grass:    { bg: "bg-green-500",  label: "🌿 Grass" },
  Water:    { bg: "bg-blue-500",   label: "💧 Water" },
  Electric: { bg: "bg-yellow-400", label: "⚡ Electric" },
  Air:      { bg: "bg-sky-300",    label: "🌬 Air" },
  Earth:    { bg: "bg-amber-700",  label: "🪨 Earth" },
  Neutral:  { bg: "bg-gray-400",   label: "⚪ Neutral" },
};

export default function Element_Icon({ element }: Element_IconProps) {
  const style = ELEMENT_STYLES[element] ?? { bg: "bg-gray-500", label: element };

  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-white text-xs font-semibold ${style.bg}`}
    >
      {style.label}
    </span>
  );
}
