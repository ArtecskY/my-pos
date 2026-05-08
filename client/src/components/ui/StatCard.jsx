import { cn } from '../../lib/utils'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

const colorMap = {
  brand:  { bg: 'bg-brand/10',                                      icon: 'text-brand' },
  green:  { bg: 'bg-emerald-50 dark:bg-emerald-950/30',             icon: 'text-emerald-500' },
  purple: { bg: 'bg-violet-50 dark:bg-violet-950/30',               icon: 'text-violet-500' },
  amber:  { bg: 'bg-amber-50 dark:bg-amber-950/30',                 icon: 'text-amber-500' },
}

export default function StatCard({ label, value, sub, icon: Icon, trend, trendLabel, color = 'brand' }) {
  const c = colorMap[color] || colorMap.brand
  const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus
  const trendColor = trend > 0 ? 'text-emerald-500' : trend < 0 ? 'text-red-400' : 'text-(--text-muted)'

  return (
    <div className="bg-(--surface) border border-(--border) rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-start justify-between mb-4">
        <p className="text-xs font-medium text-(--text-muted) leading-tight">{label}</p>
        {Icon && (
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', c.bg)}>
            <Icon size={17} className={c.icon} strokeWidth={2} />
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-(--text) mb-1 tracking-tight">{value}</p>
      <div className="flex items-center justify-between">
        {sub && <p className="text-xs text-(--text-muted)">{sub}</p>}
        {trend != null && (
          <div className={cn('flex items-center gap-1 text-xs font-medium', trendColor)}>
            <TrendIcon size={13} />
            <span>{trendLabel || `${trend > 0 ? '+' : ''}${trend}%`}</span>
          </div>
        )}
      </div>
    </div>
  )
}
