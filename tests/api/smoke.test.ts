import { beforeEach, describe, expect, it } from "vitest";

import { createServerApi } from "@/server/api";
import { anonymousContext } from "@/server/context";
import { resetDatabase } from "../helpers/db";

describe("api smoke", () => {
  beforeEach(resetDatabase);

  it("talks to the test database and sets up the owner", async () => {
    expect(process.env.DATABASE_URL).toContain("mini_railway_test");
    const api = createServerApi(anonymousContext());
    const session = await api.auth.setup({ name: "Test Owner", email: "owner@example.test", password: "Motdepasse-solide-42" });
    expect(session.user?.role).toBe("owner");
  });
});
