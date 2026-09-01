import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

export function AiActivityStatus({
  active,
  stages,
}: {
  active: boolean;
  stages: string[];
}) {
  const [currentStage, setCurrentStage] = useState(0);

  useEffect(() => {
    if (!active) {
      setCurrentStage(0);
      return;
    }
    setCurrentStage(0);
    const interval = window.setInterval(() => {
      setCurrentStage((current) => Math.min(current + 1, stages.length - 1));
    }, 1_100);
    return () => window.clearInterval(interval);
  }, [active, stages.length]);

  if (!active) return null;
  return (
    <div className="ai-activity-status" role="status" aria-live="polite">
      <small>Activity</small>
      {stages.map((stage, index) => (
        <span
          className={index === currentStage ? "is-active" : index < currentStage ? "is-complete" : ""}
          key={stage}
        >
          {index < currentStage ? <Check size={11} /> : index === currentStage ? <LoaderCircle className="spin" size={11} /> : <i />}
          {stage}
        </span>
      ))}
    </div>
  );
}
