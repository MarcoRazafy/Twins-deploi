/**
 * Variables reach the container: shared ones, a service variable overriding a
 * shared one, references resolved at deploy time, secrets never logged.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Api } from "@/lib/api/contract";
import type { Project, Service } from "@/lib/types";

import {
  createImageService,
  createProject,
  deployNow,
  DockerJanitor,
  dockerCli,
  envOf,
  httpGet,
  inspect,
  NGINX,
  ownerApi,
  removeDataDir,
  serviceRow,
} from "./helpers";

const SECRET = "s3cr3t-valeur-unique-9f2c";

describe("pipeline: variables", () => {
  const janitor = new DockerJanitor();
  let api: Api;
  let project: Project;
  let service: Service;

  beforeAll(async () => {
    api = await ownerApi();
    project = await createProject(api, janitor, "pipetest-vars");
  });

  afterAll(async () => {
    try {
      await janitor.sweep();
    } finally {
      await removeDataDir();
    }
  });

  it("injects shared and service variables, the service one winning, references resolved", async () => {
    const shared = async (key: string, value: string): Promise<void> => {
      await api.variables.create({ projectId: project.id, serviceId: null, key, value });
    };
    await shared("GREETING", "bonjour-partage");
    await shared("BASE_URL", "https://api.example.test");
    await shared("SHARED_ONLY", "oui");

    const created = await createImageService(api, janitor, {
      projectId: project.id,
      image: NGINX.image,
      tag: NGINX.tag,
      name: "Web",
      port: NGINX.port,
      variables: [{ key: "GREETING", value: "bonjour-service" }],
    });
    service = created.service;
    const own = async (key: string, value: string, isSecret = false): Promise<void> => {
      await api.variables.create({ projectId: project.id, serviceId: service.id, key, value, isSecret });
    };
    await own("API_URL", "${{shared.BASE_URL}}/v1");
    await own("SELF_URL", "http://${{Web.TWINS_PRIVATE_DOMAIN}}:${{Web.PORT}}");
    await own("SECRET_TOKEN", SECRET, true);
    await own("MISSING_REF", "${{shared.NOPE}}");
    // HTTP health check on a path nginx serves (200).
    await api.services.update(service.id, { config: { healthcheckPath: "/" } });

    const row = await deployNow(created.deploymentId);
    expect(row.status).toBe("active");

    const live = await serviceRow(service.id);
    const container = await inspect(live.containerName ?? "");
    if (!container) throw new Error("the live container does not exist");
    expect(envOf(container)).toMatchObject({
      GREETING: "bonjour-service",
      BASE_URL: "https://api.example.test",
      SHARED_ONLY: "oui",
      API_URL: "https://api.example.test/v1",
      SELF_URL: "http://web.twinsdeploi.internal:80",
      SECRET_TOKEN: SECRET,
      MISSING_REF: "",
      PORT: "80",
      TWINS_SERVICE_NAME: "Web",
    });

    // In the environment of the running process, not only in Docker's record.
    const printed = await dockerCli(["exec", live.containerName ?? "", "printenv", "API_URL"]);
    expect(printed.stdout.trim()).toBe("https://api.example.test/v1");
    expect((await httpGet(live.hostPort ?? 0, "/")).status).toBe(200);

    const logs = await api.deployments.getLogs(row.id);
    const messages = logs.map((line) => line.message);
    expect(messages).toContain(`Waiting for the container to be healthy (GET http://127.0.0.1:${live.hostPort}/, up to 60s)`);
    expect(
      logs.some((line) => line.level === "warn" && line.message.includes("Référence inconnue : ${{shared.NOPE}}")),
    ).toBe(true);
    // Values never reach the logs.
    for (const value of [SECRET, "bonjour-service", "https://api.example.test/v1"]) {
      expect(messages.some((message) => message.includes(value)), value).toBe(false);
    }
  });

  it("reads the variables again at each deployment", async () => {
    const [override] = await api.variables.list({ projectId: project.id, serviceId: service.id }).then((rows) =>
      rows.filter((variable) => variable.key === "GREETING"),
    );
    if (!override) throw new Error("the service variable GREETING is missing");
    await api.variables.delete(override.id);
    const [shared] = await api.variables.list({ projectId: project.id, serviceId: null }).then((rows) =>
      rows.filter((variable) => variable.key === "BASE_URL"),
    );
    if (!shared) throw new Error("the shared variable BASE_URL is missing");
    await api.variables.update(shared.id, { value: "https://autre.example.test" });

    const next = await api.deployments.trigger(service.id, { trigger: "config" });
    expect((await deployNow(next.id)).status).toBe("active");

    const live = await serviceRow(service.id);
    const container = await inspect(live.containerName ?? "");
    if (!container) throw new Error("the live container does not exist");
    const env = envOf(container);
    // Without the override the shared value applies; the reference follows the new value.
    expect(env.GREETING).toBe("bonjour-partage");
    expect(env.API_URL).toBe("https://autre.example.test/v1");
    expect(env.TWINS_DEPLOYMENT_ID).toBe(next.id);
  });
});
