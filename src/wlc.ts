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

interface RadioInfo {
  channel?: number;
  band?: string;
  securityMode?: string;
}

/** Maps the wireless YANG's radio-type enum to a human-readable band. Unknown values pass through as-is. */
const RADIO_BAND_LABELS: Record<string, string> = {
  "dot11-radio-type-bg": "2.4GHz",
  "dot11-radio-type-a": "5GHz",
  "dot11-radio-type-6ghz": "6GHz",
};

function radioBandLabel(radioType: unknown): string | undefined {
  if (typeof radioType !== "string") return undefined;
  return RADIO_BAND_LABELS[radioType] ?? radioType;
}

/** Best-effort client-mac -> channel/band/security lookup. Returns an empty map if the path doesn't exist on this device. */
async function buildRadioMap(client: RestconfClient): Promise<Map<string, RadioInfo>> {
  const map = new Map<string, RadioInfo>();
  let data: unknown;
  try {
    data = await client.get("Cisco-IOS-XE-wireless-client-oper:client-oper-data/dot11-oper-data");
  } catch {
    return map;
  }
  const entries = asArray(firstContainerValue(data));
  for (const entry of entries) {
    const mac = pick(entry, "ms-mac-address") as string | undefined;
    if (!mac) continue;
    map.set(mac, {
      channel: pick(entry, "current-channel") as number | undefined,
      band: radioBandLabel(pick(entry, "radio-type")),
      securityMode: pick(entry, "security-mode") as string | undefined,
    });
  }
  return map;
}

interface SignalInfo {
  rssi?: number;
  snr?: number;
  dataRate?: string;
  phyRateMbps?: number;
  spatialStreams?: number;
}

/** Best-effort client-mac -> RSSI/SNR/rate lookup. Returns an empty map if the path doesn't exist on this device. */
async function buildSignalMap(client: RestconfClient): Promise<Map<string, SignalInfo>> {
  const map = new Map<string, SignalInfo>();
  let data: unknown;
  try {
    data = await client.get("Cisco-IOS-XE-wireless-client-oper:client-oper-data/traffic-stats");
  } catch {
    return map;
  }
  const entries = asArray(firstContainerValue(data));
  for (const entry of entries) {
    const mac = pick(entry, "ms-mac-address") as string | undefined;
    if (!mac) continue;
    map.set(mac, {
      rssi: pick(entry, "most-recent-rssi") as number | undefined,
      snr: pick(entry, "most-recent-snr") as number | undefined,
      dataRate: pick(entry, "current-rate") as string | undefined,
      phyRateMbps: pick(entry, "speed") as number | undefined,
      spatialStreams: pick(entry, "spatial-stream") as number | undefined,
    });
  }
  return map;
}

export interface WirelessClientSummary {
  clientMac?: string;
  apName?: string;
  connectionState?: string;
  wlanId?: unknown;
  ipv4Address?: string;
  channel?: number;
  band?: string;
  securityMode?: string;
  rssi?: number;
  snr?: number;
  dataRate?: string;
  phyRateMbps?: number;
  spatialStreams?: number;
}

