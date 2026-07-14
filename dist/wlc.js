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
    if (value && typeof value === "object")
        return [value];
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
        return {
            name: pick(entry, "name", "ap-name"),
            wtpMac: pick(entry, "wtp-mac"),
            ipAddr: pick(entry, "ip-addr"),
            model: pick(boardData, "wtp-model-number"),
            softwareVersion: pick(deviceDetail, "wtp-version", "sw-version"),
        };
    });
}
export async function listWirelessClients(client) {
    const data = await client.get("Cisco-IOS-XE-wireless-client-oper:client-oper-data/common-oper-data");
    const entries = asArray(firstContainerValue(data));
    return entries.map((entry) => ({
        clientMac: pick(entry, "client-mac"),
        apMac: pick(entry, "ap-mac"),
        connectionState: pick(entry, "co-state", "client-state"),
        vlanId: pick(entry, "vlan-id"),
        ssid: pick(entry, "ssid"),
    }));
}
export async function listWlans(client) {
    const data = await client.get("Cisco-IOS-XE-wireless-wlan-cfg:wlan-cfg-data/wlan-cfg-entries");
    const entries = asArray(firstContainerValue(data));
    return entries.map((entry) => ({
        wlanId: pick(entry, "wlan-id"),
        profileName: pick(entry, "profile-name"),
        ssid: pick(entry, "ssid"),
        enabled: pick(entry, "enable", "is-enabled"),
    }));
}
