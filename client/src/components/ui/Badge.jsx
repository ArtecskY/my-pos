import { cn } from '../../lib/utils'

const variants = {
  default:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  brand:    'bg-brand/10 text-brand',
  success:  'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400',
  warning:  'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400',
  danger:   'bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400',
  purple:   'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400',
  orange:   'bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400',
}

export default function Badge({ variant = 'default', className, children }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      variants[variant],
      className
    )}>
      {children}
    </span>
  )
}
