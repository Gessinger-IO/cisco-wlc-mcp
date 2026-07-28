# Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ## **WORK IN PROGRESS**
-->
## 0.4.1 (2026-07-28)
* (list_ap_neighbors) fixed against a real WLC (C9800-CL, IOS-XE 26.1.1) — the actual path is
  `rrm-oper-data/ap-auto-rf-dot11-data`, not `rrm-neighbor-data`, and the neighbor list is nested
  under `neighbor-radio-info.neighbor-radio-list` with each item's fields one level further under
  its own `neighbor-radio-info`; also added `snr`
* (list_ap_tags) fixed against the same device — there's no `ap-tag-config-oper-data` container;
  tag assignment is nested inside each AP's `capwap-data` entry under `tag-info.resolved-tag-info`
* (list_interferers) confirmed broken — `spectrum-device-rf-stats` doesn't exist, and no interferer
  device report could be found anywhere under `rrm-oper-data` on real hardware; still unverified,
  the tool currently always errors

## 0.4.0 (2026-07-28)
* (restconf) error messages are now classified and actionable instead of raw Axios/HTTP text —
  covers connection refused/unresolved host/timeout/TLS cert errors, and HTTP 401/403/404/5xx
  (including a hint to try `restconf_get` on a parent path for 404s caused by IOS-XE version drift)
* added `list_interferers` tool — CleanAir-detected non-Wi-Fi interference sources per AP/channel,
  with type, severity, duty cycle and RSSI (`rrm-oper-data/spectrum-device-rf-stats`)
* added `list_ap_neighbors` tool — RRM-observed neighbor relationships between AP radios, for
  coverage overlap/hole planning (`rrm-oper-data/rrm-neighbor-data`)
* added `get_client_detail` tool — single-client deep dive by MAC address (any notation): the same
  RF diagnostics as `list_wireless_clients`, plus best-effort VLAN/QoS/ACL policy info (`client-oper-data/policy-data`)
* added `list_ap_tags` tool — Policy/Site/RF tag assignment per AP (`access-point-oper-data/ap-tag-config-oper-data`)

## 0.3.0 (2026-07-15)
* (list_wireless_clients) added RF diagnostics: `channel`, `band`, `securityMode` (from `dot11-oper-data`)
  and `rssi`, `snr`, `dataRate`, `phyRateMbps`, `spatialStreams` (from `traffic-stats`)
* added `list_ap_radios` tool — per-radio band, channel, channel width, TX power level, admin/oper state
  (`radio-oper-data`), plus channel utilization, client count, and noise floor on the current channel
  (`rrm-oper-data/rrm-measurement`)
* added `get_wlc_health` tool — CPU (`process-cpu-oper`), memory (`memory-oper`), uptime/software
  version/reboot reason (`device-hardware-oper`), and joined AP count/radio up-down/misconfigured AP
  count (`wireless-ap-global-oper`)

## 0.2.0 (2026-07-15)
* added `list_policy_profiles` tool — Policy Profiles (name, VLAN interface) together with the WLAN
  profiles mapped to them via each Policy Tag (`wlan-policies` + `policy-list-entries`)

## 0.1.3 (2026-07-15)
* (list_access_points) fixed `model` extraction — actual field is `device-detail.static-info.ap-models.model`, not `board-data.wtp-model-number`
* (list_access_points) fixed `softwareVersion` to return the flat `sw-version` string instead of the whole `wtp-version` object
* (list_wlans) fixed `ssid` and `enabled` extraction — both are nested under `apf-vap-id-data`, not directly on the entry

## 0.1.2 (2026-07-14)
* (list_wireless_clients) fixed field extraction to match the actual `common-oper-data` schema (`ap-name`, `wlan-id` instead of guessed `ap-mac`/`ssid`/`vlan-id`)
* (list_wireless_clients) added `ipv4Address`, resolved via a `sisf-db-mac` lookup joined on client MAC
* (list_wlans) fixed extraction of nested RESTCONF list responses (`wlan-cfg-entries` wraps its list one level deeper than a plain array)
* added `list_rogue_aps` tool (rogue AP MAC, classification, state, containment level, first/last seen)
* (list_rogue_aps) added `ssid` (`last-heard-ssid`) and `ssidAtMaxRssi` (`ssid-max-rssi`)
* (list_rogue_aps) added `detectedBy` — list of own APs that heard the rogue (`rogue-lrad`), slimmed down to `apName` + flat numeric `rssi`

## 0.1.1 (2026-07-14)
* Inital commit