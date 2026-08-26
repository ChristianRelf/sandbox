import { ArrowRight, GitFork, Plus } from "lucide-react";

export function EmptyState({ onCreate, onTemplate }: { onCreate: () => void; onTemplate: (key: string) => void }) {
  return <div className="empty-wrap">
    <div className="empty-icon"><GitFork size={22} /></div>
    <h2>Your automations start here</h2>
    <p>Connect a trigger to an action and let it run locally.</p>
    <button className="button primary" onClick={onCreate}><Plus size={15} />Create workflow</button>
    <div className="starter-label">Or start from a working template</div>
    <div className="templates">
      <button onClick={() => onTemplate("website-change-monitor")}><div><span className="template-icon">↗</span><b>Website Change Monitor</b><small>Browse, extract a value, and notify on change.</small></div><ArrowRight size={16} /></button>
      <button onClick={() => onTemplate("email-enquiry-draft")}><div><span className="template-icon">✉</span><b>Email Enquiry Draft</b><small>Turn matching Gmail enquiries into safe drafts.</small></div><ArrowRight size={16} /></button>
    </div>
  </div>;
}
