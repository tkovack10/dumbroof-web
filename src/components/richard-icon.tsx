/**
 * Richard mascot icon — replaces the 🧠 emoji that previously stood in for
 * the Claim Brain. Pink BG / green house (the "feed size winner" picked by
 * Tom on Apr 26) is the default; pass variant="green" for the inverted
 * green BG / pink house treatment used in marketing.
 */
type Variant = "pink" | "green";

interface RichardIconProps {
  size?: number;
  variant?: Variant;
  className?: string;
  alt?: string;
}

const SRC: Record<Variant, string> = {
  pink: "/richard-icon-pink.svg",
  green: "/richard-icon.svg",
};

export function RichardIcon({
  size = 24,
  variant = "pink",
  className = "",
  alt = "Richard",
}: RichardIconProps) {
  return (
    <img
      src={SRC[variant]}
      width={size}
      height={size}
      alt={alt}
      className={`inline-block rounded-full ${className}`}
      // Tiny SVG, decorative in most contexts. Async decode keeps it off the
      // critical path.
      decoding="async"
      loading="lazy"
    />
  );
}
