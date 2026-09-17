// Phase 20.85 — Model Gateway Dashboard Page (OmniRoute, providers, models, routes, circuits)

import { useCallback, useEffect, useState } from "react";
import "../styles/universal-registry.css";

interface Props {
  apiBase?: string;
}

interface GatewayHealth {
  status: "healthy" | "degraded" | "unhealthy";
  activeAdapter: "omniroute" | "direct";
  omnirouteConnected: boolean;
  totalRequestsToday: number;
  openCircuitsCount: number;
}

interface RouteGroup {
  routeGroup: string;
  policyType: string;
  candidates: string[];
  requiredCapabilities: string[];
  maxBudgetUsd?: number;
  localOnly?: boolean;
}

interface ProviderDef {
  id: string;
  name: string;
  endpointUrl: string;
  isLocal: boolean;
  healthStatus: string;
  rateLimitRpm?: number;
}

interface ModelDef {
  id: string;
  providerId: string;
  modelName: string;
  modelFamily: string;
  capabilities: string[];
  contextWindow: number;
  isLocal: boolean;
  pricing: {
    inputPerMillion: number;
    outputPerMillion: number;
    status: string;
  };
  status: string;
}

interface CircuitState {
  provider: string;
  state: "closed" | "open" | "half_open";
  failureCount: number;
  lastReason?: string;
  lastUpdated: string;
}

