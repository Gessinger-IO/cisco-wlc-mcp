import { RestconfClient } from "./restconf.js";

/** Picks the first defined value among several possible YANG field name variants. */
function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

function firstContainerValue(data: unknown): unknown {
  if (!data || typeof data !== "object") return undefined;
  const values = Object.values(data as Record<string, unknown>);
  return values[0];
}

export interface AccessPointSummary {
  name?: string;
  wtpMac?: string;
  ipAddr?: string;
  model?: string;
  softwareVersion?: string;
}

export async function listAccessPoints(client: RestconfClient): Promise<AccessPointSummary[]> {
  const data = await client.get(
    "Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data/capwap-data"
  );
  const entries = asArray(firstContainerValue(data));

  return entries.map((entry) => {
    const deviceDetail = (entry["device-detail"] as Record<string, unknown>) ?? {};
    const staticInfo = (deviceDetail["static-info"] as Record<string, unknown>) ?? {};
    const boardData = (staticInfo["board-data"] as Record<string, unknown>) ?? {};

    return {
      name: pick(entry, "name", "ap-name") as string | undefined,
      wtpMac: pick(entry, "wtp-mac") as string | undefined,
      ipAddr: pick(entry, "ip-addr") as string | undefined,
      model: pick(boardData, "wtp-model-number") as string | undefined,
      softwareVersion: pick(deviceDetail, "wtp-version", "sw-version") as string | undefined,
    };
  });
}

export interface WirelessClientSummary {
  clientMac?: string;
  apMac?: string;
  connectionState?: string;
  vlanId?: unknown;
  ssid?: string;
}

export async function listWirelessClients(
  client: RestconfClient
): Promise<WirelessClientSummary[]> {
  const data = await client.get(
    "Cisco-IOS-XE-wireless-client-oper:client-oper-data/common-oper-data"
  );
  const entries = asArray(firstContainerValue(data));

  return entries.map((entry) => ({
    clientMac: pick(entry, "client-mac") as string | undefined,
    apMac: pick(entry, "ap-mac") as string | undefined,
    connectionState: pick(entry, "co-state", "client-state") as string | undefined,
    vlanId: pick(entry, "vlan-id"),
    ssid: pick(entry, "ssid") as string | undefined,
  }));
}

export interface WlanSummary {
  wlanId?: unknown;
  profileName?: string;
  ssid?: string;
  enabled?: unknown;
}

export async function listWlans(client: RestconfClient): Promise<WlanSummary[]> {
  const data = await client.get(
    "Cisco-IOS-XE-wireless-wlan-cfg:wlan-cfg-data/wlan-cfg-entries"
  );
  const entries = asArray(firstContainerValue(data));

  return entries.map((entry) => ({
    wlanId: pick(entry, "wlan-id"),
    profileName: pick(entry, "profile-name") as string | undefined,
    ssid: pick(entry, "ssid") as string | undefined,
    enabled: pick(entry, "enable", "is-enabled"),
  }));
}
