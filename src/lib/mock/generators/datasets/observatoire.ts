/** Tables of the Observatoire analytics database (fed by n8n, read by Metabase). */

import { DAY, HOUR, pgDate, pgTimestamp } from "../../text";
import { chance, pick, randInt } from "../prng";
import { column, id, spreadTime, type TableSpec } from "./shared";

const PATHS = [
  "/", "/produits", "/produits/vanille-bourbon-50g", "/produits/poivre-sauvage-voatsiperifery",
  "/categories/epices", "/panier", "/commande", "/livraison", "/a-propos", "/blog/recolte-2026",
];
const REFERRERS = ["google", "direct", "facebook", "instagram", "newsletter", "bing"];
const COUNTRIES = ["MG", "MG", "MG", "FR", "FR", "RE", "CA", "MU", "BE", "CH"];
const DEVICES = ["mobile", "mobile", "mobile", "desktop", "desktop", "tablet"];
const REPORTS = [
  "Ventes quotidiennes", "Panier moyen par pays", "Top 20 des produits", "Ruptures de stock",
  "Nouveaux clients", "Adhésions CanCham par mois", "Cotisations impayées", "Audience du site",
  "Taux de conversion", "Paiements MVola en échec", "Délais de livraison", "Clients inactifs",
  "Chiffre d’affaires par catégorie", "Inscriptions aux événements", "Sources de trafic",
  "Commandes par mode de paiement", "Performance des campagnes e-mail", "Stock de vanille",
];
const OWNERS = ["Marco Razafy", "Hery Rakotomalala", "Lalaina Andriamanana"];
const SCHEDULES = ["quotidien", "hebdomadaire", "mensuel"];
const WORKFLOWS = [
  "Synchronisation des ventes", "Rapport hebdomadaire", "Relance des paniers abandonnés",
  "Export comptable", "Import des adhésions", "Alerte de rupture de stock",
];

const DAILY_SALES = 420;
const PAGE_VIEWS = 48_210;
const WORKFLOW_RUNS = 2304;

export const OBSERVATOIRE_TABLES: TableSpec[] = [
  {
    name: "daily_sales",
    rowCount: DAILY_SALES,
    rowBytes: 64,
    columns: [
      column("day", "date", { primaryKey: true }),
      column("orders", "integer"),
      column("revenue_mga", "bigint"),
      column("average_basket_mga", "integer"),
      column("new_customers", "integer"),
    ],
    row(index, rng, anchor) {
      const day = anchor - (DAILY_SALES - index) * DAY;
      const weekday = new Date(day).getUTCDay();
      const orders = randInt(rng, 4, 14) + (weekday === 0 || weekday === 6 ? 0 : randInt(rng, 2, 9));
      const basket = randInt(rng, 62, 148) * 1000;
      return {
        day: pgDate(day),
        orders,
        revenue_mga: orders * basket,
        average_basket_mga: basket,
        new_customers: randInt(rng, 0, Math.max(1, Math.floor(orders / 2))),
      };
    },
  },
  {
    name: "page_views",
    rowCount: PAGE_VIEWS,
    rowBytes: 118,
    columns: [
      id,
      column("path", "text"),
      column("referrer", "text", { nullable: true }),
      column("country", "char(2)"),
      column("device", "text"),
      column("viewed_at", "timestamptz"),
    ],
    row(index, rng, anchor) {
      const referrer = pick(rng, REFERRERS);
      return {
        id: index + 1,
        path: pick(rng, PATHS),
        referrer: referrer === "direct" ? null : referrer,
        country: pick(rng, COUNTRIES),
        device: pick(rng, DEVICES),
        viewed_at: pgTimestamp(spreadTime(index, PAGE_VIEWS, 90 * DAY, anchor, rng)),
      };
    },
  },
  {
    name: "reports",
    rowCount: REPORTS.length,
    rowBytes: 240,
    columns: [
      id,
      column("name", "text"),
      column("owner", "text"),
      column("schedule", "text"),
      column("last_run_at", "timestamptz", { nullable: true }),
      column("is_enabled", "boolean"),
    ],
    row(index, rng, anchor) {
      const enabled = !chance(rng, 0.15);
      return {
        id: index + 1,
        name: REPORTS[index],
        owner: pick(rng, OWNERS),
        schedule: pick(rng, SCHEDULES),
        last_run_at: enabled ? pgTimestamp(anchor - randInt(rng, 1, 160) * HOUR) : null,
        is_enabled: enabled,
      };
    },
  },
  {
    name: "workflow_runs",
    rowCount: WORKFLOW_RUNS,
    rowBytes: 104,
    columns: [
      id,
      column("workflow", "text"),
      column("status", "text"),
      column("started_at", "timestamptz"),
      column("duration_ms", "integer"),
    ],
    row(index, rng, anchor) {
      const failed = chance(rng, 0.04);
      return {
        id: index + 1,
        workflow: pick(rng, WORKFLOWS),
        status: failed ? "error" : "success",
        started_at: pgTimestamp(spreadTime(index, WORKFLOW_RUNS, 60 * DAY, anchor, rng)),
        duration_ms: failed ? randInt(rng, 30_000, 120_000) : randInt(rng, 180, 9_400),
      };
    },
  },
];
