interface HP_BarProps {
  current_hp: number;
  base_hp: number;
  testId?: string;
}

export default function HP_Bar({ current_hp, base_hp, testId }: HP_BarProps) {
  const pct = base_hp > 0 ? Math.max(0, Math.min(100, (current_hp / base_hp) * 100)) : 0;

  return (
    <div className="w-full px-1">
      <span
        className="text-white text-xs font-bold drop-shadow"
        {...(testId ? { "data-testid": testId } : {})}
      >
        {current_hp}
      </span>
      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden mt-0.5">
        <div
          className="h-full bg-green-400 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
