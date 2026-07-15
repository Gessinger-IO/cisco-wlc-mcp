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
  if (value && typeof value === "object") {
    // RESTCONF often wraps a list one level deeper under its own YANG list name,
    // e.g. { "wlan-cfg-entries": { "wlan-cfg-entry": [...] } }. If this object has
    // exactly one property and that property is an array, unwrap it.
    const entries = Object.values(value as Record<string, unknown>);
    if (entries.length === 1 && Array.isArray(entries[0])) {
      return entries[0] as Record<string, unknown>[];
    }
    return [value as Record<string, unknown>];
  }
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
    const apModels = (staticInfo["ap-models"] as Record<string, unknown>) ?? {};
    const wtpVersion = (deviceDetail["wtp-version"] as Record<string, unknown>) ?? {};

    return {
      name: pick(entry, "name", "ap-name") as string | undefined,
      wtpMac: pick(entry, "wtp-mac") as string | undefined,
      ipAddr: pick(entry, "ip-addr") as string | undefined,
      model: (pick(apModels, "model") ?? pick(boardData, "wtp-model-number")) as string | undefined,
      softwareVersion: pick(wtpVersion, "sw-version") as string | undefined,
    };
  });
}

function extractIpv4(entry: Record<string, unknown>): string | undefined {
  const direct = pick(entry, "ipv4-address", "ip-addr");
  if (typeof direct === "string") return direct;

  const bindings = asArray(pick(entry, "ipv4-binding", "ipv4-binding-list"));
  for (const binding of bindings) {
    const ipKey = (binding["ip-key"] as Record<string, unknown>) ?? binding;
    const ip = pick(ipKey, "ip-addr", "ipv4-address");
    if (typeof ip === "string") return ip;
  }
  return undefined;
}

/** Best-effort client-mac -> IPv4 lookup. Returns an empty map if the path doesn't exist on this device. */
async function buildIpv4Map(client: RestconfClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let data: unknown;
  try {
    data = await client.get("Cisco-IOS-XE-wireless-client-oper:client-oper-data/sisf-db-mac");
  } catch {
    return map;
  }
  const entries = asArray(firstContainerValue(data));
  for (const entry of entries) {
    const mac = pick(entry, "client-mac", "mac-addr") as string | undefined;
    const ip = extractIpv4(entry);
    if (mac && ip) map.set(mac, ip);
  }
  return map;
}

export interface WirelessClientSummary {
  clientMac?: string;
  apName?: string;
  connectionState?: string;
  wlanId?: unknown;
  ipv4Address?: string;
}

export async function listWirelessClients(
  client: RestconfClient
): Promise<WirelessClientSummary[]> {
  const [data, ipv4Map] = await Promise.all([
    client.get("Cisco-IOS-XE-wireless-client-oper:client-oper-data/common-oper-data"),
    buildIpv4Map(client),
  ]);
  const entries = asArray(firstContainerValue(data));

  return entries.map((entry) => {
    const clientMac = pick(entry, "client-mac") as string | undefined;
    return {
      clientMac,
      apName: pick(entry, "ap-name") as string | undefined,
      connectionState: pick(entry, "co-state", "client-state") as string | undefined,
      wlanId: pick(entry, "wlan-id"),
      ipv4Address: clientMac ? ipv4Map.get(clientMac) : undefined,
    };
  });
}

export interface WlanSummary {
  wlanId?: unknown;
  profileName?: string;
  ssid?: string;
  enabled?: unknown;
}

export async function listWlans(client: RestconfClient): Promise<WlanSummary[]> {
  const data = await client.get("Cisco-IOS-XE-wireless-wlan-cfg:wlan-cfg-data/wlan-cfg-entries");
  const entries = asArray(firstContainerValue(data));

  return entries.map((entry) => {
    const vapIdData = (entry["apf-vap-id-data"] as Record<string, unknown>) ?? {};

    return {
      wlanId: pick(entry, "wlan-id"),
      profileName: pick(entry, "profile-name") as string | undefined,
      ssid: pick(vapIdData, "ssid") as string | undefined,
      enabled: pick(vapIdData, "wlan-status", "enable", "is-enabled"),
    };
  });
}

/** Some numeric YANG leafs (e.g. rssi) serialize as { val, num, den } instead of a plain number. */
function numericVal(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "val" in value) {
    return (value as Record<string, unknown>).val as number | undefined;
  }
  return undefined;
}

export interface RogueDetectingAp {
  apName?: string;
  rssi?: number;
}

export interface RogueApSummary {
  rogueMac?: string;
  ssid?: string;
  ssidAtMaxRssi?: string;
  classification?: string;
  state?: string;
  containmentLevel?: unknown;
  onMyNetwork?: unknown;
  firstSeen?: string;
  lastSeen?: string;
  detectedBy?: RogueDetectingAp[];
}

export async function listRogueAps(client: RestconfClient): Promise<RogueApSummary[]> {
  const data = await client.get("Cisco-IOS-XE-wireless-rogue-oper:rogue-oper-data/rogue-data");
  const entries = asArray(firstContainerValue(data));

  return entries.map((entry) => ({
    rogueMac: pick(entry, "rogue-address") as string | undefined,
    ssid: pick(entry, "last-heard-ssid") as string | undefined,
    ssidAtMaxRssi: pick(entry, "ssid-max-rssi") as string | undefined,
    classification: pick(entry, "rogue-class-type") as string | undefined,
    state: pick(entry, "rogue-mode") as string | undefined,
    containmentLevel: pick(entry, "rogue-containment-level"),
    onMyNetwork: pick(entry, "rogue-is-on-my-network"),
    detectedBy: asArray(pick(entry, "rogue-lrad")).map((lrad) => ({
      apName: pick(lrad, "name") as string | undefined,
      rssi: numericVal(pick(lrad, "rssi")),
    })),
    firstSeen: pick(entry, "rogue-first-timestamp") as string | undefined,
    lastSeen: pick(entry, "rogue-last-timestamp") as string | undefined,
  }));
}
