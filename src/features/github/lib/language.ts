/**
 * Dot colour of a repository language, taken from the design tokens (never a
 * hex literal). Known languages get a fixed colour; any other one is hashed
 * onto the same palette, so a language looks the same on every render and in
 * every session.
 */
const LANGUAGE_DOTS: Record<string, string> = {
  TypeScript: "bg-info",
  JavaScript: "bg-warning",
  Python: "bg-success",
  Go: "bg-cyan-400",
  PHP: "bg-brand-400",
  Astro: "bg-pink-400",
  Rust: "bg-destructive",
};

const FALLBACK_DOTS = [
  "bg-brand-500",
  "bg-info",
  "bg-success",
  "bg-warning",
  "bg-pink-400",
  "bg-cyan-400",
] as const;

export function languageDotClass(language: string): string {
  const known = LANGUAGE_DOTS[language];
  if (known) return known;

  let hash = 0;
  for (const character of language) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return FALLBACK_DOTS[hash % FALLBACK_DOTS.length] ?? "bg-brand-500";
}
