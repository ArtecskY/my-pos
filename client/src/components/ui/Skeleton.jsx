import { cn } from '../../lib/utils'

export function Skeleton({ className }) {
  return <div className={cn('skeleton', className)} />
}

export function StatCardSkeleton() {
  return (
    <div className="bg-(--surface) border border-(--border) rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-9 rounded-xl" />
      </div>
      <Skeleton className="h-7 w-32 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  )
}

export function TableRowSkeleton({ cols = 5 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-3.5 w-full max-w-30" />
        </td>
      ))}
    </tr>
  )
}

export function ChartSkeleton() {
  return (
    <div className="bg-(--surface) border border-(--border) rounded-2xl p-5 shadow-sm">
      <Skeleton className="h-4 w-40 mb-1" />
      <Skeleton className="h-3 w-64 mb-6" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  )
}
