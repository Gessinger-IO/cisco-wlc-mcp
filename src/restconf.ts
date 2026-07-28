import axios, { type AxiosError, type AxiosInstance } from "axios";
import https from "node:https";

const TIMEOUT_MS = 15000;

const TLS_ERROR_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

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
    throw new Error("Missing required environment variables: WLC_HOST, WLC_USERNAME, WLC_PASSWORD");
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
  private readonly host: string;
  private readonly port: number;

  constructor(config: WlcConfig) {
    this.host = config.host;
    this.port = config.port;
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
      timeout: TIMEOUT_MS,
    });
  }

  async get(path: string): Promise<unknown> {
    try {
      const response = await this.client.get(path);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(this.describeError(path, error), { cause: error });
      }
      throw error;
    }
  }

  private describeError(path: string, error: AxiosError): string {
    const prefix = `RESTCONF GET ${path} failed`;
    const status = error.response?.status;

    if (status !== undefined) {
      return `${prefix} (HTTP ${status}): ${this.describeHttpStatus(status)}${this.formatBody(
        error.response?.data
      )}`;
    }

    return `${prefix}: ${this.describeNetworkError(error)}`;
  }

  private describeHttpStatus(status: number): string {
    switch (status) {
      case 401:
        return "authentication failed — check WLC_USERNAME/WLC_PASSWORD.";
      case 403:
        return (
          "forbidden — the RESTCONF user may lack sufficient privilege level " +
          "(usually privilege 15), or RESTCONF access is restricted for this account."
        );
      case 404:
        return (
          "YANG path not found on this device. Field and container names can differ " +
          "between IOS-XE versions — try restconf_get on a shorter/parent path to explore " +
          "what's actually available."
        );
      case 400:
        return "malformed request — check the path and any query parameters for typos.";
      default:
        if (status >= 500) {
          return "the WLC returned a server error — it may be overloaded, or this data source may be temporarily unavailable.";
        }
        return "unexpected response from the WLC.";
    }
  }

  private describeNetworkError(error: AxiosError): string {
    const code = error.code;

    if (code === "ECONNREFUSED") {
      return (
        `connection refused by ${this.host}:${this.port} — is RESTCONF enabled on the WLC ` +
        `("restconf" in config mode) and reachable on this port?`
      );
    }
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return `could not resolve host "${this.host}" — check WLC_HOST.`;
    }
    if (code === "ECONNABORTED" || error.message.includes("timeout")) {
      return (
        `timed out after ${TIMEOUT_MS}ms connecting to ${this.host}:${this.port} — check network/firewall ` +
        "reachability, or the WLC may be under heavy load."
      );
    }
    if (code === "EHOSTUNREACH" || code === "ENETUNREACH") {
      return `host ${this.host}:${this.port} unreachable — check routing/firewall between here and the WLC.`;
    }
    if (code && TLS_ERROR_CODES.has(code)) {
      return (
        `TLS certificate validation failed (${code}) — if the WLC uses a self-signed certificate, ` +
        "set WLC_INSECURE_TLS=true."
      );
    }

    return `${code ? `${code}: ` : ""}${error.message}`;
  }

  private formatBody(body: unknown): string {
    if (body === undefined || body === null || body === "") return "";
    const text = typeof body === "string" ? body : JSON.stringify(body);
    const truncated = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    return ` Response: ${truncated}`;
  }
}
