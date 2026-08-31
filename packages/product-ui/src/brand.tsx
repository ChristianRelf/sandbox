import type { CSSProperties } from "react";

export type SndboxMarkProps = {
  className?: string;
  size?: number;
};

/** The shared sndbox mark: a geometric sand tray inside the brand tile. */
export function SndboxMark({ className, size = 32 }: SndboxMarkProps) {
  const outerStyle: CSSProperties = {
    width: size,
    height: size,
    flex: "0 0 auto",
    borderRadius: Math.max(4, Math.round(size * 0.2)),
    background: "#d6ff4b",
    color: "#10130a",
    display: "inline-block",
    overflow: "hidden",
    position: "relative",
  };

  return (
    <span className={className} style={outerStyle} aria-hidden="true">
      <span
        style={{
          position: "absolute",
          top: "30%",
          left: "17%",
          width: "66%",
          height: "48%",
          borderRadius: Math.max(1, Math.round(size * 0.06)),
          background: "#10130a",
          clipPath: "polygon(13% 0, 87% 0, 100% 100%, 0 100%)",
        }}
      />
      <span
        style={{
          position: "absolute",
          top: "39%",
          left: "25%",
          width: "50%",
          height: "23%",
          background: "#d6ff4b",
          clipPath: "polygon(9% 0, 91% 0, 100% 100%, 0 100%)",
        }}
      />
      <span
        style={{
          position: "absolute",
          top: "37%",
          left: "38%",
          width: "24%",
          height: "15%",
          borderRadius: "50% 50% 34% 34%",
          background: "#10130a",
        }}
      />
    </span>
  );
}
