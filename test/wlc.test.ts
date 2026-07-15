import { describe, it, expect } from "vitest";
import { RestconfClient } from "../src/restconf.js";
import { listAccessPoints, listWirelessClients, listWlans, listRogueAps } from "../src/wlc.js";

function fakeClient(responses: Record<string, unknown>): RestconfClient {
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

describe("listAccessPoints", () => {
  it("extracts name, mac, ip, model and version from capwap-data", async () => {
    const client = fakeClient({
      "Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data/capwap-data": {
        "Cisco-IOS-XE-wireless-access-point-oper:capwap-data": [
          {
            name: "AP1",
            "wtp-mac": "aa:bb:cc:dd:ee:ff",
            "ip-addr": "10.0.0.5",
            "device-detail": {
              "wtp-version": "17.9.1",
              "static-info": {
                "board-data": { "wtp-model-number": "9130AXI" },
              },
            },
          },
        ],
      },
    });

    const aps = await listAccessPoints(client);

    expect(aps).toEqual([
      {
        name: "AP1",
        wtpMac: "aa:bb:cc:dd:ee:ff",
        ipAddr: "10.0.0.5",
        model: "9130AXI",
        softwareVersion: "17.9.1",
      },
    ]);
  });

  it("returns an empty list when there are no entries", async () => {
    const client = fakeClient({
      "Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data/capwap-data": {
        "Cisco-IOS-XE-wireless-access-point-oper:capwap-data": [],
      },
    });

    expect(await listAccessPoints(client)).toEqual([]);
  });
});

describe("listWirelessClients", () => {
  it("joins client-mac against the sisf-db-mac ipv4 lookup", async () => {
    const client = fakeClient({
      "Cisco-IOS-XE-wireless-client-oper:client-oper-data/common-oper-data": {
        "common-oper-data": [
          {
            "client-mac": "11:22:33:44:55:66",
            "ap-name": "AP1",
            "co-state": "CO_STATE_RUN",
            "wlan-id": 1,
          },
        ],
      },
      "Cisco-IOS-XE-wireless-client-oper:client-oper-data/sisf-db-mac": {
        "sisf-db-mac": [
          {
            "client-mac": "11:22:33:44:55:66",
            "ipv4-binding": [{ "ip-key": { "ip-addr": "192.0.2.20" } }],
          },
        ],
      },
    });

    const clients = await listWirelessClients(client);

    expect(clients).toEqual([
      {
        clientMac: "11:22:33:44:55:66",
        apName: "AP1",
        connectionState: "CO_STATE_RUN",
        wlanId: 1,
        ipv4Address: "192.0.2.20",
      },
    ]);
  });

  it("leaves ipv4Address undefined when the sisf-db-mac path is unavailable", async () => {
    const client = fakeClient({
      "Cisco-IOS-XE-wireless-client-oper:client-oper-data/common-oper-data": {
        "common-oper-data": [{ "client-mac": "11:22:33:44:55:66" }],
      },
    });
    client.get = (path: string) => {
      if (path.endsWith("sisf-db-mac"))
        return Promise.reject(new Error("not supported on this device"));
      return Promise.resolve({
        "common-oper-data": [{ "client-mac": "11:22:33:44:55:66" }],
      });
    };

    const clients = await listWirelessClients(client);

    expect(clients[0].ipv4Address).toBeUndefined();
  });
});

describe("listWlans", () => {
  it("unwraps a list nested one level deeper than the container", async () => {
    const client = fakeClient({
      "Cisco-IOS-XE-wireless-wlan-cfg:wlan-cfg-data/wlan-cfg-entries": {
        "wlan-cfg-entries": {
          "wlan-cfg-entry": [
            { "wlan-id": 1, "profile-name": "corp", ssid: "Corp-WLAN", enable: true },
          ],
        },
      },
    });

    expect(await listWlans(client)).toEqual([
      { wlanId: 1, profileName: "corp", ssid: "Corp-WLAN", enabled: true },
    ]);
  });
});

describe("listRogueAps", () => {
  it("flattens detecting APs and unwraps rssi's {val} shape", async () => {
    const client = fakeClient({
      "Cisco-IOS-XE-wireless-rogue-oper:rogue-oper-data/rogue-data": {
        "rogue-data": [
          {
            "rogue-address": "de:ad:be:ef:00:01",
            "last-heard-ssid": "Evil-Twin",
            "rogue-class-type": "rogue-class-malicious",
            "rogue-mode": "rogue-state-alert",
            "rogue-lrad": [{ name: "AP1", rssi: { val: -55, num: -55, den: 0 } }],
          },
        ],
      },
    });

    const rogues = await listRogueAps(client);

    expect(rogues).toEqual([
      {
        rogueMac: "de:ad:be:ef:00:01",
        ssid: "Evil-Twin",
        ssidAtMaxRssi: undefined,
        classification: "rogue-class-malicious",
        state: "rogue-state-alert",
        containmentLevel: undefined,
        onMyNetwork: undefined,
        detectedBy: [{ apName: "AP1", rssi: -55 }],
        firstSeen: undefined,
        lastSeen: undefined,
      },
    ]);
  });
});
