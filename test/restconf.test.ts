import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RestconfClient, loadConfigFromEnv } from "../src/restconf.js";

describe("loadConfigFromEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.WLC_HOST;
    delete process.env.WLC_USERNAME;
    delete process.env.WLC_PASSWORD;
    delete process.env.WLC_PORT;
    delete process.env.WLC_INSECURE_TLS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when required variables are missing", () => {
    expect(() => loadConfigFromEnv()).toThrow(/WLC_HOST, WLC_USERNAME, WLC_PASSWORD/);
  });

  it("applies defaults for port and insecureTls", () => {
    process.env.WLC_HOST = "wlc.example.com";
    process.env.WLC_USERNAME = "admin";
    process.env.WLC_PASSWORD = "secret";

    expect(loadConfigFromEnv()).toEqual({
      host: "wlc.example.com",
      port: 443,
      username: "admin",
      password: "secret",
      insecureTls: false,
    });
  });

  it("parses WLC_PORT and WLC_INSECURE_TLS overrides", () => {
    process.env.WLC_HOST = "wlc.example.com";
    process.env.WLC_USERNAME = "admin";
    process.env.WLC_PASSWORD = "secret";
    process.env.WLC_PORT = "8443";
    process.env.WLC_INSECURE_TLS = "true";

    const config = loadConfigFromEnv();

    expect(config.port).toBe(8443);
    expect(config.insecureTls).toBe(true);
  });
});

describe("RestconfClient", () => {
  it("wraps connection failures with the request path", async () => {
    // Port 1 is a reserved port that nothing listens on; the connection is refused immediately.
    const client = new RestconfClient({
      host: "127.0.0.1",
      port: 1,
      username: "u",
      password: "p",
      insecureTls: true,
    });

    await expect(client.get("some/path")).rejects.toThrow(/RESTCONF GET some\/path failed/);
  });
});
