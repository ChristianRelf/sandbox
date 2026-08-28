import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "secondary" };
export function Button({ tone = "primary", className = "", ...props }: ButtonProps) {
  return <button className={`sb-button sb-button--${tone} ${className}`} {...props} />;
}

type ActionLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { tone?: "primary" | "secondary" };
export function ActionLink({ tone = "primary", className = "", ...props }: ActionLinkProps) {
  return <a className={`sb-button sb-button--${tone} ${className}`} {...props} />;
}

export function StatusDot({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" }) {
  return <span className={`sb-status sb-status--${tone}`}><i aria-hidden="true" />{children}</span>;
}
