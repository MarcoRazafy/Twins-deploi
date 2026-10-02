/** Tables of the CanCham member portal database. */

import { DAY, pgDate, pgTimestamp } from "../../text";
import { chance, pick, randInt } from "../prng";
import {
  CA_CITIES,
  column,
  emailLocalPart,
  FIRST_NAMES,
  id,
  LAST_NAMES,
  MG_CITIES,
  spreadTime,
  type TableSpec,
} from "./shared";

const COMPANY_PREFIXES = [
  "Sava", "Ravinala", "Baobab", "Nosy", "Tsara", "Lémurie", "Ylang", "Maki", "Vohitra", "Litchi",
  "Zébu", "Sambirano", "Isalo", "Betsileo", "Ankarana", "Imerina", "Boina", "Menabe", "Érable",
  "Laurentides", "Saint-Laurent", "Boréal", "Outaouais",
];
const COMPANY_ACTIVITIES = [
  "Export", "Conseil", "Logistique", "Tours", "Textile", "Digital", "Parfums", "Transport",
  "Fintech", "Agro", "Énergie", "Ingénierie", "Trading", "Services", "Technologies", "Immobilier",
];
const SECTORS = [
  "Agroalimentaire", "Textile", "Tourisme", "Technologies", "Mines", "Logistique", "Finance",
  "Énergie", "Conseil", "BTP",
];
const ROLES = [
  "Dirigeant", "Directrice financière", "Responsable export", "Juriste",
  "Chargé de partenariats", "Entrepreneure", "Directeur commercial",
];
const MEMBERSHIPS = ["Individuel", "PME", "Corporatif", "Honoraire"];
const EMAIL_DOMAINS = ["gmail.com", "moov.mg", "cancham.mg", "outlook.com", "yahoo.fr"];
const EVENT_TITLES = [
  "Gala annuel de la CanCham",
  "Petit-déjeuner d’affaires : exporter au Québec",
  "Atelier fiscalité des PME",
  "Mission commerciale à Montréal",
  "Webinaire : financer un projet d’énergie solaire",
  "Rencontre des nouveaux membres",
  "Table ronde : la vanille sur le marché nord-américain",
  "Formation : répondre à un appel d’offres canadien",
  "Cocktail de réseautage de la Fête du Canada",
  "Forum de l’entrepreneuriat féminin",
  "Atelier : propriété intellectuelle et marques",
  "Assemblée générale ordinaire",
];
const EVENT_PLACES = [
  "Hôtel Carlton, Antananarivo",
  "Novotel Ivandry, Antananarivo",
  "Résidence du Canada, Ivandry",
  "En ligne",
  "Chambre de commerce, Toamasina",
  "Hôtel des Thermes, Antsirabe",
];

function companyName(index: number): string {
  const prefix = COMPANY_PREFIXES[index % COMPANY_PREFIXES.length];
  const activity =
    COMPANY_ACTIVITIES[(index * 7 + Math.floor(index / COMPANY_PREFIXES.length)) % COMPANY_ACTIVITIES.length];
  const canadian = index % 4 === 3;
  const form = canadian ? (index % 8 === 3 ? "Inc." : "Ltée") : index % 3 === 0 ? "SA" : "SARL";
  return `${prefix} ${activity} ${form}`;
}

const COMPANIES = 86;
const MEMBERS = 248;
const EVENTS = 34;

