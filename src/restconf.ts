import axios, { type AxiosInstance } from "axios";
import https from "node:https";

export interface WlcConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  insecureTls: boolean;
}

export function loadConfigFromEnv(): WlcConfig {
  const host = process.env.WLC_HOST;
  const username = process.env.WLC_USERNAME;
  const password = process.env.WLC_PASSWORD;

  if (!host || !username || !password) {
    throw new Error(
      "Missing required environment variables: WLC_HOST, WLC_USERNAME, WLC_PASSWORD"
    );
  }

  return {
    host,
    port: process.env.WLC_PORT ? Number(process.env.WLC_PORT) : 443,
    username,
    password,
    insecureTls: process.env.WLC_INSECURE_TLS === "true",
  };
}

export class RestconfClient {
  private readonly client: AxiosInstance;

  constructor(config: WlcConfig) {
    this.client = axios.create({
      baseURL: `https://${config.host}:${config.port}/restconf/data/`,
      auth: {
        username: config.username,
        password: config.password,
      },
      headers: {
        Accept: "application/yang-data+json",
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: !config.insecureTls,
      }),
      timeout: 15000,
    });
  }

  async get(path: string): Promise<unknown> {
    try {
      const response = await this.client.get(path);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const body = error.response?.data;
        throw new Error(
          `RESTCONF GET ${path} failed${status ? ` (HTTP ${status})` : ""}: ${
            typeof body === "object" ? JSON.stringify(body) : error.message
          }`
        );
      }
      throw error;
    }
  }
}
