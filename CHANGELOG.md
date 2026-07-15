# Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ## **WORK IN PROGRESS**
-->
## **WORK IN PROGRESS**
* (list_wireless_clients) added RF diagnostics: `channel`, `band`, `securityMode` (from `dot11-oper-data`)
  and `rssi`, `snr`, `dataRate`, `phyRateMbps`, `spatialStreams` (from `traffic-stats`)
* added `list_ap_radios` tool — per-radio band, channel, channel width, TX power level, admin/oper state
  (`radio-oper-data`), plus channel utilization, client count, and noise floor on the current channel
  (`rrm-oper-data/rrm-measurement`)

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