export function ModelGatewayPage({ apiBase = "" }: Props) {
  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [routes, setRoutes] = useState<RouteGroup[]>([]);
  const [providers, setProviders] = useState<ProviderDef[]>([]);
  const [models, setModels] = useState<ModelDef[]>([]);
  const [circuits, setCircuits] = useState<CircuitState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "routes" | "models" | "circuits">("overview");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [hRes, rRes, pRes, mRes, cRes] = await Promise.all([
        fetch(`${apiBase}/api/agent-os/model-gateway/health`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${apiBase}/api/agent-os/model-gateway/routes`).then((r) => (r.ok ? r.json() : { routes: [] })),
        fetch(`${apiBase}/api/agent-os/model-gateway/providers`).then((r) => (r.ok ? r.json() : { providers: [] })),
        fetch(`${apiBase}/api/agent-os/model-gateway/models`).then((r) => (r.ok ? r.json() : { models: [] })),
        fetch(`${apiBase}/api/agent-os/model-gateway/circuits`).then((r) => (r.ok ? r.json() : { circuits: [] })),
      ]);

      setHealth(hRes);
      setRoutes(rRes?.routes ?? []);
      setProviders(pRes?.providers ?? []);
      setModels(mRes?.models ?? []);
      setCircuits(cRes?.circuits ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load model gateway telemetry");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    const t = setTimeout(() => void loadData(), 0);
    return () => clearTimeout(t);
  }, [loadData]);

  return (
    <div className="ur-page">
      <div className="ur-header">
        <div>
          <div className="ur-title">Model Gateway</div>
          <div className="ur-subtitle">
            Phase 20.85 — Unified AI Provider Gateway, Capability Routing & Cost Governance
          </div>
        </div>
        <button type="button" className="ur-btn secondary" onClick={loadData} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className="ur-banner bad">{error}</div>}

      {/* KPI Cards */}
      <div className="ur-kpi-grid">
        <div className="ur-kpi-card">
          <div className="ur-kpi-val">
            <span className={`ur-pill ${health?.status === "healthy" ? "ok" : "warn"}`}>
              {health?.status ?? "unknown"}
            </span>
          </div>
          <div className="ur-kpi-label">Gateway Status</div>
        </div>
        <div className="ur-kpi-card">
          <div className="ur-kpi-val">{health?.activeAdapter ?? "direct"}</div>
          <div className="ur-kpi-label">Active Adapter Mode</div>
        </div>
        <div className="ur-kpi-card">
          <div className="ur-kpi-val">{providers.length}</div>
          <div className="ur-kpi-label">Connected Providers</div>
        </div>
        <div className="ur-kpi-card">
          <div className="ur-kpi-val">{models.length}</div>
          <div className="ur-kpi-label">Approved Models</div>
        </div>
        <div className="ur-kpi-card">
          <div className="ur-kpi-val">{routes.length}</div>
          <div className="ur-kpi-label">Route Groups</div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="ur-tabs">
        <button
          type="button"
          className={`ur-tab ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Providers
        </button>
        <button
          type="button"
          className={`ur-tab ${activeTab === "routes" ? "active" : ""}`}
          onClick={() => setActiveTab("routes")}
        >
          Route Groups
        </button>
        <button
          type="button"
          className={`ur-tab ${activeTab === "models" ? "active" : ""}`}
          onClick={() => setActiveTab("models")}
        >
          Model Catalog
        </button>
        <button
          type="button"
          className={`ur-tab ${activeTab === "circuits" ? "active" : ""}`}
          onClick={() => setActiveTab("circuits")}
        >
          Circuit Monitor
        </button>
      </div>

      {/* Tab: Providers */}
      {activeTab === "overview" && (
        <div className="ur-section">
          <div className="ur-section-head">
            <h3>Registered Inference Providers</h3>
          </div>
          <table className="ur-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Endpoint</th>
                <th>Type</th>
                <th>Health</th>
                <th>RPM Limit</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td className="mono">{p.endpointUrl}</td>
                  <td>
                    <span className={`ur-pill ${p.isLocal ? "ok" : "warn"}`}>
                      {p.isLocal ? "Local" : "Cloud"}
                    </span>
                  </td>
                  <td>
                    <span className="ur-pill ok">{p.healthStatus}</span>
                  </td>
                  <td>{p.rateLimitRpm ?? "unlimited"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Route Groups */}
      {activeTab === "routes" && (
        <div className="ur-section">
          <div className="ur-section-head">
            <h3>Active Route Groups</h3>
          </div>
          <table className="ur-table">
            <thead>
              <tr>
                <th>Group Name</th>
                <th>Policy Type</th>
                <th>Candidate Priority Chain</th>
                <th>Requirements</th>
                <th>Budget Cap</th>
                <th>Local Only</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.routeGroup}>
                  <td><strong>{r.routeGroup}</strong></td>
                  <td><code>{r.policyType}</code></td>
                  <td>
                    <div className="mono" style={{ fontSize: "12px" }}>
                      {r.candidates.map((c, i) => (
                        <span key={c}>
                          {i > 0 ? " -> " : ""}
                          {c}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{r.requiredCapabilities.join(", ")}</td>
                  <td>{r.maxBudgetUsd ? `$${r.maxBudgetUsd.toFixed(2)}` : "None"}</td>
                  <td>
                    {r.localOnly ? (
                      <span className="ur-pill ok">Strict Local</span>
                    ) : (
                      <span className="ur-pill">Cloud Permitted</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Models */}
      {activeTab === "models" && (
        <div className="ur-section">
          <div className="ur-section-head">
            <h3>Approved Model Catalog</h3>
          </div>
          <table className="ur-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Family</th>
                <th>Context Window</th>
                <th>Capabilities</th>
                <th>Pricing ($/1M in/out)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.id}</strong></td>
                  <td><code>{m.modelFamily}</code></td>
                  <td>{m.contextWindow.toLocaleString()} tokens</td>
                  <td>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {m.capabilities.map((c) => (
                        <span key={c} className="ur-tag">{c}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {m.isLocal
                      ? "Free (Local)"
                      : `$${m.pricing.inputPerMillion} / $${m.pricing.outputPerMillion}`}
                  </td>
                  <td><span className="ur-pill ok">{m.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Circuits */}
      {activeTab === "circuits" && (
        <div className="ur-section">
          <div className="ur-section-head">
            <h3>Provider Circuit Breakers</h3>
          </div>
          {circuits.length === 0 ? (
            <div className="ur-empty">All provider circuits are healthy and closed.</div>
          ) : (
            <table className="ur-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>State</th>
                  <th>Failures</th>
                  <th>Last Reason</th>
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {circuits.map((c) => (
                  <tr key={c.provider}>
                    <td><strong>{c.provider}</strong></td>
                    <td>
                      <span className={`ur-pill ${c.state === "closed" ? "ok" : "bad"}`}>
                        {c.state.toUpperCase()}
                      </span>
                    </td>
                    <td>{c.failureCount}</td>
                    <td>{c.lastReason ?? "None"}</td>
                    <td>{new Date(c.lastUpdated).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
