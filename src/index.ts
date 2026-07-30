#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RestconfClient, loadConfigFromEnv } from "./restconf.js";
import { createServer } from "./server.js";

const config = loadConfigFromEnv();
const restconf = new RestconfClient(config);
const server = createServer(restconf);

const transport = new StdioServerTransport();
await server.connect(transport);
