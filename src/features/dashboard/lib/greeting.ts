const longDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * Greeting for the local hour of `now` (epoch milliseconds): morning until
 * noon, afternoon until 18:00, evening afterwards and through the night.
 */
export function getGreeting(now: number): string {
  const hour = new Date(now).getHours();
  if (hour >= 5 && hour < 12) return "Bonjour";
  if (hour >= 12 && hour < 18) return "Bon après-midi";
  return "Bonsoir";
}

/** "Vendredi 2 octobre 2026". */
export function formatLongDate(now: number): string {
  const text = longDateFormatter.format(now);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Marco Razafy" → "Marco"; null while the profile is not known. */
export function getFirstName(fullName: string | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? first : null;
}
