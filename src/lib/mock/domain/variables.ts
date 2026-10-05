import type { EnvVariable, ID, ISODate, Service } from "@/lib/types";
import { BUILTIN_VARIABLE_PREFIX } from "@/lib/variables/builtin";

import { conflict, invalid } from "../errors";
import { newId } from "../ids";
import type { MockDb } from "../schema";
import { iso } from "../text";

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertValidKey(key: string): void {
  if (!key) throw invalid("Le nom de la variable est requis.", "key");
  if (!KEY_PATTERN.test(key)) {
    throw invalid(
      `« ${key} » n’est pas un nom de variable valide : utilisez des lettres, des chiffres et « _ », sans commencer par un chiffre.`,
      "key",
    );
  }
  if (key.startsWith(BUILTIN_VARIABLE_PREFIX)) {
    throw invalid(
      `Les noms commençant par ${BUILTIN_VARIABLE_PREFIX} sont réservés aux variables fournies par la plateforme.`,
      "key",
    );
  }
}

/** Keys that usually hold credentials are sealed unless stated otherwise. */
export function looksSecret(key: string): boolean {
  return /SECRET|TOKEN|PASSWORD|KEY|URL/i.test(key);
}

export function scopeVariables(db: MockDb, projectId: ID, serviceId: ID | null): EnvVariable[] {
  return db.variables.filter(
    (variable) => variable.projectId === projectId && variable.serviceId === serviceId,
  );
}

export function assertKeyAvailable(
  db: MockDb,
  projectId: ID,
  serviceId: ID | null,
  key: string,
  exceptId?: ID,
): void {
  const taken = scopeVariables(db, projectId, serviceId).some(
    (variable) => variable.key === key && variable.id !== exceptId,
  );
  if (taken) throw conflict(`La variable ${key} existe déjà.`, "key");
}

export function addVariable(
  db: MockDb,
  input: {
    projectId: ID;
    serviceId: ID | null;
    key: string;
    value: string;
    isSecret?: boolean;
    createdAt?: ISODate;
  },
): EnvVariable {
  const now = input.createdAt ?? iso();
  const variable: EnvVariable = {
    id: newId("var"),
    projectId: input.projectId,
    serviceId: input.serviceId,
    key: input.key,
    value: input.value,
    isSecret: input.isSecret ?? looksSecret(input.key),
    createdAt: now,
    updatedAt: now,
  };
  db.variables.unshift(variable);
  return variable;
}

/** Variables visible to a service: its own, plus the shared ones of the project. */
export function effectiveVariables(db: MockDb, service: Service): EnvVariable[] {
  return db.variables.filter(
    (variable) =>
      variable.projectId === service.projectId &&
      (variable.serviceId === service.id || variable.serviceId === null),
  );
}

/** Demo switch: a non-empty FAIL_BUILD variable makes the next build fail. */
export function hasFailBuild(db: MockDb, service: Service): boolean {
  return effectiveVariables(db, service).some(
    (variable) => variable.key === "FAIL_BUILD" && variable.value.trim() !== "",
  );
}
