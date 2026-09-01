export type SndboxMarkProps = {
  className?: string;
  size?: number;
};

/** The shared sndbox mark: a sand tray, mounds, and shovel inside the brand tile. */
export function SndboxMark({ className, size = 32 }: SndboxMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "0 0 auto" }}
    >
      <rect width="512" height="512" rx="96" fill="#dcff48" />
      <g fill="#0a0b08">
        <path fillRule="evenodd" d="M148 197h172l-2 17H159l-43 82h281l-46-82 15-17 60 116H86Zm-62 99h340l14 84H72Z" />
        <path d="M150 292c19-22 31-30 42-30 13 0 26 10 49 30Zm65 0c21-27 33-41 49-42 19-1 36 14 53 25 14 9 29 14 46 17Z" />
        <path d="M320 223c-17-2-29 8-32 27l48 24c7-12 10-26 7-37-3-9-11-14-23-14Zm0 1 6-47c2-14 12-18 24-13 14 5 19 14 15 25-3 8-14 20-31 40Z" />
      </g>
      <path d="M337 176c6 0 16 5 17 10 1 6-7 15-12 15-5-1-13-5-13-11 0-6 3-12 8-14Z" fill="#ddff49" />
    </svg>
  );
}