export const CANCHAM_TABLES: TableSpec[] = [
  {
    name: "companies",
    rowCount: COMPANIES,
    rowBytes: 210,
    columns: [
      id,
      column("name", "text"),
      column("sector", "text"),
      column("city", "text"),
      column("country", "char(2)"),
      column("employees", "integer"),
      column("member_since", "date"),
      column("is_active", "boolean"),
    ],
    row(index, rng, anchor) {
      const canadian = index % 4 === 3;
      return {
        id: index + 1,
        name: companyName(index),
        sector: pick(rng, SECTORS),
        city: canadian ? pick(rng, CA_CITIES) : pick(rng, MG_CITIES),
        country: canadian ? "CA" : "MG",
        employees: randInt(rng, 3, 480),
        member_since: pgDate(anchor - randInt(rng, 60, 2400) * DAY),
        is_active: !chance(rng, 0.08),
      };
    },
  },
  {
    name: "events",
    rowCount: EVENTS,
    rowBytes: 320,
    columns: [
      id,
      column("title", "text"),
      column("location", "text"),
      column("starts_at", "timestamptz"),
      column("capacity", "integer"),
      column("price_mga", "integer"),
      column("status", "text"),
    ],
    row(index, rng, anchor) {
      // The last few events are still to come.
      const startsAt = anchor + (index - (EVENTS - 5)) * 11 * DAY + randInt(rng, 8, 18) * 3_600_000;
      const upcoming = startsAt > anchor;
      const year = new Date(startsAt).getUTCFullYear();
      return {
        id: index + 1,
        title: `${EVENT_TITLES[index % EVENT_TITLES.length]} ${year}`,
        location: pick(rng, EVENT_PLACES),
        starts_at: pgTimestamp(startsAt),
        capacity: pick(rng, [40, 60, 80, 120, 200, 350]),
        price_mga: pick(rng, [0, 40_000, 80_000, 150_000, 250_000]),
        status: upcoming ? (chance(rng, 0.25) ? "complet" : "publié") : chance(rng, 0.06) ? "annulé" : "terminé",
      };
    },
  },
  {
    name: "invoices",
    rowCount: 412,
    rowBytes: 180,
    columns: [
      id,
      column("number", "text"),
      column("member_id", "integer"),
      column("amount_mga", "integer"),
      column("status", "text"),
      column("issued_at", "date"),
      column("due_at", "date"),
      column("paid_at", "date", { nullable: true }),
    ],
    row(index, rng, anchor) {
      const issuedAt = spreadTime(index, 412, 540 * DAY, anchor, rng);
      const age = (anchor - issuedAt) / DAY;
      const paid = age > 45 ? !chance(rng, 0.07) : chance(rng, 0.55);
      const status = paid ? "payée" : age > 30 ? "en retard" : "en attente";
      return {
        id: index + 1,
        number: `FAC-${new Date(issuedAt).getUTCFullYear()}-${String(index + 1).padStart(4, "0")}`,
        member_id: randInt(rng, 1, MEMBERS),
        amount_mga: pick(rng, [80_000, 150_000, 300_000, 600_000, 1_200_000]),
        status,
        issued_at: pgDate(issuedAt),
        due_at: pgDate(issuedAt + 30 * DAY),
        paid_at: paid ? pgDate(issuedAt + randInt(rng, 1, 28) * DAY) : null,
      };
    },
  },
  {
    name: "members",
    rowCount: MEMBERS,
    rowBytes: 260,
    columns: [
      id,
      column("first_name", "text"),
      column("last_name", "text"),
      column("email", "text"),
      column("phone", "text", { nullable: true }),
      column("company_id", "integer", { nullable: true }),
      column("role", "text"),
      column("membership", "text"),
      column("joined_at", "timestamptz"),
      column("is_active", "boolean"),
    ],
    row(index, rng, anchor) {
      const firstName = pick(rng, FIRST_NAMES);
      const lastName = pick(rng, LAST_NAMES);
      return {
        id: index + 1,
        first_name: firstName,
        last_name: lastName,
        email: `${emailLocalPart(firstName, lastName)}@${pick(rng, EMAIL_DOMAINS)}`,
        phone: chance(rng, 0.12)
          ? null
          : `+261 3${pick(rng, [2, 3, 4, 8])} ${randInt(rng, 10, 99)} ${randInt(rng, 100, 999)} ${randInt(rng, 10, 99)}`,
        company_id: chance(rng, 0.1) ? null : randInt(rng, 1, COMPANIES),
        role: pick(rng, ROLES),
        membership: pick(rng, MEMBERSHIPS),
        joined_at: pgTimestamp(spreadTime(index, MEMBERS, 900 * DAY, anchor, rng)),
        is_active: !chance(rng, 0.06),
      };
    },
  },
  {
    name: "registrations",
    rowCount: 1127,
    rowBytes: 96,
    columns: [
      id,
      column("event_id", "integer"),
      column("member_id", "integer"),
      column("status", "text"),
      column("registered_at", "timestamptz"),
      column("paid", "boolean"),
    ],
    row(index, rng, anchor) {
      const status = pick(rng, ["confirmée", "confirmée", "confirmée", "en attente", "annulée"]);
      return {
        id: index + 1,
        event_id: Math.min(EVENTS, 1 + Math.floor((index / 1127) * EVENTS) + randInt(rng, 0, 2)),
        member_id: randInt(rng, 1, MEMBERS),
        status,
        registered_at: pgTimestamp(spreadTime(index, 1127, 330 * DAY, anchor, rng)),
        paid: status === "confirmée" && !chance(rng, 0.15),
      };
    },
  },
];
