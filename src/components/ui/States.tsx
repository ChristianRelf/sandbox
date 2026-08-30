import { AlertTriangle, Inbox, RefreshCcw } from "lucide-react";
import type { ReactNode } from "react";

export function LoadingSkeleton({ rows = 6, label = "Loading" }: { rows?: number; label?: string }) {
  return <div className="ui-loading" role="status" aria-label={label}>{Array.from({ length: rows }, (_, index) => <div key={index} className="ui-skeleton-row"><i/><span/><em/></div>)}</div>;
}

export function EmptyState({ title, description, action, icon }: { title: string; description: string; action?: ReactNode; icon?: ReactNode }) {
  return <div className="ui-state ui-empty-state">{icon ?? <Inbox size={23}/>}<h2>{title}</h2><p>{description}</p>{action}</div>;
}

export function ErrorState({ title = "Something went wrong", description, onRetry }: { title?: string; description: string; onRetry?: () => void }) {
  return <div className="ui-state ui-error-state" role="alert"><AlertTriangle size={23}/><h2>{title}</h2><p>{description}</p>{onRetry && <button className="button" onClick={onRetry}><RefreshCcw size={14}/>Retry</button>}</div>;
}
