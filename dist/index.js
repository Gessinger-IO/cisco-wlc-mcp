#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RestconfClient, loadConfigFromEnv } from "./restconf.js";
import { listAccessPoints, listWirelessClients, listWlans, listRogueAps, listPolicyProfiles, } from "./wlc.js";
const config = loadConfigFromEnv();
const restconf = new RestconfClient(config);
const server = new McpServer({
    name: "cisco-wlc-mcp",
    version: "0.1.0",
});
server.registerTool("list_access_points", {
    title: "List Access Points",
    description: "Lists access points joined to the Cisco Catalyst 9800 WLC, including name, MAC, IP, and model.",
    inputSchema: {},
}, async () => {
    const aps = await listAccessPoints(restconf);
    return { content: [{ type: "text", text: JSON.stringify(aps, null, 2) }] };
});
server.registerTool("list_wireless_clients", {
    title: "List Wireless Clients",
    description: "Lists wireless clients currently associated to the WLC, including MAC, connected AP, VLAN, and SSID.",
    inputSchema: {},
}, async () => {
    const clients = await listWirelessClients(restconf);
    return { content: [{ type: "text", text: JSON.stringify(clients, null, 2) }] };
});
server.registerTool("list_wlans", {
    title: "List WLANs",
    description: "Lists configured WLANs/SSIDs and their profile names on the WLC.",
    inputSchema: {},
}, async () => {
    const wlans = await listWlans(restconf);
    return { content: [{ type: "text", text: JSON.stringify(wlans, null, 2) }] };
});
server.registerTool("list_policy_profiles", {
    title: "List Policy Profiles",
    description: "Lists Policy Profiles configured on the WLC (name, VLAN interface) together with the WLAN " +
        "profiles mapped to them via each Policy Tag — i.e. which SSID lands on which VLAN interface. " +
        "Note that the mapping is per Policy Tag (assigned per-AP), so the same SSID can in principle " +
        "resolve to a different Policy Profile depending on which AP/Policy Tag serves it.",
    inputSchema: {},
}, async () => {
    const profiles = await listPolicyProfiles(restconf);
    return { content: [{ type: "text", text: JSON.stringify(profiles, null, 2) }] };
});
server.registerTool("list_rogue_aps", {
    title: "List Rogue Access Points",
    description: "Lists rogue access points detected by the WLC, including MAC, SSID, classification and state.",
    inputSchema: {},
}, async () => {
    const rogueAps = await listRogueAps(restconf);
    return { content: [{ type: "text", text: JSON.stringify(rogueAps, null, 2) }] };
});
server.registerTool("restconf_get", {
    title: "Raw RESTCONF GET",
    description: "Fallback/debug tool: performs a raw RESTCONF GET against an arbitrary YANG data path on the WLC " +
        "(e.g. 'Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data'). " +
        "Useful when the normalized tools don't expose a needed field or the YANG model differs by IOS-XE version.",
    inputSchema: {
        path: z
            .string()
            .describe("RESTCONF data path relative to /restconf/data/, e.g. 'Cisco-IOS-XE-wireless-client-oper:client-oper-data'"),
    },
}, async ({ path }) => {
    const data = await restconf.get(path);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});
const transport = new StdioServerTransport();
await server.connect(transport);
