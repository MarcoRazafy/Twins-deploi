/** Tables of the Boutique Vanille e-commerce database. */

import { DAY, pgTimestamp } from "../../text";
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

const CATALOGUE: Array<{ name: string; category: string; code: string; price: number }> = [
  { name: "Gousses de vanille Bourbon", category: "Vanille", code: "VAN", price: 48_000 },
  { name: "Vanille en poudre", category: "Vanille", code: "VAN", price: 36_000 },
  { name: "Extrait de vanille pure", category: "Vanille", code: "VAN", price: 52_000 },
  { name: "Caviar de vanille", category: "Vanille", code: "VAN", price: 64_000 },
  { name: "Poivre sauvage Voatsiperifery", category: "Épices", code: "EPI", price: 28_000 },
  { name: "Poivre noir de Sambirano", category: "Épices", code: "EPI", price: 18_000 },
  { name: "Baies roses", category: "Épices", code: "EPI", price: 16_000 },
  { name: "Cannelle en bâtons", category: "Épices", code: "EPI", price: 12_000 },
  { name: "Clous de girofle de Sainte-Marie", category: "Épices", code: "EPI", price: 14_000 },
  { name: "Curcuma moulu", category: "Épices", code: "EPI", price: 9_000 },
  { name: "Gingembre séché", category: "Épices", code: "EPI", price: 9_500 },
  { name: "Fèves de cacao de Sambirano", category: "Cacao", code: "CAC", price: 32_000 },
  { name: "Grué de cacao", category: "Cacao", code: "CAC", price: 26_000 },
  { name: "Chocolat noir 75 %", category: "Cacao", code: "CAC", price: 15_000 },
  { name: "Thé noir de Sahambavy", category: "Thés et infusions", code: "THE", price: 11_000 },
  { name: "Infusion de ravintsara", category: "Thés et infusions", code: "THE", price: 10_000 },
  { name: "Coffret découverte des épices", category: "Coffrets", code: "COF", price: 95_000 },
  { name: "Coffret pâtissier vanille et cacao", category: "Coffrets", code: "COF", price: 120_000 },
];
const WEIGHTS = ["25 g", "50 g", "100 g", "250 g"];
const ORDER_STATUSES = ["livrée", "livrée", "livrée", "expédiée", "payée", "en attente", "annulée"];
const PAYMENT_METHODS = ["mvola", "mvola", "orange_money", "airtel_money", "carte", "virement"];
const COUNTRIES: Array<{ code: string; cities: readonly string[] }> = [
  { code: "MG", cities: MG_CITIES },
  { code: "MG", cities: MG_CITIES },
  { code: "FR", cities: ["Paris", "Lyon", "Marseille", "Toulouse", "Nantes"] },
  { code: "RE", cities: ["Saint-Denis", "Saint-Pierre", "Le Tampon"] },
  { code: "CA", cities: CA_CITIES },
];
const EMAIL_DOMAINS = ["gmail.com", "yahoo.fr", "moov.mg", "orange.mg", "outlook.com"];

const PRODUCTS = 64;
const CUSTOMERS = 1842;
const ORDERS = 3276;
const ORDER_ITEMS = 7914;

function productAt(index: number): { name: string; category: string; sku: string; price: number } {
  const base = CATALOGUE[index % CATALOGUE.length];
  const weight = WEIGHTS[Math.floor(index / CATALOGUE.length) % WEIGHTS.length];
  const factor = [1, 1.8, 3.2, 7][Math.floor(index / CATALOGUE.length) % WEIGHTS.length];
  const coffret = base.category === "Coffrets";
  return {
    name: coffret ? `${base.name} n° ${Math.floor(index / CATALOGUE.length) + 1}` : `${base.name} — ${weight}`,
    category: base.category,
    sku: `BV-${base.code}-${String(index + 1).padStart(3, "0")}`,
    price: Math.round((base.price * (coffret ? 1 + index / 200 : factor)) / 500) * 500,
  };
}

export const BOUTIQUE_TABLES: TableSpec[] = [
  {
    name: "customers",
    rowCount: CUSTOMERS,
    rowBytes: 190,
    columns: [
      id,
      column("first_name", "text"),
      column("last_name", "text"),
      column("email", "text"),
      column("city", "text"),
      column("country", "char(2)"),
      column("newsletter", "boolean"),
      column("created_at", "timestamptz"),
    ],
    row(index, rng, anchor) {
      const firstName = pick(rng, FIRST_NAMES);
      const lastName = pick(rng, LAST_NAMES);
      const country = pick(rng, COUNTRIES);
      return {
        id: index + 1,
        first_name: firstName,
        last_name: lastName,
        email: `${emailLocalPart(firstName, lastName)}${randInt(rng, 1, 99)}@${pick(rng, EMAIL_DOMAINS)}`,
        city: pick(rng, country.cities),
        country: country.code,
        newsletter: chance(rng, 0.42),
        created_at: pgTimestamp(spreadTime(index, CUSTOMERS, 700 * DAY, anchor, rng)),
      };
    },
  },
  {
    name: "order_items",
    rowCount: ORDER_ITEMS,
    rowBytes: 72,
    columns: [
      id,
      column("order_id", "integer"),
      column("product_id", "integer"),
      column("quantity", "integer"),
      column("unit_price_mga", "integer"),
    ],
    row(index, rng) {
      const productIndex = randInt(rng, 0, PRODUCTS - 1);
      return {
        id: index + 1,
        order_id: Math.min(ORDERS, 1 + Math.floor((index * ORDERS) / ORDER_ITEMS)),
        product_id: productIndex + 1,
        quantity: pick(rng, [1, 1, 1, 2, 2, 3, 6]),
        unit_price_mga: productAt(productIndex).price,
      };
    },
  },
  {
    name: "orders",
    rowCount: ORDERS,
    rowBytes: 150,
    columns: [
      id,
      column("reference", "text"),
      column("customer_id", "integer"),
      column("status", "text"),
      column("total_mga", "integer"),
      column("payment_method", "text"),
      column("created_at", "timestamptz"),
    ],
    row(index, rng, anchor) {
      const createdAt = spreadTime(index, ORDERS, 640 * DAY, anchor, rng);
      const recent = anchor - createdAt < 4 * DAY;
      return {
        id: index + 1,
        reference: `BV-${new Date(createdAt).getUTCFullYear()}-${String(index + 1).padStart(5, "0")}`,
        customer_id: randInt(rng, 1, CUSTOMERS),
        status: recent ? pick(rng, ["payée", "en attente", "expédiée"]) : pick(rng, ORDER_STATUSES),
        total_mga: randInt(rng, 18, 640) * 1000,
        payment_method: pick(rng, PAYMENT_METHODS),
        created_at: pgTimestamp(createdAt),
      };
    },
  },
  {
    name: "products",
    rowCount: PRODUCTS,
    rowBytes: 280,
    columns: [
      id,
      column("sku", "text"),
      column("name", "text"),
      column("category", "text"),
      column("price_mga", "integer"),
      column("stock", "integer"),
      column("is_published", "boolean"),
      column("created_at", "timestamptz"),
    ],
    row(index, rng, anchor) {
      const product = productAt(index);
      return {
        id: index + 1,
        sku: product.sku,
        name: product.name,
        category: product.category,
        price_mga: product.price,
        stock: chance(rng, 0.08) ? 0 : randInt(rng, 4, 380),
        is_published: !chance(rng, 0.1),
        created_at: pgTimestamp(spreadTime(index, PRODUCTS, 620 * DAY, anchor, rng)),
      };
    },
  },
];
