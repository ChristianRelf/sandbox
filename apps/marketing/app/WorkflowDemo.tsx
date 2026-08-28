"use client";
import { useEffect, useState } from "react";
import { Check, CircleAlert, Clock3, Download, Globe2, Play, RefreshCw, Send } from "lucide-react";

const steps = [
  { label: "Schedule", detail: "Weekdays · 08:00", icon: Clock3 },
  { label: "Open browser", detail: "Managed profile", icon: Globe2 },
  { label: "Download report", detail: "Approved folder", icon: Download },
  { label: "Check result", detail: "Rows > 0", icon: CircleAlert },
  { label: "Send notification", detail: "Desktop", icon: Send },
];

export function WorkflowDemo() {
  const [run, setRun] = useState(0);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setActive(steps.length); return; }
    setActive(-1);
    const timers = steps.map((_, index) => window.setTimeout(() => setActive(index), 550 + index * 720));
    timers.push(window.setTimeout(() => setActive(steps.length), 550 + steps.length * 720));
    return () => timers.forEach(clearTimeout);
  }, [run]);
  return <div className="workflow-demo" aria-label="Example report collection workflow">
    <div className="demo-toolbar"><span><i />Workflow ready</span><div><span className="runner-pill">This computer</span><button onClick={() => setRun(value => value + 1)} aria-label="Replay workflow"><RefreshCw size={13}/> Replay</button></div></div>
    <div className="workflow-canvas">
      <div className="canvas-grid" aria-hidden="true" />
      <ol className="workflow-steps">
        {steps.map((step, index) => { const Icon = step.icon; const done = active > index; const current = active === index; return <li key={step.label} className={done ? "done" : current ? "active" : ""}>
          <div className="connector" aria-hidden="true"><i /></div><article><span className="node-icon"><Icon size={16}/></span><div><strong>{step.label}</strong><small>{step.detail}</small></div><span className="node-state">{done ? <Check size={13}/> : current ? <Play size={11} fill="currentColor"/> : index + 1}</span></article>
        </li>})}
      </ol>
      <div className="execution-log" aria-live="polite"><span>RUN 2408</span><strong>{active >= steps.length ? "Completed in 4.8s" : active >= 0 ? `Running · ${steps[active]?.label ?? ""}` : "Waiting to start"}</strong><small>No external action is performed in this demonstration.</small></div>
    </div>
  </div>;
}
