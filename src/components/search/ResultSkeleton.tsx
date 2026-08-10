export function ResultSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-24 rounded-card bg-muted/60 animate-pulse border border-border/50"
        />
      ))}
    </div>
  );
}
