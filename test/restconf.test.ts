import { describe, it, expect, beforeEach, afterEach } from "vitest";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { RestconfClient, loadConfigFromEnv } from "../src/restconf.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const tlsKey = fs.readFileSync(path.join(fixturesDir, "key.pem"));
const tlsCert = fs.readFileSync(path.join(fixturesDir, "cert.pem"));

/** Starts a throwaway HTTPS server that always responds with the given status/body, for exercising RestconfClient's error handling. */
async function withTestServer(
  status: number,
  body: unknown,
  run: (port: number) => Promise<void>
): Promise<void> {
  const server = https.createServer({ key: tlsKey, cert: tlsCert }, (_req, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    await run(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

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

  it("gives an actionable hint for connection refused", async () => {
    const client = new RestconfClient({
      host: "127.0.0.1",
      port: 1,
      username: "u",
      password: "p",
      insecureTls: true,
    });

    await expect(client.get("some/path")).rejects.toThrow(
      /connection refused by 127\.0\.0\.1:1 — is RESTCONF enabled/
    );
  });

  it("gives an actionable hint for unresolvable hosts", async () => {
    const client = new RestconfClient({
      host: "this-host-does-not-exist.invalid",
      port: 443,
      username: "u",
      password: "p",
      insecureTls: true,
    });

    await expect(client.get("some/path")).rejects.toThrow(
      /could not resolve host "this-host-does-not-exist\.invalid" — check WLC_HOST/
    );
  });

  it("gives an actionable hint for HTTP 401 responses", async () => {
    await withTestServer(401, { error: "unauthorized" }, async (port) => {
      const client = new RestconfClient({
        host: "127.0.0.1",
        port,
        username: "u",
        password: "p",
        insecureTls: true,
      });

      await expect(client.get("some/path")).rejects.toThrow(
        /HTTP 401.*authentication failed — check WLC_USERNAME\/WLC_PASSWORD/s
      );
    });
  });

  it("gives an actionable hint for HTTP 403 responses", async () => {
    await withTestServer(403, { error: "forbidden" }, async (port) => {
      const client = new RestconfClient({
        host: "127.0.0.1",
        port,
        username: "u",
        password: "p",
        insecureTls: true,
      });

      await expect(client.get("some/path")).rejects.toThrow(
        /HTTP 403.*forbidden.*privilege level/s
      );
    });
  });

  it("gives an actionable hint for HTTP 404 responses", async () => {
    await withTestServer(404, { error: "not found" }, async (port) => {
      const client = new RestconfClient({
        host: "127.0.0.1",
        port,
        username: "u",
        password: "p",
        insecureTls: true,
      });

      await expect(client.get("some/path")).rejects.toThrow(
        /HTTP 404.*YANG path not found.*differ between IOS-XE versions/s
      );
    });
  });

  it("includes the response body for diagnosis", async () => {
    await withTestServer(500, { "error-message": "boom" }, async (port) => {
      const client = new RestconfClient({
        host: "127.0.0.1",
        port,
        username: "u",
        password: "p",
        insecureTls: true,
      });

      await expect(client.get("some/path")).rejects.toThrow(/error-message.*boom/s);
    });
  });

  it("rejects self-signed certificates without WLC_INSECURE_TLS", async () => {
    await withTestServer(200, {}, async (port) => {
      const client = new RestconfClient({
        host: "127.0.0.1",
        port,
        username: "u",
        password: "p",
        insecureTls: false,
      });

      await expect(client.get("some/path")).rejects.toThrow(
        /TLS certificate validation failed.*WLC_INSECURE_TLS=true/s
      );
    });
  });

  it("returns the parsed response body on success", async () => {
    await withTestServer(200, { "some-container": { hello: "world" } }, async (port) => {
      const client = new RestconfClient({
        host: "127.0.0.1",
        port,
        username: "u",
        password: "p",
        insecureTls: true,
      });

      await expect(client.get("some/path")).resolves.toEqual({
        "some-container": { hello: "world" },
      });
    });
  });

  it("gives an actionable hint for HTTP 400 responses", async () => {
    await withTestServer(400, { error: "bad request" }, async (port) => {
      const client = new RestconfClient({
        host: "127.0.0.1",
        port,
        username: "u",
        password: "p",
        insecureTls: true,
      });

      await expect(client.get("some/path")).rejects.toThrow(/HTTP 400.*malformed request/s);
    });
  });

  it("falls back to a generic message for unmapped HTTP status codes", async () => {
    await withTestServer(418, { error: "I'm a teapot" }, async (port) => {
      const client = new RestconfClient({
        host: "127.0.0.1",
        port,
        username: "u",
        password: "p",
        insecureTls: true,
      });

      await expect(client.get("some/path")).rejects.toThrow(
        /HTTP 418.*unexpected response from the WLC/s
      );
    });
  });

  it("omits the Response suffix when the body is empty", async () => {
    await withTestServer(500, "", async (port) => {
      const client = new RestconfClient({
        host: "127.0.0.1",
        port,
        username: "u",
        password: "p",
        insecureTls: true,
      });

      let message = "";
      try {
        await client.get("some/path");
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toMatch(/Response:/);
    });
  });

  it("includes a string (non-JSON) response body verbatim", async () => {
    await withTestServer(500, "<html>gateway error</html>", async (port) => {
      const client = new RestconfClient({
        host: "127.0.0.1",
        port,
        username: "u",
        password: "p",
        insecureTls: true,
      });

      await expect(client.get("some/path")).rejects.toThrow(/<html>gateway error<\/html>/);
    });
  });

  // The following network-level branches (timeout, host-unreachable, and the generic fallback for
  // an unrecognized errno) are impractical to trigger deterministically and quickly through a real
  // socket in a test suite, so they're exercised directly against the private classifier instead.
  describe("network error classification", () => {
    function describeNetworkError(code: string | undefined, message: string): string {
      const client = new RestconfClient({
        host: "wlc.example.com",
        port: 443,
        username: "u",
        password: "p",
        insecureTls: true,
      });
      return (
        client as unknown as { describeNetworkError: (e: unknown) => string }
      ).describeNetworkError({ code, message });
    }

    it("flags a timed-out connection", () => {
      expect(describeNetworkError("ECONNABORTED", "timeout of 15000ms exceeded")).toMatch(
        /timed out after 15000ms connecting to wlc\.example\.com:443/
      );
    });

    it("flags an unreachable host/network", () => {
      expect(describeNetworkError("EHOSTUNREACH", "connect EHOSTUNREACH")).toMatch(
        /host wlc\.example\.com:443 unreachable — check routing\/firewall/
      );
      expect(describeNetworkError("ENETUNREACH", "connect ENETUNREACH")).toMatch(
        /host wlc\.example\.com:443 unreachable/
      );
    });

    it("falls back to the raw code and message for unrecognized errors", () => {
      expect(describeNetworkError("ECONNRESET", "socket hang up")).toBe(
        "ECONNRESET: socket hang up"
      );
    });

    it("falls back to the raw message when there's no error code", () => {
      expect(describeNetworkError(undefined, "something odd happened")).toBe(
        "something odd happened"
      );
    });
  });
});
