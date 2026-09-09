/**
 * Pao AI Gateway — Public entry point.
 *
 * This is the activation surface for the optional gateway subsystem.
 * Following the project's optional-subsystem pattern, it registers into
 * a core-owned slot at activation rather than being directly imported
 * by the core request path.
 */

export { startGatewayServer, type GatewayServerHandle } from "./server";
export { loadGatewayConfig } from "./config";
export type { GatewayConfig } from "./types";
