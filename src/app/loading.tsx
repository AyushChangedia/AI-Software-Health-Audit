import { Skeleton } from '@/components/ui/misc';

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6" aria-busy>
      <span className="sr-only">Loading</span>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-96" />
      <div className="mt-8 grid gap-3 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Skeleton className="h-72" />
        <div className="grid gap-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-28" />
        </div>
      </div>
    </div>
  );
}
