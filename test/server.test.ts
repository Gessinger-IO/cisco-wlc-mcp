import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RestconfClient } from "../src/restconf.js";
import { createServer } from "../src/server.js";

function fakeRestconf(responses: Record<string, unknown>): RestconfClient {
  const client = new RestconfClient({
    host: "127.0.0.1",
    port: 443,
    username: "u",
    password: "p",
    insecureTls: true,
  });
  client.get = (path: string) => {
    if (!(path in responses)) return Promise.reject(new Error(`unexpected path: ${path}`));
    return Promise.resolve(responses[path]);
  };
  return client;
}

/** Connects a fresh client/server pair over an in-memory transport for one test. */
async function connect(responses: Record<string, unknown>): Promise<Client> {
  const server = createServer(fakeRestconf(responses));
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  const first = result.content[0];
  if (!first || first.type !== "text" || first.text === undefined) {
    throw new Error("expected a text content block");
  }
  return first.text;
}

describe("createServer tool wiring", () => {
  it("lists all 12 registered tools", async () => {
    const client = await connect({});

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "list_access_points",
        "list_wireless_clients",
        "list_wlans",
        "list_policy_profiles",
        "list_ap_radios",
        "list_rogue_aps",
        "get_wlc_health",
        "list_interferers",
        "list_ap_neighbors",
        "get_client_detail",
        "list_ap_tags",
        "restconf_get",
      ].sort()
    );
  });

  // Each of these tools takes no input, fetches one RESTCONF path via a wlc.ts helper, and
  // returns the result as pretty-printed JSON text — this table exercises that wiring for every
  // such tool in one pass, without re-testing the extraction logic itself (covered in wlc.test.ts).
  const simpleTools: { tool: string; path: string; raw: unknown }[] = [
    {
      tool: "list_access_points",
      path: "Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data/capwap-data",
      raw: { "capwap-data": [{ name: "AP1", "wtp-mac": "aa:bb:cc:dd:ee:ff" }] },
    },
    {
      tool: "list_wlans",
      path: "Cisco-IOS-XE-wireless-wlan-cfg:wlan-cfg-data/wlan-cfg-entries",
      raw: { "wlan-cfg-entries": [{ "wlan-id": 1, "profile-name": "corp" }] },
    },
    {
      tool: "list_rogue_aps",
      path: "Cisco-IOS-XE-wireless-rogue-oper:rogue-oper-data/rogue-data",
      raw: { "rogue-data": [] },
    },
    {
      tool: "list_interferers",
      path: "Cisco-IOS-XE-wireless-rrm-oper:rrm-oper-data/spectrum-device-rf-stats",
      raw: { "spectrum-device-rf-stats": [] },
    },
    {
      tool: "list_ap_tags",
      path: "Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data/capwap-data",
      raw: { "capwap-data": [] },
    },
  ];

  for (const { tool, path, raw } of simpleTools) {
    it(`${tool} forwards the RESTCONF result as JSON`, async () => {
      const client = await connect({ [path]: raw });

      const result = await client.callTool({ name: tool, arguments: {} });

      expect(JSON.parse(textOf(result as never))).toBeDefined();
    });
  }

  it("list_policy_profiles joins wlan-policies and policy-list-entries", async () => {
    const client = await connect({
      "Cisco-IOS-XE-wireless-wlan-cfg:wlan-cfg-data/wlan-policies": { "wlan-policies": [] },
      "Cisco-IOS-XE-wireless-wlan-cfg:wlan-cfg-data/policy-list-entries": {
        "policy-list-entries": [],
      },
    });

    const result = await client.callTool({ name: "list_policy_profiles", arguments: {} });

    expect(JSON.parse(textOf(result as never))).toEqual([]);
  });

  it("list_wireless_clients, list_ap_radios, list_ap_neighbors and get_wlc_health tolerate best-effort side lookups failing", async () => {
    // These tools join multiple RESTCONF paths, some of which are wrapped in try/catch upstream;
    // requesting them against a minimal fake client exercises that wiring end-to-end.
    const client = await connect({
      "Cisco-IOS-XE-wireless-client-oper:client-oper-data/common-oper-data": {
        "common-oper-data": [],
      },
      "Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data/radio-oper-data": {
        "radio-oper-data": [],
      },
      "Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data/capwap-data": {
        "capwap-data": [],
      },
      "Cisco-IOS-XE-wireless-rrm-oper:rrm-oper-data/rrm-measurement": { "rrm-measurement": [] },
      "Cisco-IOS-XE-wireless-rrm-oper:rrm-oper-data/ap-auto-rf-dot11-data": {
        "ap-auto-rf-dot11-data": [],
      },
      "Cisco-IOS-XE-process-cpu-oper:cpu-usage/cpu-utilization?fields=five-seconds;one-minute;five-minutes":
        { "cpu-utilization": {} },
      "Cisco-IOS-XE-memory-oper:memory-statistics": { "memory-statistics": {} },
      "Cisco-IOS-XE-device-hardware-oper:device-hardware-data": { "device-hardware-data": {} },
      "Cisco-IOS-XE-wireless-ap-global-oper:ap-global-oper-data/ewlc-ap-stats": {
        "ewlc-ap-stats": {},
      },
      "Cisco-IOS-XE-wireless-ap-global-oper:ap-global-oper-data/emltd-join-count-stat": {
        "emltd-join-count-stat": {},
      },
    });

    for (const tool of [
      "list_wireless_clients",
      "list_ap_radios",
      "list_ap_neighbors",
      "get_wlc_health",
    ]) {
      const result = await client.callTool({ name: tool, arguments: {} });
      expect(result.isError).not.toBe(true);
    }
  });

  it("restconf_get forwards an arbitrary path and returns the raw response", async () => {
    const client = await connect({
      "Cisco-IOS-XE-some-module:some-container": { hello: "world" },
    });

    const result = await client.callTool({
      name: "restconf_get",
      arguments: { path: "Cisco-IOS-XE-some-module:some-container" },
    });

    expect(JSON.parse(textOf(result as never))).toEqual({ hello: "world" });
  });

  it("rejects a restconf_get call missing the required path argument", async () => {
    const client = await connect({});

    const result = await client.callTool({ name: "restconf_get", arguments: {} });

    expect(result.isError).toBe(true);
    expect(textOf(result as never)).toMatch(/path/i);
  });

  describe("get_client_detail", () => {
    it("returns the client's JSON detail when the MAC matches", async () => {
      const client = await connect({
        "Cisco-IOS-XE-wireless-client-oper:client-oper-data/common-oper-data": {
          "common-oper-data": [{ "client-mac": "11:22:33:44:55:66", "ap-name": "AP1" }],
        },
      });

      const result = await client.callTool({
        name: "get_client_detail",
        arguments: { macAddress: "11:22:33:44:55:66" },
      });

      const detail = JSON.parse(textOf(result as never)) as { clientMac: string; apName: string };
      expect(detail.clientMac).toBe("11:22:33:44:55:66");
      expect(detail.apName).toBe("AP1");
    });

    it("returns a human-readable not-found message instead of JSON when no client matches", async () => {
      const client = await connect({
        "Cisco-IOS-XE-wireless-client-oper:client-oper-data/common-oper-data": {
          "common-oper-data": [],
        },
      });

      const result = await client.callTool({
        name: "get_client_detail",
        arguments: { macAddress: "aa:aa:aa:aa:aa:aa" },
      });

      expect(textOf(result as never)).toBe(
        "No currently-associated client found for MAC aa:aa:aa:aa:aa:aa."
      );
    });

    it("rejects a call missing the required macAddress argument", async () => {
      const client = await connect({});

      const result = await client.callTool({ name: "get_client_detail", arguments: {} });

      expect(result.isError).toBe(true);
      expect(textOf(result as never)).toMatch(/macAddress/i);
    });
  });

  it("surfaces a RESTCONF failure as an MCP tool error with the classified message", async () => {
    const client = await connect({});

    const result = await client.callTool({ name: "list_access_points", arguments: {} });

    expect(result.isError).toBe(true);
    expect(textOf(result as never)).toMatch(/unexpected path/);
  });
});
