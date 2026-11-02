/** TRAK-328 (Imad, 2 Nov): his lock, for what only the coach sees. Drawn on a 48 × 56 grid; `size` is its height. */
export function LockIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={(size * 48) / 56} height={size} viewBox="0 0 48 56" fill="none" stroke="currentColor"
      strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M15 22V16a9 9 0 0 1 18 0v6" />
      <circle cx="24" cy="34" r="15" />
      <path d="M24 31.5v5" />
    </svg>
  )
}
