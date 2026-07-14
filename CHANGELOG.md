# Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ## **WORK IN PROGRESS**
-->
## 0.1.2 (2026-07-14)
* (list_wireless_clients) fixed field extraction to match the actual `common-oper-data` schema (`ap-name`, `wlan-id` instead of guessed `ap-mac`/`ssid`/`vlan-id`)
* (list_wireless_clients) added `ipv4Address`, resolved via a `sisf-db-mac` lookup joined on client MAC
* (list_wlans) fixed extraction of nested RESTCONF list responses (`wlan-cfg-entries` wraps its list one level deeper than a plain array)
* added `list_rogue_aps` tool (rogue AP MAC, classification, state, containment level, first/last seen)
* (list_rogue_aps) added `ssid` (`last-heard-ssid`) and `ssidAtMaxRssi` (`ssid-max-rssi`)
* (list_rogue_aps) added `detectedBy` — list of own APs that heard the rogue (`rogue-lrad`), slimmed down to `apName` + flat numeric `rssi`

## 0.1.1 (2026-07-14)
* Inital commit