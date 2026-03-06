interface StatusDotProps {
  active: boolean;
  pulse?: boolean;
  className?: string;
}

export function StatusDot({ active, pulse = false, className = "" }: StatusDotProps) {
  if (active && pulse) {
    return (
      <span className={`relative flex h-2.5 w-2.5 ${className}`}>
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex h-2.5 w-2.5 rounded-full ${
        active ? "bg-emerald-400" : "bg-gray-600"
      } ${className}`}
    />
  );
}
