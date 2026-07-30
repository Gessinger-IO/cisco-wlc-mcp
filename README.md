# cisco-wlc-mcp

MCP-Server für den Cisco Catalyst 9800 WLC (RESTCONF, read-only).

## Setup

```
npm install
npm run build
```

## Entwicklung

```
npm test              # vitest run
npm run test:coverage # inkl. Coverage-Report (v8)
npm run lint
npm run format:check
```

Der eigentliche Tool-Server wird in `src/server.ts` als `createServer(restconf)` gebaut (getrennt
von `src/index.ts`, das nur noch Env-Config lädt und den stdio-Transport verbindet) — dadurch lässt
sich die komplette Tool-Registrierung in Tests über den SDK-eigenen In-Memory-Transport ansprechen,
siehe `test/server.test.ts`.

## Konfiguration (Umgebungsvariablen)

| Variable            | Pflicht | Beschreibung                                      |
|---------------------|---------|----------------------------------------------------|
| `WLC_HOST`           | ja      | Hostname/IP des WLC-Management-Interfaces          |
| `WLC_USERNAME`        | ja      | RESTCONF-Benutzer                                  |
| `WLC_PASSWORD`        | ja      | Passwort                                            |
| `WLC_PORT`            | nein    | Port, Standard `443`                               |
| `WLC_INSECURE_TLS`    | nein    | `"true"` deaktiviert TLS-Zertifikatsprüfung (selbstsignierte Zertifikate) |

RESTCONF muss auf dem WLC aktiviert sein (`restconf` im Config-Mode).

## MCP-Client-Config (Beispiel)

Für normale Nutzung reicht das npm-Paket, ohne lokalen Checkout:

```json
{
  "mcpServers": {
    "cisco-wlc": {
      "command": "npx",
      "args": ["-y", "cisco-wlc-mcp"],
      "env": {
        "WLC_HOST": "192.0.2.10",
        "WLC_USERNAME": "restconf-user",
        "WLC_PASSWORD": "changeme",
        "WLC_INSECURE_TLS": "true"
      }
    }
  }
}
```

Für die Entwicklung an diesem Repo lieber den lokalen Build direkt referenzieren — `npx` würde sonst
immer den zuletzt auf npm veröffentlichten Stand ziehen, nicht den lokalen:

```json
{
  "mcpServers": {
    "cisco-wlc": {
      "command": "node",
      "args": ["C:/Users/gessinger/git/cisco-mcp/dist/index.js"],
      "env": {
        "WLC_HOST": "192.0.2.10",
        "WLC_USERNAME": "restconf-user",
        "WLC_PASSWORD": "changeme",
        "WLC_INSECURE_TLS": "true"
      }
    }
  }
}
```

## Tools

- `list_access_points` — verbundene APs (Name, MAC, IP, Modell)
- `list_wireless_clients` — verbundene WLAN-Clients (MAC, AP-Name, WLAN-ID, IPv4, Status, Kanal, Band, RSSI, SNR, PHY-Rate, Spatial Streams, Security Mode)
- `list_wlans` — konfigurierte WLANs/SSIDs
- `list_policy_profiles` — Policy Profiles (VLAN-Interface) inkl. Mapping über Policy Tags zu WLAN-Profilen
- `list_ap_radios` — Radio-Diagnose pro AP (Band, Kanal, Kanalbreite, TX-Power-Level, Admin/Oper-State, Channel-Utilization, Client-Count, Noise-Floor)
- `get_wlc_health` — Controller-Health (CPU, Memory, Uptime, Software-Version, Reboot-Grund, verbundene APs, Radio-Status, fehlkonfigurierte APs)
- `list_rogue_aps` — erkannte Rogue APs (MAC, SSID, Klassifizierung, Status)
- `list_interferers` — CleanAir-erkannte Nicht-WLAN-Störquellen (Mikrowelle, Bluetooth, Kamera, Jammer, ...) pro AP/Kanal
- `list_ap_neighbors` — RRM-Nachbarschaftsbeziehungen zwischen AP-Radios (wer hört wen wie stark) für Coverage-Planung
- `get_client_detail` — Detail-Diagnose für einen einzelnen Client per MAC-Adresse (RF-Diagnostik + best-effort VLAN/QoS/ACL)
- `list_ap_tags` — Policy-/Site-/RF-Tag-Zuordnung pro AP
- `restconf_get` — Fallback für rohe RESTCONF-GET-Abfragen auf beliebige YANG-Pfade

## Hinweis

Die Feldnamen in den YANG-Modellen können sich je nach IOS-XE-Version leicht unterscheiden.
Falls ein Tool leere/unerwartete Werte liefert, zunächst mit `restconf_get` die Rohdaten des
jeweiligen Pfads (z.B. `Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data`) prüfen
und die Extraktion in `src/wlc.ts` anpassen.

`list_ap_neighbors` und `list_ap_tags` wurden gegen einen echten C9800-CL (IOS-XE 26.1.1) verifiziert
und dabei korrigiert — die ursprünglich geratenen Pfade/Feldnamen existierten so nicht. Die tatsächlichen
YANG-Fundstellen: `rrm-oper-data/ap-auto-rf-dot11-data` (doppelt verschachtelt: die Nachbarliste steckt
unter `neighbor-radio-info.neighbor-radio-list`, jedes Element nochmal unter einem eigenen
`neighbor-radio-info`) bzw. `access-point-oper-data/capwap-data`'s `tag-info.resolved-tag-info`
(kein eigener Tag-Config-Container).

`list_interferers` bleibt unverifiziert: Der geratene Pfad (`spectrum-device-rf-stats`) existiert
nicht, und auch nach vollständigem Durchsuchen von `rrm-oper-data` auf einem echten WLC fand sich
dort kein Interferer-Geräte-Report (nur `ap-dot11-spectrum-data` mit CleanAir-Konfig/Status, keine
Device-Liste) — vermutlich lebt der Report in einem anderen YANG-Modul. Zusätzlich war auf dem
Test-WLC Spectrum Intelligence/CleanAir deaktiviert, was eine vollständige Verifikation ohnehin
verhindert hätte. Bis das geklärt ist, liefert das Tool bei jedem Aufruf einen Fehler
(HTTP 404 über `restconf_get`-Hinweis).
