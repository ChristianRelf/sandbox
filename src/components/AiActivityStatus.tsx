import { Check, LoaderCircle } from "lucide-react";

export function AiActivityStatus({
  active,
  activities,
}: {
  active: boolean;
  activities: string[];
}) {
  if (!active) return null;
  const currentStage = Math.max(activities.length - 1, 0);
  return (
    <div className="ai-activity-status" role="status" aria-live="polite">
      <small>Live activity</small>
      {(activities.length ? activities : ["Preparing request"]).map((stage, index) => (
        <span
          className={index === currentStage ? "is-active" : "is-complete"}
          key={`${index}:${stage}`}
        >
          {index < currentStage ? <Check size={11} /> : <LoaderCircle className="spin" size={11} />}
          {stage}
        </span>
      ))}
    </div>
  );
}
