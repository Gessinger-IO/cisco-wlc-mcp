# cisco-wlc-mcp

MCP-Server für den Cisco Catalyst 9800 WLC (RESTCONF, read-only).

## Setup

```
npm install
npm run build
```

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
- `list_wireless_clients` — verbundene WLAN-Clients (MAC, AP, VLAN, SSID)
- `list_wlans` — konfigurierte WLANs/SSIDs
- `restconf_get` — Fallback für rohe RESTCONF-GET-Abfragen auf beliebige YANG-Pfade

## Hinweis

Die Feldnamen in den YANG-Modellen können sich je nach IOS-XE-Version leicht unterscheiden.
Falls ein Tool leere/unerwartete Werte liefert, zunächst mit `restconf_get` die Rohdaten des
jeweiligen Pfads (z.B. `Cisco-IOS-XE-wireless-access-point-oper:access-point-oper-data`) prüfen
und die Extraktion in `src/wlc.ts` anpassen.
