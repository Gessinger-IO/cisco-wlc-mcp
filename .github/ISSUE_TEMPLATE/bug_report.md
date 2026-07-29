---
name: Bug report
about: A tool returns empty/wrong/unexpected data, or errors out
title: ""
labels: bug
---

## What happened

## Expected behavior

## Environment
- WLC model (e.g. C9800-CL, C9800-40):
- IOS-XE version (`show version`, or the `softwareVersion` field from `get_wlc_health`):
- Tool affected (e.g. `list_ap_radios`):

## Raw RESTCONF output
Field names in the YANG models can differ between IOS-XE versions. Run the affected tool's YANG
path through `restconf_get` and paste the (redacted, if needed) raw JSON below — this is usually
the fastest way to spot a field-name mismatch.

```json

```
