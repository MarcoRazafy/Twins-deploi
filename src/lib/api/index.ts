import { createMockApi } from "@/lib/mock";
import type { Api } from "./contract";
import { createHttpApi } from "./http";
/**
 * Single switch point: NEXT_PUBLIC_API_MODE=http talks to the real backend
 * (POST /api/rpc + SSE, see docs/BACKEND.md), anything else runs the
 * in-browser simulator.
 */
export const API_MODE: "http" | "mock" =
  process.env.NEXT_PUBLIC_API_MODE === "http" ? "http" : "mock";

export const api: Api = API_MODE === "http" ? createHttpApi() : createMockApi();
export * from "./contract";
