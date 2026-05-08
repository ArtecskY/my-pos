import { cn } from '../../lib/utils'
import { Inbox } from 'lucide-react'

export default function EmptyState({ icon: Icon = Inbox, title = 'ไม่มีข้อมูล', description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
      <div className="w-14 h-14 rounded-2xl bg-(--surface2) border border-(--border) flex items-center justify-center mb-4">
        <Icon size={24} className="text-(--text-muted)" strokeWidth={1.5} />
      </div>
      <p className="text-sm font-semibold text-(--text) mb-1">{title}</p>
      {description && <p className="text-xs text-(--text-muted) max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
