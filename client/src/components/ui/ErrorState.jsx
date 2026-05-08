import { AlertCircle, RefreshCw } from 'lucide-react'
import Button from './Button'

export default function ErrorState({ message = 'เกิดข้อผิดพลาด', onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-900/40 flex items-center justify-center mb-4">
        <AlertCircle size={24} className="text-red-400" strokeWidth={1.5} />
      </div>
      <p className="text-sm font-semibold text-(--text) mb-1">เกิดข้อผิดพลาด</p>
      <p className="text-xs text-(--text-muted) mb-4 max-w-xs">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw size={13} />
          ลองใหม่
        </Button>
      )}
    </div>
  )
}
