// Material Symbols Rounded, loaded from Google Fonts in the root layout.
// Add every new name to ICON_NAMES in app/layout.tsx, or it renders as text.
export function Icon({ name, fill, className }: { name: string; fill?: boolean; className?: string }) {
  return (
    <span className={`icon${fill ? " fill" : ""}${className ? ` ${className}` : ""}`} aria-hidden="true">
      {name}
    </span>
  );
}
