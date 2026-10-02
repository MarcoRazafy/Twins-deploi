import type { Api } from "@/lib/api/contract";
import type { AuthSession } from "@/lib/types";

import type { MockDb } from "../schema";
import { read } from "./respond";

/** The demo has no accounts: every visitor is signed in as the seeded profile. */
const session = (db: MockDb): AuthSession => ({ status: "authenticated", user: db.profile });

export const authApi: Api["auth"] = {
  getSession: () => read(session),
  setup: () => read(session),
  login: () => read(session),
  logout: async () => {},
};
