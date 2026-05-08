import { cn } from '../../lib/utils'
import { Loader2 } from 'lucide-react'

const variants = {
  primary:   'bg-brand hover:bg-brand-600 text-white shadow-sm hover:shadow',
  secondary: 'bg-(--surface2) hover:bg-(--border) text-(--text)',
  outline:   'border border-(--border) hover:bg-(--surface2) text-(--text)',
  ghost:     'hover:bg-(--surface2) text-(--text-muted) hover:text-(--text)',
  danger:    'bg-red-500 hover:bg-red-600 text-white shadow-sm',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-4 py-2 text-sm rounded-xl',
  lg: 'px-5 py-2.5 text-sm rounded-xl',
}

export default function Button({ variant = 'primary', size = 'md', loading, disabled, className, children, ...props }) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-all duration-150',
        'focus:outline-none focus:ring-2 focus:ring-brand/30',
        'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  )
}
