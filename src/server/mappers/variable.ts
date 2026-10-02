import type { EnvVariable as EnvVariableRow } from "@/generated/prisma/client";
import type { EnvVariable } from "@/lib/types";

import { variableValue } from "../variables/store";

/** Decrypts the value: only call it to answer an authorised user. */
export function toEnvVariable(row: EnvVariableRow): EnvVariable {
  return {
    id: row.id,
    projectId: row.projectId,
    serviceId: row.serviceId,
    key: row.key,
    value: variableValue(row),
    isSecret: row.isSecret,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
