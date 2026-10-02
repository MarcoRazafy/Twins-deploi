const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOSTNAME_PATTERN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/** Every validator returns an error message, or undefined when the value is valid. */
export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (!email) return "Saisissez une adresse e-mail.";
  return EMAIL_PATTERN.test(email) ? undefined : "Saisissez une adresse e-mail valide.";
}

export function validateIpv4(value: string): string | undefined {
  const ip = value.trim();
  if (!ip) return "Saisissez une adresse IPv4.";
  return IPV4_PATTERN.test(ip) ? undefined : "Saisissez une adresse IPv4 valide, par exemple 102.16.44.10.";
}

export function validateHostname(value: string, example: string): string | undefined {
  const host = value.trim();
  if (!host) return "Ce champ est obligatoire.";
  return HOSTNAME_PATTERN.test(host) ? undefined : `Saisissez un nom d’hôte valide, par exemple ${example}.`;
}

export function validateText(
  value: string,
  { min, max, label }: { min: number; max: number; label: string },
): string | undefined {
  const length = value.trim().length;
  if (length < min || length > max) {
    return `${label} doit contenir entre ${min} et ${max} caractères.`;
  }
  return undefined;
}

export function validateUrl(value: string): string | undefined {
  return /^https?:\/\/[^\s/]+/.test(value.trim())
    ? undefined
    : "Saisissez une URL valide, par exemple https://registry.exemple.mg.";
}

export function validateAbsolutePath(value: string): string | undefined {
  return value.trim().startsWith("/") ? undefined : "Saisissez un chemin absolu, par exemple /var/run/docker.sock.";
}

/** Accepts a comma as decimal separator ("1,5"). Returns NaN for anything that is not a number. */
export function parseNumber(raw: string): number {
  const text = raw.trim().replace(",", ".");
  return text === "" ? Number.NaN : Number(text);
}

export function validateIntegerRange(
  raw: string,
  { min, max, unit }: { min: number; max: number; unit: string },
): string | undefined {
  const value = parseNumber(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return `Saisissez un nombre entier entre ${min} et ${max} ${unit}.`;
  }
  return undefined;
}
