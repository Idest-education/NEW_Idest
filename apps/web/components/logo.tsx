// The AIO logomark: A, I and O drawn as a triangle, a bar and a circle on one baseline.
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={(size * 44) / 16} height={size} viewBox="0 0 44 16" fill="currentColor" aria-hidden="true">
      <path d="M8 2.2 14.6 15H1.4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="18" y="1.4" width="4.4" height="14.4" rx="2.2" />
      <circle cx="34.6" cy="8.6" r="7.2" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <span className="logo-mark">
        <Mark size={14} />
      </span>
      <span className="logo-word">aio</span>
    </span>
  );
}
