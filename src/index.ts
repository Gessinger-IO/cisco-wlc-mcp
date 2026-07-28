#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RestconfClient, loadConfigFromEnv } from "./restconf.js";
import {
  listAccessPoints,
  listWirelessClients,
  listWlans,
  listRogueAps,
  listPolicyProfiles,
  listApRadios,
  getWlcHealth,
  listInterferers,
  listApNeighbors,
  getClientDetail,
  listApTags,
} from "./wlc.js";

const config = loadConfigFromEnv();
const restconf = new RestconfClient(config);

const server = new McpServer({
  name: "cisco-wlc-mcp",
  version: "0.1.0",
});

server.registerTool(
  "list_access_points",
  {
    title: "List Access Points",
    description:
      "Lists access points joined to the Cisco Catalyst 9800 WLC, including name, MAC, IP, and model.",
    inputSchema: {},
  },
  async () => {
    const aps = await listAccessPoints(restconf);
    return { content: [{ type: "text", text: JSON.stringify(aps, null, 2) }] };
  }
);

server.registerTool(
  "list_wireless_clients",
  {
    title: "List Wireless Clients",
    description:
      "Lists wireless clients currently associated to the WLC, including MAC, connected AP, WLAN, IPv4, " +
      "and RF diagnostics (channel, band, RSSI, SNR, PHY rate, spatial streams, security mode).",
    inputSchema: {},
  },
  async () => {
    const clients = await listWirelessClients(restconf);
    return { content: [{ type: "text", text: JSON.stringify(clients, null, 2) }] };
  }
);

server.registerTool(
  "list_wlans",
  {
    title: "List WLANs",
    description: "Lists configured WLANs/SSIDs and their profile names on the WLC.",
    inputSchema: {},
  },
  async () => {
    const wlans = await listWlans(restconf);
    return { content: [{ type: "text", text: JSON.stringify(wlans, null, 2) }] };
  }
);

server.registerTool(
  "list_policy_profiles",
  {
    title: "List Policy Profiles",
    description:
      "Lists Policy Profiles configured on the WLC (name, VLAN interface) together with the WLAN " +
      "profiles mapped to them via each Policy Tag — i.e. which SSID lands on which VLAN interface. " +
      "Note that the mapping is per Policy Tag (assigned per-AP), so the same SSID can in principle " +
      "resolve to a different Policy Profile depending on which AP/Policy Tag serves it.",
    inputSchema: {},
  },
  async () => {
    const profiles = await listPolicyProfiles(restconf);
    return { content: [{ type: "text", text: JSON.stringify(profiles, null, 2) }] };
  }
);

server.registerTool(
  "list_ap_radios",
  {
    title: "List AP Radios",
    description:
      "Lists per-radio RF diagnostics for each access point: band, channel, channel width, TX power " +
      "level, admin/oper state, channel utilization (CCA %), associated client count, and noise floor " +
      "on the current channel. Useful for diagnosing coverage/interference issues.",
    inputSchema: {},
  },
  async () => {
    const radios = await listApRadios(restconf);
    return { content: [{ type: "text", text: JSON.stringify(radios, null, 2) }] };
  }
);

server.registerTool(
  "list_rogue_aps",
  {
    title: "List Rogue Access Points",
    description:
      "Lists rogue access points detected by the WLC, including MAC, SSID, classification and state.",
    inputSchema: {},
  },
  async () => {
    const rogueAps = await listRogueAps(restconf);
    return { content: [{ type: "text", text: JSON.stringify(rogueAps, null, 2) }] };
  }
);

server.registerTool(
  "get_wlc_health",
  {
    title: "Get WLC Health",
    description:
      "Reports controller-level health: CPU utilization (5s/1min/5min), memory usage, uptime, " +
      "software version, last reboot reason, joined AP count, radio up/down counts, and " +
      "misconfigured AP count.",
    inputSchema: {},
  },
  async () => {
    const health = await getWlcHealth(restconf);
    return { content: [{ type: "text", text: JSON.stringify(health, null, 2) }] };
  }
);

server.registerTool(
  "list_interferers",
  {
    title: "List CleanAir Interferers",
    description:
      "Lists CleanAir-detected non-Wi-Fi interference sources (microwave ovens, Bluetooth, video " +
      "cameras, jammers, etc.) per AP/channel, with severity, duty cycle and RSSI. Complements " +
      "list_ap_radios (channel utilization) and list_rogue_aps (Wi-Fi interferers) for RF troubleshooting.",
    inputSchema: {},
  },
  async () => {
    const interferers = await listInterferers(restconf);
    return { content: [{ type: "text", text: JSON.stringify(interferers, null, 2) }] };
  }
);

server.registerTool(
  "list_ap_neighbors",
  {
    title: "List AP RF Neighbors",
    description:
      "Lists RRM-observed neighbor relationships between AP radios (which APs hear each other and " +
      "how strongly). Useful for spotting coverage overlap or coverage holes when planning channel/power.",
    inputSchema: {},
  },
  async () => {
    const neighbors = await listApNeighbors(restconf);
    return { content: [{ type: "text", text: JSON.stringify(neighbors, null, 2) }] };
  }
);

server.registerTool(
  "get_client_detail",
  {
    title: "Get Wireless Client Detail",
    description:
      "Deep-dive on a single wireless client by MAC address: the same RF diagnostics as " +
      "list_wireless_clients, plus (best-effort) VLAN/QoS/ACL policy info. Returns nothing if no " +
      "currently-associated client matches the given MAC.",
    inputSchema: {
      macAddress: z
        .string()
        .describe(
          "Client MAC address in any common notation (aa:bb:cc:dd:ee:ff, aa-bb-cc-dd-ee-ff, or aabb.ccdd.eeff)"
        ),
    },
  },
  async ({ macAddress }) => {
    const detail = await getClientDetail(restconf, macAddress);
    if (!detail) {
      return {
        content: [
          { type: "text", text: `No currently-associated client found for MAC ${macAddress}.` },
        ],
      };
    }
    return { content: [{ type: "text", text: JSON.stringify(detail, null, 2) }] };
  }
);

server.registerTool(
  "list_ap_tags",
  {
    title: "List AP Tags",
    description:
      "Lists the Policy/Site/RF tag assignment for each AP. Useful for finding config mismatches, " +
      "e.g. an AP stuck on the default-policy-tag when it should carry a site-specific tag.",
    inputSchema: {},
  },
  async () => {
    const tags = await listApTags(restconf);
    return { content: [{ type: "text", text: JSON.stringify(tags, null, 2) }] };
  }
);

server.registerTool(
  "restconf_get",
  {
    title: "Raw RESTCONF GET",
    description:
      "Fallback/debug tool: performs a raw RESTCONF GET against an arbitrary YANG data path on the WLC " +
      "(e.g. 'Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data'). " +
      "Useful when the normalized tools don't expose a needed field or the YANG model differs by IOS-XE version.",
    inputSchema: {
      path: z
        .string()
        .describe(
          "RESTCONF data path relative to /restconf/data/, e.g. 'Cisco-IOS-XE-wireless-client-oper:client-oper-data'"
        ),
    },
  },
  async ({ path }) => {
    const data = await restconf.get(path);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
