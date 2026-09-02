"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingLabel = "Working…",
  className = "portal-primary",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
