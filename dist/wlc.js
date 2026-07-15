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
export async function listWirelessClients(client) {
    const [data, ipv4Map] = await Promise.all([
        client.get("Cisco-IOS-XE-wireless-client-oper:client-oper-data/common-oper-data"),
        buildIpv4Map(client),
    ]);
    const entries = asArray(firstContainerValue(data));
    return entries.map((entry) => {
        const clientMac = pick(entry, "client-mac");
        return {
            clientMac,
            apName: pick(entry, "ap-name"),
            connectionState: pick(entry, "co-state", "client-state"),
            wlanId: pick(entry, "wlan-id"),
            ipv4Address: clientMac ? ipv4Map.get(clientMac) : undefined,
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
