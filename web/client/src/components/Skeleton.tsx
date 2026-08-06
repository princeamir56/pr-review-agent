import { cn } from "../lib/utils";

export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div className={cn("skeleton", className)} />;
}

export function PRCardSkeleton(): JSX.Element {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="h-5 w-3/4" />
      <div className="flex gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  );
}
