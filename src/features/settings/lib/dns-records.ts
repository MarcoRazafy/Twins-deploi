export interface DnsRecord {
  type: "A" | "CNAME";
  name: string;
  value: string;
  usage: string;
}

/** What a user is asked to create at their DNS host for a custom domain. */
export function buildDnsRecords(input: { serverIp: string; cnameTarget: string }): DnsRecord[] {
  return [
    {
      type: "CNAME",
      name: "app",
      value: input.cnameTarget.trim() || "…",
      usage: "Sous-domaine (app.exemple.com)",
    },
    {
      type: "A",
      name: "@",
      value: input.serverIp.trim() || "…",
      usage: "Domaine racine (exemple.com)",
    },
  ];
}