export async function listWirelessClients(
  client: RestconfClient
): Promise<WirelessClientSummary[]> {
  const [data, ipv4Map, radioMap, signalMap] = await Promise.all([
    client.get("Cisco-IOS-XE-wireless-client-oper:client-oper-data/common-oper-data"),
    buildIpv4Map(client),
    buildRadioMap(client),
    buildSignalMap(client),
  ]);
  const entries = asArray(firstContainerValue(data));

  return entries.map((entry) => {
    const clientMac = pick(entry, "client-mac") as string | undefined;
    const radio = (clientMac && radioMap.get(clientMac)) || {};
    const signal = (clientMac && signalMap.get(clientMac)) || {};

    return {
      clientMac,
      apName: pick(entry, "ap-name") as string | undefined,
      connectionState: pick(entry, "co-state", "client-state") as string | undefined,
      wlanId: pick(entry, "wlan-id"),
      ipv4Address: clientMac ? ipv4Map.get(clientMac) : undefined,
      channel: radio.channel,
      band: radio.band,
      securityMode: radio.securityMode,
      rssi: signal.rssi,
      snr: signal.snr,
      dataRate: signal.dataRate,
      phyRateMbps: signal.phyRateMbps,
      spatialStreams: signal.spatialStreams,
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

export interface PolicyProfileMapping {
  policyTagName?: string;
  wlanProfileName?: string;
}

export interface PolicyProfileSummary {
  name?: string;
  interfaceName?: string;
  enabled?: unknown;
  mappings: PolicyProfileMapping[];
}

/**
 * Policy Profiles carry the VLAN interface; which WLAN maps to which Policy Profile is decided
 * per Policy Tag (assigned per-AP), not by the WLAN itself — so the same SSID can in principle
 * land on different VLANs depending on which Policy Tag the serving AP has.
 */
export async function listPolicyProfiles(client: RestconfClient): Promise<PolicyProfileSummary[]> {
  const [policiesData, tagsData] = await Promise.all([
    client.get("Cisco-IOS-XE-wireless-wlan-cfg:wlan-cfg-data/wlan-policies"),
    client.get("Cisco-IOS-XE-wireless-wlan-cfg:wlan-cfg-data/policy-list-entries"),
  ]);

  const profiles = asArray(firstContainerValue(policiesData));
  const tags = asArray(firstContainerValue(tagsData));

  const mappingsByProfile = new Map<string, PolicyProfileMapping[]>();
  for (const tag of tags) {
    const tagName = pick(tag, "tag-name") as string | undefined;
    const wlanPolicies = asArray(pick(tag, "wlan-policies"));

    for (const wlanPolicy of wlanPolicies) {
      const policyProfileName = pick(wlanPolicy, "policy-profile-name") as string | undefined;
      if (!policyProfileName) continue;

      const mappings = mappingsByProfile.get(policyProfileName) ?? [];
      mappings.push({
        policyTagName: tagName,
        wlanProfileName: pick(wlanPolicy, "wlan-profile-name") as string | undefined,
      });
      mappingsByProfile.set(policyProfileName, mappings);
    }
  }

  return profiles.map((profile) => {
    const name = pick(profile, "policy-profile-name") as string | undefined;

    return {
      name,
      interfaceName: pick(profile, "interface-name") as string | undefined,
      enabled: pick(profile, "status"),
      mappings: (name && mappingsByProfile.get(name)) || [],
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

function radioKey(wtpMac: string, radioSlotId: unknown): string {
  return `${wtpMac}|${String(radioSlotId)}`;
}

/** Maps the AP radio-oper-data band enum to a human-readable band. Unknown values pass through as-is. */
const ACTIVE_BAND_LABELS: Record<string, string> = {
  "dot11-2-dot-4-ghz-band": "2.4GHz",
  "dot11-5-ghz-band": "5GHz",
  "dot11-6-ghz-band": "6GHz",
};

function activeBandLabel(band: unknown): string | undefined {
  if (typeof band !== "string") return undefined;
  return ACTIVE_BAND_LABELS[band] ?? band;
}

/** Best-effort wtp-mac -> AP name lookup. Returns an empty map if the path doesn't exist on this device. */
async function buildApNameMap(client: RestconfClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let data: unknown;
  try {
    data = await client.get(
      "Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data/capwap-data"
    );
  } catch {
    return map;
  }
  const entries = asArray(firstContainerValue(data));
  for (const entry of entries) {
    const mac = pick(entry, "wtp-mac") as string | undefined;
    const name = pick(entry, "name", "ap-name") as string | undefined;
    if (mac && name) map.set(mac, name);
  }
  return map;
}

interface RrmLoadInfo {
  channelUtilizationPercent?: number;
  clientCount?: number;
  noiseByChannel: Map<number, number>;
}

/** Best-effort (wtp-mac, radio-slot) -> channel load/noise lookup. Returns an empty map if the path doesn't exist on this device. */
async function buildRrmMap(client: RestconfClient): Promise<Map<string, RrmLoadInfo>> {
  const map = new Map<string, RrmLoadInfo>();
  let data: unknown;
  try {
    data = await client.get("Cisco-IOS-XE-wireless-rrm-oper:rrm-oper-data/rrm-measurement");
  } catch {
    return map;
  }
  const entries = asArray(firstContainerValue(data));
  for (const entry of entries) {
    const wtpMac = pick(entry, "wtp-mac") as string | undefined;
    if (!wtpMac) continue;
    const radioSlotId = pick(entry, "radio-slot-id");

    const load = (entry["load"] as Record<string, unknown>) ?? {};
    const noiseContainer = (entry["noise"] as Record<string, unknown>)?.["noise"] as
      Record<string, unknown> | undefined;
    const noiseByChannel = new Map<number, number>();
    for (const chanNoise of asArray(pick(noiseContainer ?? {}, "noise-data"))) {
      const chan = pick(chanNoise, "chan") as number | undefined;
      const noise = pick(chanNoise, "noise") as number | undefined;
      if (chan !== undefined && noise !== undefined) noiseByChannel.set(chan, noise);
    }

    map.set(radioKey(wtpMac, radioSlotId), {
      channelUtilizationPercent: pick(load, "cca-util-percentage") as number | undefined,
      clientCount: pick(load, "stations") as number | undefined,
      noiseByChannel,
    });
  }
  return map;
}

export interface ApRadioSummary {
  apName?: string;
  wtpMac?: string;
  radioSlotId?: unknown;
  band?: string;
  channel?: number;
  channelWidthMhz?: number;
  txPowerLevel?: number;
  adminState?: string;
  operState?: string;
  channelUtilizationPercent?: number;
  clientCount?: number;
  noiseFloor?: number;
}

export async function listApRadios(client: RestconfClient): Promise<ApRadioSummary[]> {
  const [data, apNameMap, rrmMap] = await Promise.all([
    client.get("Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data/radio-oper-data"),
    buildApNameMap(client),
    buildRrmMap(client),
  ]);
  const entries = asArray(firstContainerValue(data));

  return entries.map((entry) => {
    const wtpMac = pick(entry, "wtp-mac") as string | undefined;
    const radioSlotId = pick(entry, "radio-slot-id");

    const phyHtCfg =
      ((entry["phy-ht-cfg"] as Record<string, unknown>)?.["cfg-data"] as Record<string, unknown>) ??
      {};
    const bandInfo = asArray(pick(entry, "radio-band-info"))[0] ?? {};
    const txPwrCfg =
      ((bandInfo["phy-tx-pwr-cfg"] as Record<string, unknown>)?.["cfg-data"] as Record<
        string,
        unknown
      >) ?? {};
    const channel = pick(phyHtCfg, "curr-freq") as number | undefined;

    const rrm = wtpMac ? rrmMap.get(radioKey(wtpMac, radioSlotId)) : undefined;

    return {
      apName: wtpMac ? apNameMap.get(wtpMac) : undefined,
      wtpMac,
      radioSlotId,
      band: activeBandLabel(pick(entry, "current-active-band")),
      channel,
      channelWidthMhz: pick(phyHtCfg, "chan-width") as number | undefined,
      txPowerLevel: pick(txPwrCfg, "current-tx-power-level") as number | undefined,
      adminState: pick(entry, "admin-state") as string | undefined,
      operState: pick(entry, "oper-state") as string | undefined,
      channelUtilizationPercent: rrm?.channelUtilizationPercent,
      clientCount: rrm?.clientCount,
      noiseFloor: channel !== undefined ? rrm?.noiseByChannel.get(channel) : undefined,
    };
  });
}

/** Maps the CleanAir interferer-type enum to a human-readable label. Unknown values pass through as-is. */
const INTERFERER_TYPE_LABELS: Record<string, string> = {
  "interferer-microwave-oven": "Microwave Oven",
  "interferer-bt-link": "Bluetooth Link",
  "interferer-bt-discovery": "Bluetooth Discovery",
  "interferer-video-camera": "Video Camera",
  "interferer-802-11-fh": "802.11 FH",
  "interferer-802-11-non-std-channel": "802.11 Non-Standard Channel",
  "interferer-jammer": "Jammer",
  "interferer-continuous-transmitter": "Continuous Transmitter",
  "interferer-wimax-fixed": "WiMAX Fixed",
  "interferer-wimax-mobile": "WiMAX Mobile",
  "interferer-xbox": "Xbox",
};

function interfererTypeLabel(type: unknown): string | undefined {
  if (typeof type !== "string") return undefined;
  return INTERFERER_TYPE_LABELS[type] ?? type;
}

export interface InterfererSummary {
  apName?: string;
  wtpMac?: string;
  deviceType?: string;
  channel?: number;
  severity?: unknown;
  dutyCyclePercent?: number;
  rssi?: number;
  detectedTime?: string;
}

/**
 * Lists CleanAir-detected interference sources (non-Wi-Fi devices such as microwave ovens,
 * Bluetooth, video cameras) per AP/channel. Complements list_ap_radios (channel utilization)
 * and list_rogue_aps (Wi-Fi interferers) for RF troubleshooting.
 */
export async function listInterferers(client: RestconfClient): Promise<InterfererSummary[]> {
  const [data, apNameMap] = await Promise.all([
    client.get("Cisco-IOS-XE-wireless-rrm-oper:rrm-oper-data/spectrum-device-rf-stats"),
    buildApNameMap(client),
  ]);
  const entries = asArray(firstContainerValue(data));

  return entries.map((entry) => {
    const wtpMac = pick(entry, "wtp-mac", "mac-address") as string | undefined;

    return {
      apName: wtpMac ? apNameMap.get(wtpMac) : undefined,
      wtpMac,
      deviceType: interfererTypeLabel(pick(entry, "type", "interferer-type", "dev-type")),
      channel: pick(entry, "channel", "chan-number", "cid") as number | undefined,
      severity: pick(entry, "severity", "severity-index"),
      dutyCyclePercent: pick(entry, "duty-cycle", "duty-cycle-pct") as number | undefined,
      rssi: numericVal(pick(entry, "rssi")),
      detectedTime: pick(entry, "detected-time", "last-updated-time", "update-time") as
        string | undefined,
    };
  });
}

export interface ApNeighbor {
  neighborApName?: string;
  neighborMac?: string;
  rssi?: number;
  snr?: number;
  channel?: number;
}

export interface ApNeighborSummary {
  apName?: string;
  wtpMac?: string;
  radioSlotId?: unknown;
  neighbors: ApNeighbor[];
}

/**
 * Lists RRM-observed neighbor relationships between AP radios (which APs hear each other, and
 * how strongly). Useful for spotting coverage overlap/holes when planning channel and power.
 *
 * Each entry's neighbor list is double-wrapped in the YANG model: the list itself is
 * `neighbor-radio-info.neighbor-radio-list`, and each item's fields are nested one level further
 * under its own `neighbor-radio-info` key.
 */
export async function listApNeighbors(client: RestconfClient): Promise<ApNeighborSummary[]> {
  const [data, apNameMap] = await Promise.all([
    client.get("Cisco-IOS-XE-wireless-rrm-oper:rrm-oper-data/ap-auto-rf-dot11-data"),
    buildApNameMap(client),
  ]);
  const entries = asArray(firstContainerValue(data));

  return entries.map((entry) => {
    const wtpMac = pick(entry, "wtp-mac", "mac-address") as string | undefined;
    const neighborRadioInfo = (entry["neighbor-radio-info"] as Record<string, unknown>) ?? {};
    const neighbors = asArray(pick(neighborRadioInfo, "neighbor-radio-list"));

    return {
      apName: wtpMac ? apNameMap.get(wtpMac) : undefined,
      wtpMac,
      radioSlotId: pick(entry, "radio-slot-id", "slot-id"),
      neighbors: neighbors.map((neighbor) => {
        const info = (neighbor["neighbor-radio-info"] as Record<string, unknown>) ?? neighbor;
        const neighborMac = pick(info, "neighbor-radio-mac", "nbor-radio-mac", "nbr-bssid") as
          string | undefined;

        return {
          neighborApName: neighborMac ? apNameMap.get(neighborMac) : undefined,
          neighborMac,
          rssi: numericVal(pick(info, "rssi")),
          snr: numericVal(pick(info, "snr")),
          channel: pick(info, "channel", "chan") as number | undefined,
        };
      }),
    };
  });
}

/** Strips separators and lowercases a MAC address so "aa:bb..", "aa-bb..", and "aabb.cc.." compare equal. */
function normalizeMac(mac: string): string {
  return mac.toLowerCase().replace(/[^0-9a-f]/g, "");
}

export interface ClientPolicyInfo {
  vlanId?: unknown;
  qosPolicyIn?: string;
  qosPolicyOut?: string;
  aclName?: string;
}

export interface ClientDetail extends WirelessClientSummary {
  policy?: ClientPolicyInfo;
}

/** Best-effort per-client VLAN/QoS/ACL lookup. Returns undefined if the path or client entry isn't found. */
async function findClientPolicy(
  client: RestconfClient,
  normalizedMac: string
): Promise<ClientPolicyInfo | undefined> {
  let data: unknown;
  try {
    data = await client.get("Cisco-IOS-XE-wireless-client-oper:client-oper-data/policy-data");
  } catch {
    return undefined;
  }
  const entries = asArray(firstContainerValue(data));
  const entry = entries.find((candidate) => {
    const mac = pick(candidate, "client-mac", "ms-mac-address") as string | undefined;
    return mac && normalizeMac(mac) === normalizedMac;
  });
  if (!entry) return undefined;

  return {
    vlanId: pick(entry, "vlan-id", "vlan"),
    qosPolicyIn: pick(entry, "ingress-qos-policy-name", "qos-policy-in") as string | undefined,
    qosPolicyOut: pick(entry, "egress-qos-policy-name", "qos-policy-out") as string | undefined,
    aclName: pick(entry, "acl-name", "ipv4-acl-name") as string | undefined,
  };
}

/**
 * Deep-dive on a single wireless client by MAC address: the same RF diagnostics as
 * list_wireless_clients, plus (best-effort) VLAN/QoS/ACL policy info. Returns undefined if no
 * currently-associated client matches the given MAC.
 */
export async function getClientDetail(
  client: RestconfClient,
  macAddress: string
): Promise<ClientDetail | undefined> {
  const normalizedMac = normalizeMac(macAddress);
  const clients = await listWirelessClients(client);
  const match = clients.find((c) => c.clientMac && normalizeMac(c.clientMac) === normalizedMac);
  if (!match) return undefined;

  const policy = await findClientPolicy(client, normalizedMac);
  return { ...match, policy };
}

export interface ApTagSummary {
  apName?: string;
  wtpMac?: string;
  policyTagName?: string;
  siteTagName?: string;
  rfTagName?: string;
  tagSource?: string;
}

/**
 * Lists the Policy/Site/RF tag assignment for each AP. Useful for finding config mismatches
 * (e.g. an AP stuck on the default-policy-tag when it should carry a site-specific tag).
 *
 * There's no dedicated tag-config container in the oper YANG model — tag assignment is nested
 * inside each AP's `capwap-data` entry under `tag-info.resolved-tag-info` (the source-of-truth
 * regardless of whether the tag was assigned statically, via a filter, or by default).
 */
export async function listApTags(client: RestconfClient): Promise<ApTagSummary[]> {
  const data = await client.get(
    "Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data/capwap-data"
  );
  const entries = asArray(firstContainerValue(data));

  return entries.map((entry) => {
    const tagInfo = (entry["tag-info"] as Record<string, unknown>) ?? {};
    const resolved = (tagInfo["resolved-tag-info"] as Record<string, unknown>) ?? {};
    const policyTagInfo = (tagInfo["policy-tag-info"] as Record<string, unknown>) ?? {};
    const siteTag = (tagInfo["site-tag"] as Record<string, unknown>) ?? {};
    const rfTag = (tagInfo["rf-tag"] as Record<string, unknown>) ?? {};

    return {
      apName: pick(entry, "name", "ap-name") as string | undefined,
      wtpMac: pick(entry, "wtp-mac") as string | undefined,
      policyTagName: (pick(resolved, "resolved-policy-tag") ??
        pick(policyTagInfo, "policy-tag-name")) as string | undefined,
      siteTagName: (pick(resolved, "resolved-site-tag") ?? pick(siteTag, "site-tag-name")) as
        string | undefined,
      rfTagName: (pick(resolved, "resolved-rf-tag") ?? pick(rfTag, "rf-tag-name")) as
        string | undefined,
      tagSource: pick(tagInfo, "tag-source") as string | undefined,
    };
  });
}

export interface WlcHealthSummary {
  cpuFiveSecPercent?: number;
  cpuOneMinPercent?: number;
  cpuFiveMinPercent?: number;
  memoryTotalBytes?: number;
  memoryUsedBytes?: number;
  memoryUsedPercent?: number;
  bootTime?: string;
  uptimeSeconds?: number;
  softwareVersion?: string;
  lastRebootReason?: string;
  joinedApCount?: number;
  radiosUp?: number;
  radiosDown?: number;
  misconfiguredApCount?: unknown;
}

export async function getWlcHealth(client: RestconfClient): Promise<WlcHealthSummary> {
  const [cpuData, memoryData, hardwareData, radioStatsData, joinCountData] = await Promise.all([
    client.get(
      "Cisco-IOS-XE-process-cpu-oper:cpu-usage/cpu-utilization?fields=five-seconds;one-minute;five-minutes"
    ),
    client.get("Cisco-IOS-XE-memory-oper:memory-statistics"),
    client.get("Cisco-IOS-XE-device-hardware-oper:device-hardware-data"),
    client.get("Cisco-IOS-XE-wireless-ap-global-oper:ap-global-oper-data/ewlc-ap-stats"),
    client.get("Cisco-IOS-XE-wireless-ap-global-oper:ap-global-oper-data/emltd-join-count-stat"),
  ]);

  const cpu = (firstContainerValue(cpuData) as Record<string, unknown>) ?? {};

  const memoryStats = asArray(
    pick(firstContainerValue(memoryData) as Record<string, unknown>, "memory-statistic")
  );
  const processorMemory = memoryStats.find((entry) => pick(entry, "name") === "Processor") ?? {};
  const memoryTotal = Number(pick(processorMemory, "total-memory"));
  const memoryUsed = Number(pick(processorMemory, "used-memory"));

  const deviceHardware =
    ((firstContainerValue(hardwareData) as Record<string, unknown>)?.["device-hardware"] as Record<
      string,
      unknown
    >) ?? {};
  const systemData = (deviceHardware["device-system-data"] as Record<string, unknown>) ?? {};
  const bootTime = pick(systemData, "boot-time") as string | undefined;
  const currentTime = pick(systemData, "current-time") as string | undefined;
  const softwareVersion = pick(systemData, "software-version") as string | undefined;

  const radioStats = (firstContainerValue(radioStatsData) as Record<string, unknown>) ?? {};
  const allRadios = (radioStats["stats-80211-all-rad"] as Record<string, unknown>) ?? {};

  const joinCount = (firstContainerValue(joinCountData) as Record<string, unknown>) ?? {};

  return {
    cpuFiveSecPercent: pick(cpu, "five-seconds") as number | undefined,
    cpuOneMinPercent: pick(cpu, "one-minute") as number | undefined,
    cpuFiveMinPercent: pick(cpu, "five-minutes") as number | undefined,
    memoryTotalBytes: Number.isFinite(memoryTotal) ? memoryTotal : undefined,
    memoryUsedBytes: Number.isFinite(memoryUsed) ? memoryUsed : undefined,
    memoryUsedPercent:
      Number.isFinite(memoryTotal) && memoryTotal > 0 && Number.isFinite(memoryUsed)
        ? Math.round((memoryUsed / memoryTotal) * 1000) / 10
        : undefined,
    bootTime,
    uptimeSeconds:
      bootTime && currentTime
        ? Math.round((Date.parse(currentTime) - Date.parse(bootTime)) / 1000)
        : undefined,
    softwareVersion: softwareVersion?.split("\n")[0],
    lastRebootReason: pick(systemData, "last-reboot-reason") as string | undefined,
    joinedApCount: pick(joinCount, "joined-aps-count") as number | undefined,
    radiosUp: pick(allRadios, "radios-up") as number | undefined,
    radiosDown: pick(allRadios, "radios-down") as number | undefined,
    misconfiguredApCount: pick(radioStats, "stats-misconfigured-aps"),
  };
}
