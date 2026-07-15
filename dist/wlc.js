/** Picks the first defined value among several possible YANG field name variants. */
function pick(obj, ...keys) {
    for (const key of keys) {
        if (obj[key] !== undefined)
            return obj[key];
    }
    return undefined;
}
function asArray(value) {
    if (Array.isArray(value))
        return value;
    if (value && typeof value === "object") {
        // RESTCONF often wraps a list one level deeper under its own YANG list name,
        // e.g. { "wlan-cfg-entries": { "wlan-cfg-entry": [...] } }. If this object has
        // exactly one property and that property is an array, unwrap it.
        const entries = Object.values(value);
        if (entries.length === 1 && Array.isArray(entries[0])) {
            return entries[0];
        }
        return [value];
    }
    return [];
}
function firstContainerValue(data) {
    if (!data || typeof data !== "object")
        return undefined;
    const values = Object.values(data);
    return values[0];
}
export async function listAccessPoints(client) {
    const data = await client.get("Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data/capwap-data");
    const entries = asArray(firstContainerValue(data));
    return entries.map((entry) => {
        const deviceDetail = entry["device-detail"] ?? {};
        const staticInfo = deviceDetail["static-info"] ?? {};
        const boardData = staticInfo["board-data"] ?? {};
        const apModels = staticInfo["ap-models"] ?? {};
        const wtpVersion = deviceDetail["wtp-version"] ?? {};
        return {
            name: pick(entry, "name", "ap-name"),
            wtpMac: pick(entry, "wtp-mac"),
            ipAddr: pick(entry, "ip-addr"),
            model: (pick(apModels, "model") ?? pick(boardData, "wtp-model-number")),
            softwareVersion: pick(wtpVersion, "sw-version"),
        };
    });
}
function extractIpv4(entry) {
    const direct = pick(entry, "ipv4-address", "ip-addr");
    if (typeof direct === "string")
        return direct;
    const bindings = asArray(pick(entry, "ipv4-binding", "ipv4-binding-list"));
    for (const binding of bindings) {
        const ipKey = binding["ip-key"] ?? binding;
        const ip = pick(ipKey, "ip-addr", "ipv4-address");
        if (typeof ip === "string")
            return ip;
    }
    return undefined;
}
/** Best-effort client-mac -> IPv4 lookup. Returns an empty map if the path doesn't exist on this device. */
async function buildIpv4Map(client) {
    const map = new Map();
    let data;
    try {
        data = await client.get("Cisco-IOS-XE-wireless-client-oper:client-oper-data/sisf-db-mac");
    }
    catch {
        return map;
    }
    const entries = asArray(firstContainerValue(data));
    for (const entry of entries) {
        const mac = pick(entry, "client-mac", "mac-addr");
        const ip = extractIpv4(entry);
        if (mac && ip)
            map.set(mac, ip);
    }
    return map;
}
/** Maps the wireless YANG's radio-type enum to a human-readable band. Unknown values pass through as-is. */
const RADIO_BAND_LABELS = {
    "dot11-radio-type-bg": "2.4GHz",
    "dot11-radio-type-a": "5GHz",
    "dot11-radio-type-6ghz": "6GHz",
};
function radioBandLabel(radioType) {
    if (typeof radioType !== "string")
        return undefined;
    return RADIO_BAND_LABELS[radioType] ?? radioType;
}
/** Best-effort client-mac -> channel/band/security lookup. Returns an empty map if the path doesn't exist on this device. */
async function buildRadioMap(client) {
    const map = new Map();
    let data;
    try {
        data = await client.get("Cisco-IOS-XE-wireless-client-oper:client-oper-data/dot11-oper-data");
    }
    catch {
        return map;
    }
    const entries = asArray(firstContainerValue(data));
    for (const entry of entries) {
        const mac = pick(entry, "ms-mac-address");
        if (!mac)
            continue;
        map.set(mac, {
            channel: pick(entry, "current-channel"),
            band: radioBandLabel(pick(entry, "radio-type")),
            securityMode: pick(entry, "security-mode"),
        });
    }
    return map;
}
/** Best-effort client-mac -> RSSI/SNR/rate lookup. Returns an empty map if the path doesn't exist on this device. */
async function buildSignalMap(client) {
    const map = new Map();
    let data;
    try {
        data = await client.get("Cisco-IOS-XE-wireless-client-oper:client-oper-data/traffic-stats");
    }
    catch {
        return map;
    }
    const entries = asArray(firstContainerValue(data));
    for (const entry of entries) {
        const mac = pick(entry, "ms-mac-address");
        if (!mac)
            continue;
        map.set(mac, {
            rssi: pick(entry, "most-recent-rssi"),
            snr: pick(entry, "most-recent-snr"),
            dataRate: pick(entry, "current-rate"),
            phyRateMbps: pick(entry, "speed"),
            spatialStreams: pick(entry, "spatial-stream"),
        });
    }
    return map;
}
export async function listWirelessClients(client) {
    const [data, ipv4Map, radioMap, signalMap] = await Promise.all([
        client.get("Cisco-IOS-XE-wireless-client-oper:client-oper-data/common-oper-data"),
        buildIpv4Map(client),
        buildRadioMap(client),
        buildSignalMap(client),
    ]);
    const entries = asArray(firstContainerValue(data));
    return entries.map((entry) => {
        const clientMac = pick(entry, "client-mac");
        const radio = (clientMac && radioMap.get(clientMac)) || {};
        const signal = (clientMac && signalMap.get(clientMac)) || {};
        return {
            clientMac,
            apName: pick(entry, "ap-name"),
            connectionState: pick(entry, "co-state", "client-state"),
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
export async function listWlans(client) {
    const data = await client.get("Cisco-IOS-XE-wireless-wlan-cfg:wlan-cfg-data/wlan-cfg-entries");
    const entries = asArray(firstContainerValue(data));
    return entries.map((entry) => {
        const vapIdData = entry["apf-vap-id-data"] ?? {};
        return {
            wlanId: pick(entry, "wlan-id"),
            profileName: pick(entry, "profile-name"),
            ssid: pick(vapIdData, "ssid"),
            enabled: pick(vapIdData, "wlan-status", "enable", "is-enabled"),
        };
    });
}
/**
 * Policy Profiles carry the VLAN interface; which WLAN maps to which Policy Profile is decided
 * per Policy Tag (assigned per-AP), not by the WLAN itself — so the same SSID can in principle
 * land on different VLANs depending on which Policy Tag the serving AP has.
 */
export async function listPolicyProfiles(client) {
    const [policiesData, tagsData] = await Promise.all([
        client.get("Cisco-IOS-XE-wireless-wlan-cfg:wlan-cfg-data/wlan-policies"),
        client.get("Cisco-IOS-XE-wireless-wlan-cfg:wlan-cfg-data/policy-list-entries"),
    ]);
    const profiles = asArray(firstContainerValue(policiesData));
    const tags = asArray(firstContainerValue(tagsData));
    const mappingsByProfile = new Map();
    for (const tag of tags) {
        const tagName = pick(tag, "tag-name");
        const wlanPolicies = asArray(pick(tag, "wlan-policies"));
        for (const wlanPolicy of wlanPolicies) {
            const policyProfileName = pick(wlanPolicy, "policy-profile-name");
            if (!policyProfileName)
                continue;
            const mappings = mappingsByProfile.get(policyProfileName) ?? [];
            mappings.push({
                policyTagName: tagName,
                wlanProfileName: pick(wlanPolicy, "wlan-profile-name"),
            });
            mappingsByProfile.set(policyProfileName, mappings);
        }
    }
    return profiles.map((profile) => {
        const name = pick(profile, "policy-profile-name");
        return {
            name,
            interfaceName: pick(profile, "interface-name"),
            enabled: pick(profile, "status"),
            mappings: (name && mappingsByProfile.get(name)) || [],
        };
    });
}
/** Some numeric YANG leafs (e.g. rssi) serialize as { val, num, den } instead of a plain number. */
function numericVal(value) {
    if (typeof value === "number")
        return value;
    if (value && typeof value === "object" && "val" in value) {
        return value.val;
    }
    return undefined;
}
export async function listRogueAps(client) {
    const data = await client.get("Cisco-IOS-XE-wireless-rogue-oper:rogue-oper-data/rogue-data");
    const entries = asArray(firstContainerValue(data));
    return entries.map((entry) => ({
        rogueMac: pick(entry, "rogue-address"),
        ssid: pick(entry, "last-heard-ssid"),
        ssidAtMaxRssi: pick(entry, "ssid-max-rssi"),
        classification: pick(entry, "rogue-class-type"),
        state: pick(entry, "rogue-mode"),
        containmentLevel: pick(entry, "rogue-containment-level"),
        onMyNetwork: pick(entry, "rogue-is-on-my-network"),
        detectedBy: asArray(pick(entry, "rogue-lrad")).map((lrad) => ({
            apName: pick(lrad, "name"),
            rssi: numericVal(pick(lrad, "rssi")),
        })),
        firstSeen: pick(entry, "rogue-first-timestamp"),
        lastSeen: pick(entry, "rogue-last-timestamp"),
    }));
}
function radioKey(wtpMac, radioSlotId) {
    return `${wtpMac}|${String(radioSlotId)}`;
}
/** Maps the AP radio-oper-data band enum to a human-readable band. Unknown values pass through as-is. */
const ACTIVE_BAND_LABELS = {
    "dot11-2-dot-4-ghz-band": "2.4GHz",
    "dot11-5-ghz-band": "5GHz",
    "dot11-6-ghz-band": "6GHz",
};
function activeBandLabel(band) {
    if (typeof band !== "string")
        return undefined;
    return ACTIVE_BAND_LABELS[band] ?? band;
}
/** Best-effort wtp-mac -> AP name lookup. Returns an empty map if the path doesn't exist on this device. */
async function buildApNameMap(client) {
    const map = new Map();
    let data;
    try {
        data = await client.get("Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data/capwap-data");
    }
    catch {
        return map;
    }
    const entries = asArray(firstContainerValue(data));
    for (const entry of entries) {
        const mac = pick(entry, "wtp-mac");
        const name = pick(entry, "name", "ap-name");
        if (mac && name)
            map.set(mac, name);
    }
    return map;
}
/** Best-effort (wtp-mac, radio-slot) -> channel load/noise lookup. Returns an empty map if the path doesn't exist on this device. */
async function buildRrmMap(client) {
    const map = new Map();
    let data;
    try {
        data = await client.get("Cisco-IOS-XE-wireless-rrm-oper:rrm-oper-data/rrm-measurement");
    }
    catch {
        return map;
    }
    const entries = asArray(firstContainerValue(data));
    for (const entry of entries) {
        const wtpMac = pick(entry, "wtp-mac");
        if (!wtpMac)
            continue;
        const radioSlotId = pick(entry, "radio-slot-id");
        const load = entry["load"] ?? {};
        const noiseContainer = entry["noise"]?.["noise"];
        const noiseByChannel = new Map();
        for (const chanNoise of asArray(pick(noiseContainer ?? {}, "noise-data"))) {
            const chan = pick(chanNoise, "chan");
            const noise = pick(chanNoise, "noise");
            if (chan !== undefined && noise !== undefined)
                noiseByChannel.set(chan, noise);
        }
        map.set(radioKey(wtpMac, radioSlotId), {
            channelUtilizationPercent: pick(load, "cca-util-percentage"),
            clientCount: pick(load, "stations"),
            noiseByChannel,
        });
    }
    return map;
}
export async function listApRadios(client) {
    const [data, apNameMap, rrmMap] = await Promise.all([
        client.get("Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data/radio-oper-data"),
        buildApNameMap(client),
        buildRrmMap(client),
    ]);
    const entries = asArray(firstContainerValue(data));
    return entries.map((entry) => {
        const wtpMac = pick(entry, "wtp-mac");
        const radioSlotId = pick(entry, "radio-slot-id");
        const phyHtCfg = entry["phy-ht-cfg"]?.["cfg-data"] ??
            {};
        const bandInfo = asArray(pick(entry, "radio-band-info"))[0] ?? {};
        const txPwrCfg = bandInfo["phy-tx-pwr-cfg"]?.["cfg-data"] ?? {};
        const channel = pick(phyHtCfg, "curr-freq");
        const rrm = wtpMac ? rrmMap.get(radioKey(wtpMac, radioSlotId)) : undefined;
        return {
            apName: wtpMac ? apNameMap.get(wtpMac) : undefined,
            wtpMac,
            radioSlotId,
            band: activeBandLabel(pick(entry, "current-active-band")),
            channel,
            channelWidthMhz: pick(phyHtCfg, "chan-width"),
            txPowerLevel: pick(txPwrCfg, "current-tx-power-level"),
            adminState: pick(entry, "admin-state"),
            operState: pick(entry, "oper-state"),
            channelUtilizationPercent: rrm?.channelUtilizationPercent,
            clientCount: rrm?.clientCount,
            noiseFloor: channel !== undefined ? rrm?.noiseByChannel.get(channel) : undefined,
        };
    });
}
