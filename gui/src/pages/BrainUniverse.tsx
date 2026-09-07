import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n, type TFn } from "../i18n/shared";
import { buildToolCatalog, registerWebMcpTools, type RegisteredTool } from "../webmcp/registry";
import { webMcpAvailability } from "../webmcp/capability";
import { EmptyState } from "../ui";
import { IconRefresh, IconSearch, IconAlert } from "../icons";
import { useDataSurface } from "../data-surface";

/** Shapes mirrored from GET /api/agent-os/* (server is the contract owner). */
interface AgentRow { id: string; name: string; provider: string; type: string; enabled: boolean; health: string }
interface TaskRow { id: string; kind: string; title: string; status: string; attempts: number; error: { message: string } | null }
interface SkillRow { id: string; name: string; version: string; status: string }
interface NodeRow { id: string; name: string; status: string; capabilities: string[] }
interface MemoryRow { id: string; scope: string; title: string; content: string }
interface SearchHit { kind: string; id: string; title: string; snippet: string }
interface ApprovalRow { id: string; capability: string; reason: string; status: string; requestedMs: number }
interface PolicyRow { id: string; subjectType: string; subjectId: string | null; capability: string; effect: string; createdAt: string }
interface ProjectRow { id: string; name: string; rootPath: string; scanEnabled: boolean; scanMode: string }
interface ScanCoverage { filesScanned: number; filesIndexed: number; filesMetadataOnly: number; filesIgnored: number; filesSecretExcluded: number; filesFailed: number; scanDurationMs: number }
interface GraphNode { id: string; type: "universe" | "project" | "folder" | "file"; label: string; path?: string; projectId?: string; disposition?: string; sizeBytes?: number }
interface GraphEdge { source: string; target: string; type: "contains" }
interface AtlasResponse {
  project: { id: string; name: string; rootPath: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { fileCount: number; folderCount: number; totalBytes: number };
}
interface UniverseResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  projects: { id: string; name: string; latestScan: { filesScanned: number } | null }[];
}

interface AuditEventRow {
  id: number;
  tsMs: number;
  tool: string;
  actor: string;
  result: string;
  inputSummary: string;
  riskTier?: string;
}

interface BrainData {
  agents: AgentRow[];
  tasks: TaskRow[];
  skills: SkillRow[];
  skillIssues: { skillId: string; kind: string; detail: string }[];
  nodes: NodeRow[];
  memories: MemoryRow[];
}


function TaskList({ tasks, loading, t }: { tasks: TaskRow[]; loading: boolean; t: (k: "brain.loading" | "brain.empty.tasks" | "brain.col.title" | "brain.col.kind" | "brain.col.status" | "brain.col.attempts") => string }) {
  return (
    <div>
      <p className="brain-loading" hidden={!loading || tasks.length > 0}>{t("brain.loading")}</p>
      {tasks.length === 0 && !loading ? <EmptyState title={t("brain.empty.tasks")} /> : (
        <table className="brain-table">
          <thead><tr><th>{t("brain.col.title")}</th><th>{t("brain.col.kind")}</th><th>{t("brain.col.status")}</th><th>{t("brain.col.attempts")}</th></tr></thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} title={task.error?.message ?? ""}>
                <td>{task.title}</td><td>{task.kind}</td><td><StatusChip status={task.status} /></td><td>{task.attempts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SkillList({ skills, loading, t }: { skills: SkillRow[]; loading: boolean; t: (k: "brain.loading" | "brain.empty.skills" | "brain.col.name" | "brain.col.version" | "brain.col.status") => string }) {
  return (
    <div>
      <p className="brain-loading" hidden={!loading || skills.length > 0}>{t("brain.loading")}</p>
      {skills.length === 0 && !loading ? <EmptyState title={t("brain.empty.skills")} /> : (
        <table className="brain-table">
          <thead><tr><th>{t("brain.col.name")}</th><th>{t("brain.col.version")}</th><th>{t("brain.col.status")}</th></tr></thead>
          <tbody>
            {skills.map((s) => (
              <tr key={s.id}><td>{s.name}</td><td>{s.version}</td><td><StatusChip status={s.status} /></td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NodeList({ nodes, loading, t }: { nodes: NodeRow[]; loading: boolean; t: (k: "brain.loading" | "brain.empty.nodes" | "brain.col.name" | "brain.col.status" | "brain.col.capabilities") => string }) {
  return (
    <div>
      <p className="brain-loading" hidden={!loading || nodes.length > 0}>{t("brain.loading")}</p>
      {nodes.length === 0 && !loading ? <EmptyState title={t("brain.empty.nodes")} /> : (
        <table className="brain-table">
          <thead><tr><th>{t("brain.col.name")}</th><th>{t("brain.col.status")}</th><th>{t("brain.col.capabilities")}</th></tr></thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id}><td>{n.name}</td><td><StatusChip status={n.status} /></td><td>{n.capabilities.join(", ")}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MemoryList({ memories, loading, t }: { memories: MemoryRow[]; loading: boolean; t: (k: "brain.loading" | "brain.empty.memory") => string }) {
  return (
    <div>
      <p className="brain-loading" hidden={!loading || memories.length > 0}>{t("brain.loading")}</p>
      {memories.length === 0 && !loading ? <EmptyState title={t("brain.empty.memory")} /> : (
        <ul className="brain-memories">
          {memories.map((m) => (
            <li key={m.id}><strong>{m.title}</strong> <span className="brain-chip brain-chip-warn">{m.scope}</span><p>{m.content}</p></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchResults({ hits, searching, t }: { hits: SearchHit[] | null; searching: boolean; t: (k: "brain.loading" | "brain.empty.search" | "brain.empty.searchResults") => string }) {
  return (
    <div>
      <p className="brain-loading" hidden={!searching}>{t("brain.loading")}</p>
      {hits === null && !searching ? <EmptyState title={t("brain.empty.search")} /> : hits !== null && hits.length === 0 ? <EmptyState title={t("brain.empty.searchResults")} /> : hits !== null ? (
        <ul className="brain-memories">
          {hits.map((h) => (
            <li key={`${h.kind}:${h.id}`}><strong>{h.title}</strong> <span className="brain-chip brain-chip-ok">{h.kind}</span><p>{h.snippet}</p></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const EMPTY: BrainData = { agents: [], tasks: [], skills: [], skillIssues: [], nodes: [], memories: [] };

type Section = "agents" | "tasks" | "skills" | "nodes" | "memory" | "search" | "policies" | "projects" | "atlas" | "universe" | "tools" | "activity" | "wiki" | "knowledge" | "ask_brain" | "health";

function StatusChip({ status }: { status: string }) {
  const tone = status === "online" || status === "succeeded" || status === "running" || status === "active" ? "ok"
    : status === "failed" || status === "offline" ? "bad"
    : "warn";
  return <span className={`brain-chip brain-chip-${tone}`}>{status}</span>;
}

async function getJson<T>(apiBase: string, path: string): Promise<T> {
  const res = await fetch(`${apiBase}${path}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return await res.json() as T;
}

export default function BrainUniverse({ apiBase }: { apiBase: string }) {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>("agents");
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [lastScan, setLastScan] = useState<{ projectId: string; coverage: ScanCoverage } | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [webMcpStatus, setWebMcpStatus] = useState<{ availability: string; tools: RegisteredTool[] }>(() => ({
    availability: webMcpAvailability(),
    tools: [],
  }));
  const [brainHealth, setBrainHealth] = useState<{
    healthy: boolean;
    sources: number;
    sourceVersions: number;
    chunks: number;
    entities: number;
    claims: number;
    relations: number;
    decisions: number;
    wikiPages: number;
    contradictions: number;
    unresolvedContradictions: number;
    healthScore: number;
  } | null>(null);

  const load = useCallback(async (): Promise<BrainData> => {
    const [agents, tasks, skillsRes, nodes, memories, permitsRes, policiesRes, projectsRes, healthRes] = await Promise.all([
      getJson<{ agents: AgentRow[] }>(apiBase, "/api/agent-os/agents"),
      getJson<{ tasks: TaskRow[] }>(apiBase, "/api/agent-os/tasks"),
      getJson<{ skills: SkillRow[]; issues: { skillId: string; kind: string; detail: string }[] }>(apiBase, "/api/agent-os/skills"),
      getJson<{ nodes: NodeRow[] }>(apiBase, "/api/agent-os/nodes"),
      getJson<{ memories: MemoryRow[] }>(apiBase, "/api/agent-os/memory"),
      getJson<{ approvals: ApprovalRow[] }>(apiBase, "/api/agent-os/permits/pending"),
      getJson<{ policies: PolicyRow[] }>(apiBase, "/api/agent-os/policies"),
      getJson<{ projects: ProjectRow[] }>(apiBase, "/api/agent-os/projects"),
      getJson<{
        healthy: boolean;
        sources: number;
        sourceVersions: number;
        chunks: number;
        entities: number;
        claims: number;
        relations: number;
        decisions: number;
        wikiPages: number;
        contradictions: number;
        unresolvedContradictions: number;
        healthScore: number;
      }>(apiBase, "/api/agent-os/brain/health").catch(() => null),
    ]);
    setApprovals(permitsRes.approvals);
    setPolicies(policiesRes.policies);
    setProjects(projectsRes.projects);
    if (healthRes) setBrainHealth(healthRes);
    setSelectedProjectId((current) => current ?? projectsRes.projects[0]?.id ?? null);
    return { agents: agents.agents, tasks: tasks.tasks, skills: skillsRes.skills, skillIssues: skillsRes.issues, nodes: nodes.nodes, memories: memories.memories };
  }, [apiBase]);

  const surface = useDataSurface<BrainData>(
    `agent-os-overview:${apiBase}`,
    [apiBase],
    load,
    { isEmpty: (d) => d.agents.length === 0 && d.tasks.length === 0 && d.skills.length === 0 && d.nodes.length === 0 && d.memories.length === 0 },
  );
  const data = surface.state.data ?? EMPTY;

  const auditResource = useDataSurface<{ events: AuditEventRow[] }>(
    `agent-os-audit:${apiBase}`,
    [apiBase],
    useCallback(async () => await getJson<{ events: AuditEventRow[] }>(apiBase, "/api/agent-os/audit?limit=20"), [apiBase]),
    { isEmpty: (body) => body.events.length === 0 },
  );
  const auditEvents = auditResource.state.data?.events ?? [];
  const toolCatalog = useMemo(
    () => buildToolCatalog({ apiBase }).map((tool) => ({
      name: tool.name,
      description: tool.description,
      riskTier: tool.riskTier,
      readOnly: tool.readOnly,
    })),
    [apiBase],
  );

  useEffect(() => {
    let disposed = false;
    void registerWebMcpTools({ apiBase }, {
      hasActiveProject: () => projects.length > 0,
    }).then((result) => {
      if (disposed) return;
      setWebMcpStatus({ availability: result.availability, tools: [] });
    }).catch(() => {
      if (!disposed) setWebMcpStatus({ availability: "unavailable", tools: [] });
    });
    return () => { disposed = true; };
  }, [apiBase, projects.length]);

  const searchLoad = useCallback(async (): Promise<{ hits: SearchHit[] }> => {
    const res = await getJson<{ hits: SearchHit[] }>(apiBase, `/api/agent-os/search?q=${encodeURIComponent(searchQuery)}`);
    return res;
  }, [apiBase, searchQuery]);

  const searchResource = useDataSurface<{ hits: SearchHit[] }>(
    `agent-os-search:${apiBase}:${searchQuery}`,
    [apiBase, searchQuery],
    searchLoad,
    { isEmpty: (r) => r.hits.length === 0, enabled: searchQuery.trim().length > 0 },
  );
  const hits = searchQuery.trim().length > 0 ? searchResource.state.data?.hits : null;

  const atlasLoad = useCallback(async (): Promise<AtlasResponse> => {
    if (!selectedProjectId) throw new Error("project required");
    return await getJson<AtlasResponse>(apiBase, "/api/agent-os/projects/" + selectedProjectId + "/atlas");
  }, [apiBase, selectedProjectId]);
  const atlasResource = useDataSurface<AtlasResponse>(
    `agent-os-atlas:${apiBase}:${selectedProjectId ?? "none"}`,
    [apiBase, selectedProjectId],
    atlasLoad,
    { isEmpty: (atlas) => atlas.nodes.length === 0, enabled: selectedProjectId !== null },
  );

  const universeLoad = useCallback(
    async (): Promise<UniverseResponse> => await getJson<UniverseResponse>(apiBase, "/api/agent-os/universe"),
    [apiBase],
  );
  const universeResource = useDataSurface<UniverseResponse>(
    `agent-os-universe:${apiBase}`,
    [apiBase],
    universeLoad,
    { isEmpty: (universe) => universe.nodes.length === 0 },
  );

  const runSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(query);
  }, [query]);

  const decide = useCallback(async (approvalId: string, decision: "granted" | "denied") => {
    await fetch(`${apiBase}/api/agent-os/permits/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId, decision, decidedBy: "dashboard-operator" }),
    });
    setApprovals((prev) => prev.filter((a) => a.id !== approvalId));
  }, [apiBase]);

  const addPolicy = useCallback(async (capability: string, effect: "allow" | "deny") => {
    await fetch(apiBase + "/api/agent-os/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectType: "global", capability, effect }),
    });
    const res = await getJson<{ policies: PolicyRow[] }>(apiBase, "/api/agent-os/policies");
    setPolicies(res.policies);
  }, [apiBase]);

  const removePolicy = useCallback(async (policyId: string) => {
    await fetch(apiBase + "/api/agent-os/policies/" + policyId, { method: "DELETE" });
    setPolicies((prev) => prev.filter((p) => p.id !== policyId));
  }, [apiBase]);

  const addProject = useCallback(async (name: string, rootPath: string) => {
    await fetch(apiBase + "/api/agent-os/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, rootPath, scanMode: "standard" }),
    });
    const res = await getJson<{ projects: ProjectRow[] }>(apiBase, "/api/agent-os/projects");
    setProjects(res.projects);
  }, [apiBase]);

  const scanNow = useCallback(async (projectId: string) => {
    const res = await fetch(apiBase + "/api/agent-os/projects/" + projectId + "/scan", { method: "POST" });
    if (res.ok) {
      const body = await res.json() as { projectId: string; coverage: ScanCoverage };
      setLastScan(body);
    }
  }, [apiBase]);

  const sections: { id: Section; label: string; count: number }[] = [
    { id: "wiki", label: "Living Wiki", count: brainHealth?.wikiPages ?? 0 },
    { id: "knowledge", label: "Knowledge Graph", count: (brainHealth?.claims ?? 0) + (brainHealth?.contradictions ?? 0) },
    { id: "ask_brain", label: "Pao Brain", count: 0 },
    { id: "health", label: "health", count: brainHealth?.healthScore ?? 100 },
    { id: "agents", label: t("brain.tab.agents"), count: data.agents.length },
    { id: "tasks", label: t("brain.tab.tasks"), count: data.tasks.length },
    { id: "skills", label: t("brain.tab.skills"), count: data.skills.length },
    { id: "nodes", label: t("brain.tab.nodes"), count: data.nodes.length },
    { id: "memory", label: t("brain.tab.memory"), count: data.memories.length },
    { id: "search", label: t("brain.tab.search"), count: hits?.length ?? 0 },
    { id: "policies", label: t("brain.tab.policies"), count: policies.length },
    { id: "projects", label: t("brain.tab.projects"), count: projects.length },
    { id: "atlas", label: t("brain.tab.atlas"), count: atlasResource.state.data?.nodes.length ?? 0 },
    { id: "universe", label: t("brain.tab.universe"), count: universeResource.state.data?.projects.length ?? 0 },
    { id: "tools", label: t("brain.tab.tools"), count: toolCatalog.length },
    { id: "activity", label: t("brain.tab.activity"), count: auditEvents.length },
  ];

  return (
    <div className="brain">
      <header className="brain-head">
        <div>
          <h2>{t("brain.title")}</h2>
          <p className="brain-sub">{t("brain.subtitle")}</p>
          <p className={"brain-webmcp-status" + (webMcpStatus.availability === "ready" ? " brain-webmcp-status--ready" : "")}>
            {t("brain.webmcp.label")}: {webMcpStatus.availability === "ready" ? t("brain.webmcp.ready") : t("brain.webmcp.unavailable")}
          </p>
        </div>
        <button className="btn" onClick={() => surface.refresh({ forceLoading: true })} disabled={surface.state.refreshing} title={t("startup.refresh")}>
          <IconRefresh aria-hidden /> {t("startup.refresh")}
        </button>
      </header>

      <form className="brain-ask" onSubmit={runSearch}>
        <IconSearch aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("brain.askPlaceholder")}
          aria-label={t("brain.askPlaceholder")}
        />
        <button className="btn" type="submit" disabled={searchResource.state.refreshing}>{t("brain.search")}</button>
      </form>

      {surface.state.showError && (
        <div className="brain-error" role="alert"><IconAlert aria-hidden /> {t("brain.loadFailed")}</div>
      )}

      {approvals.length > 0 && (
        <section className="brain-approvals" aria-label={t("brain.permits.pending")}>
          <h3>{t("brain.permits.pending")}</h3>
          {approvals.map((a) => (
            <div key={a.id} className="brain-issue">
              <IconAlert aria-hidden />
              <code>{a.capability}</code>
              <span>{a.reason}</span>
              <button type="button" className="btn" onClick={() => void decide(a.id, "granted")}>{t("brain.permits.grant")}</button>
              <button type="button" className="btn" onClick={() => void decide(a.id, "denied")}>{t("brain.permits.deny")}</button>
            </div>
          ))}
        </section>
      )}

      <nav className="brain-tabs" aria-label={t("brain.title")}>
        {sections.map((s) => (
          <button key={s.id} type="button" className={`brain-tab${section === s.id ? " brain-tab--active" : ""}`} onClick={() => setSection(s.id)}>
            {s.label} <span className="brain-count">{s.count}</span>
          </button>
        ))}
      </nav>

      <div className="brain-body">
        {section === "wiki" && <WikiPanel apiBase={apiBase} />}
        {section === "knowledge" && <KnowledgePanel apiBase={apiBase} />}
        {section === "ask_brain" && <AskBrainPanel apiBase={apiBase} />}
        {section === "health" && <BrainHealthPanel apiBase={apiBase} initialHealth={brainHealth} />}
        {section === "agents" && <AgentList agents={data.agents} loading={surface.state.refreshing} t={t} />}
        {section === "tasks" && <TaskList tasks={data.tasks} loading={surface.state.refreshing} t={t} />}
        {section === "skills" && (
          <div>
            {data.skillIssues.length > 0 && (
              <div className="brain-issues">
                {data.skillIssues.map((i) => (
                  <div key={`${i.skillId}:${i.kind}`} className="brain-issue"><IconAlert aria-hidden /> {i.kind}: {i.detail}</div>
                ))}
              </div>
            )}
            <SkillList skills={data.skills} loading={surface.state.refreshing} t={t} />
          </div>
        )}
        {section === "nodes" && <NodeList nodes={data.nodes} loading={surface.state.refreshing} t={t} />}
        {section === "memory" && <MemoryList memories={data.memories} loading={surface.state.refreshing} t={t} />}
        {section === "search" && <SearchResults hits={hits ?? null} searching={searchResource.state.refreshing} t={t} />}
        {section === "policies" && <PolicyManager policies={policies} onAdd={addPolicy} onRemove={removePolicy} t={t} />}
        {section === "projects" && <ProjectManager projects={projects} lastScan={lastScan} onAdd={addProject} onScan={scanNow} t={t} />}
        {section === "atlas" && (
          <AtlasPanel
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            atlas={atlasResource.state.data}
            loading={atlasResource.state.refreshing}
            t={t}
          />
        )}
        {section === "universe" && (
          <GraphPanel
            graph={universeResource.state.data}
            loading={universeResource.state.refreshing}
            t={t}
          />
        )}
        {section === "tools" && <ToolInspector tools={toolCatalog} t={t} />}
        {section === "activity" && <AgentActivity events={auditEvents} t={t} />}
      </div>
    </div>
  );
}

function AgentList({ agents, loading, t }: { agents: AgentRow[]; loading: boolean; t: (k: "brain.loading" | "brain.empty.agents" | "brain.col.name" | "brain.col.provider" | "brain.col.type" | "brain.col.health") => string }) {
  return (
    <div>
      <p className="brain-loading" hidden={!loading || agents.length > 0}>{t("brain.loading")}</p>
      {agents.length === 0 && !loading ? <EmptyState title={t("brain.empty.agents")} /> : (
        <table className="brain-table">
          <thead><tr><th>{t("brain.col.name")}</th><th>{t("brain.col.provider")}</th><th>{t("brain.col.type")}</th><th>{t("brain.col.health")}</th><th>✓</th></tr></thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id}><td>{a.name}</td><td>{a.provider}</td><td>{a.type}</td><td><StatusChip status={a.health} /></td><td>{a.enabled ? "✓" : "—"}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}


function PolicyManager({ policies, onAdd, onRemove, t }: {
  policies: PolicyRow[];
  onAdd: (capability: string, effect: "allow" | "deny") => Promise<void>;
  onRemove: (policyId: string) => Promise<void>;
  t: (k: "brain.policies.capability" | "brain.policies.effect" | "brain.policies.addAllow" | "brain.policies.addDeny" | "brain.policies.empty" | "brain.policies.subject" | "brain.policies.remove") => string;
}) {
  const [capability, setCapability] = useState("fs.read");
  return (
    <div className="brain-policies">
      <div className="brain-policy-add">
        <select value={capability} onChange={(e) => setCapability(e.target.value)} aria-label={t("brain.policies.capability")}>
          {["fs.read", "fs.write", "net.fetch", "shell.exec", "git.push", "deploy"].map((cap) => (
            <option key={cap} value={cap}>{cap}</option>
          ))}
        </select>
        <button type="button" className="btn" onClick={() => void onAdd(capability, "allow")}>{t("brain.policies.addAllow")}</button>
        <button type="button" className="btn" onClick={() => void onAdd(capability, "deny")}>{t("brain.policies.addDeny")}</button>
      </div>
      {policies.length === 0 ? <EmptyState title={t("brain.policies.empty")} /> : (
        <table className="brain-table">
          <thead><tr><th>{t("brain.policies.capability")}</th><th>{t("brain.policies.subject")}</th><th>{t("brain.policies.effect")}</th><th></th></tr></thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id}>
                <td><code>{p.capability}</code></td>
                <td>{p.subjectType}{p.subjectId ? ":" + p.subjectId : ""}</td>
                <td><span className={`brain-chip ${p.effect === "allow" ? "brain-chip-ok" : "brain-chip-bad"}`}>{p.effect}</span></td>
                <td><button type="button" className="btn" onClick={() => void onRemove(p.id)}>{t("brain.policies.remove")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProjectManager({ projects, lastScan, onAdd, onScan, t }: {
  projects: ProjectRow[];
  lastScan: { projectId: string; coverage: ScanCoverage } | null;
  onAdd: (name: string, rootPath: string) => Promise<void>;
  onScan: (projectId: string) => Promise<void>;
  t: (k: "brain.projects.name" | "brain.projects.path" | "brain.projects.add" | "brain.projects.scan" | "brain.projects.empty" | "brain.projects.files" | "brain.projects.lastScan") => string;
}) {
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  return (
    <div className="brain-policies">
      <form className="brain-policy-add" onSubmit={(e) => { e.preventDefault(); if (name.trim() && rootPath.trim()) { void onAdd(name, rootPath); setName(""); setRootPath(""); } }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("brain.projects.name")} aria-label={t("brain.projects.name")} />
        <input value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder={t("brain.projects.path")} aria-label={t("brain.projects.path")} />
        <button type="submit" className="btn">{t("brain.projects.add")}</button>
      </form>
      {projects.length === 0 ? <EmptyState title={t("brain.projects.empty")} /> : (
        <table className="brain-table">
          <thead><tr><th>{t("brain.projects.name")}</th><th>{t("brain.projects.path")}</th><th></th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td><code>{p.rootPath}</code></td>
                <td><button type="button" className="btn" onClick={() => void onScan(p.id)}>{t("brain.projects.scan")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {lastScan && (
        <p className="brain-sub">{t("brain.projects.lastScan")}: {lastScan.coverage.filesScanned} {t("brain.projects.files")} · {lastScan.coverage.filesSecretExcluded} / {lastScan.coverage.filesIgnored} / {lastScan.coverage.scanDurationMs}</p>
      )}
    </div>
  );
}

function AtlasPanel({ projects, selectedProjectId, onSelectProject, atlas, loading, t }: {
  projects: ProjectRow[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  atlas: AtlasResponse | undefined;
  loading: boolean;
  t: TFn;
}) {
  return (
    <div className="brain-graph-panel">
      <div className="brain-policy-add">
        <label htmlFor="brain-atlas-project">{t("brain.graph.selectProject")}</label>
        <select
          id="brain-atlas-project"
          value={selectedProjectId ?? ""}
          onChange={(event) => onSelectProject(event.target.value)}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </div>
      <GraphPanel graph={atlas} loading={loading} t={t} />
    </div>
  );
}

function GraphPanel({ graph, loading, t }: {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] } | undefined;
  loading: boolean;
  t: TFn;
}) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  if (loading && !graph) return <p className="brain-loading">{t("brain.loading")}</p>;
  if (!graph || graph.nodes.length === 0) return <EmptyState title={t("brain.graph.empty")} />;

  const maxNodes = 180;
  const visibleNodes = graph.nodes.slice(0, maxNodes);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const positions = new Map<string, { x: number; y: number }>();
  const typeCounts = new Map<GraphNode["type"], number>();
  const xByType: Record<GraphNode["type"], number> = {
    universe: 40,
    project: 250,
    folder: 460,
    file: 670,
  };
  for (const node of visibleNodes) {
    const index = typeCounts.get(node.type) ?? 0;
    typeCounts.set(node.type, index + 1);
    positions.set(node.id, { x: xByType[node.type], y: 36 + index * 46 });
  }
  const height = Math.max(280, ...[...typeCounts.values()].map((count) => count * 46 + 72));

  return (
    <div className="brain-graph-wrap">
      <div className="brain-graph-summary">
        <span>{visibleNodes.length} {t("brain.graph.nodes")}</span>
        <span>{visibleEdges.length} {t("brain.graph.edges")}</span>
        {graph.nodes.length > maxNodes && <span>{t("brain.graph.capped")}</span>}
      </div>
      <div className="brain-graph-scroll">
        <svg
          className="brain-graph-svg"
          viewBox={`0 0 900 ${height}`}
          role="img"
          aria-label={t("brain.graph.aria")}
        >
          <g className="brain-graph-edges">
            {visibleEdges.map((edge) => {
              const source = positions.get(edge.source);
              const target = positions.get(edge.target);
              if (!source || !target) return null;
              return (
                <line
                  key={`${edge.source}:${edge.target}`}
                  x1={source.x + 170}
                  y1={source.y + 16}
                  x2={target.x}
                  y2={target.y + 16}
                />
              );
            })}
          </g>
          <g className="brain-graph-nodes">
            {visibleNodes.map((node) => {
              const position = positions.get(node.id)!;
              const label = node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label;
              return (
                <g
                  key={node.id}
                  className={`brain-graph-node brain-graph-node--${node.type}`}
                  data-brain-node-type={node.type}
                  style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedNode(node)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelectedNode(node);
                  }}
                >
                  <rect width="170" height="32" rx="8" />
                  <text x="12" y="21">{label}</text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      {selectedNode && (
        <div className="brain-graph-detail" role="status">
          <strong>{selectedNode.label}</strong>
          <span>{selectedNode.type}</span>
          {selectedNode.path && <code>{selectedNode.path}</code>}
        </div>
      )}
    </div>
  );
}

function ToolInspector({ tools, t }: { tools: Array<{ name: string; description: string; riskTier: string; readOnly: boolean }>; t: TFn }) {
  if (tools.length === 0) return <EmptyState title={t("brain.tool.empty")} />;
  return (
    <table className="brain-table">
      <thead><tr><th>{t("brain.activity.tool")}</th><th>{t("brain.tool.risk")}</th><th>{t("brain.tool.readOnly")}</th><th></th></tr></thead>
      <tbody>
        {tools.map((tool) => (
          <tr key={tool.name}>
            <td><code>{tool.name}</code><p className="brain-sub">{tool.description}</p></td>
            <td><span className={`brain-chip ${tool.riskTier === "R0" || tool.riskTier === "R1" ? "brain-chip-ok" : "brain-chip-bad"}`}>{tool.riskTier}</span></td>
            <td>{tool.readOnly ? t("brain.tool.readOnly") : "—"}</td>
            <td><button type="button" className="btn" disabled title={t("brain.tool.execute")}>{t("brain.tool.execute")}</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AgentActivity({ events, t }: { events: AuditEventRow[]; t: TFn }) {
  if (events.length === 0) return <EmptyState title={t("brain.activity.empty")} />;
  return (
    <table className="brain-table">
      <thead><tr><th>{t("brain.activity.tool")}</th><th>{t("brain.activity.actor")}</th><th>{t("brain.activity.result")}</th><th></th></tr></thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id}>
            <td><code>{event.tool}</code></td>
            <td>{event.actor}</td>
            <td><span className={`brain-chip ${event.result === "success" ? "brain-chip-ok" : "brain-chip-bad"}`}>{event.result}</span></td>
            <td className="brain-sub">{event.inputSummary}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* =========================================================================
 * Phase 20.5: Living Knowledge Brain Components
 * ========================================================================= */

interface WikiPageItem {
  slug: string;
  domain: string;
  title: string;
  entity_id: string | null;
  freshness_score: number;
  is_human_curated: number;
  last_compiled_at: number;
  status: string;
}

function WikiPanel({ apiBase }: { apiBase: string }) {
  const [pages, setPages] = useState<WikiPageItem[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [pageDetail, setPageDetail] = useState<{ page: WikiPageItem; markdown?: string } | null>(null);
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const fetchPages = useCallback(() => {
    setLoading(true);
    void getJson<{ pages: WikiPageItem[] }>(apiBase, "/api/agent-os/brain/wiki")
      .then((res) => {
        setPages(res.pages || []);
        if (!selectedSlug && res.pages?.[0]) {
          setSelectedSlug(res.pages[0].slug);
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
      });
  }, [apiBase, selectedSlug]);

  useEffect(() => {
    let active = true;
    void getJson<{ pages: WikiPageItem[] }>(apiBase, "/api/agent-os/brain/wiki")
      .then((res) => {
        if (!active) return;
        setPages(res.pages || []);
        if (!selectedSlug && res.pages?.[0]) {
          setSelectedSlug(res.pages[0].slug);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [apiBase, selectedSlug]);

  const fetchDetail = useCallback((slug: string) => {
    void getJson<{ page: WikiPageItem; markdown?: string }>(apiBase, `/api/agent-os/brain/wiki/${encodeURIComponent(slug)}`)
      .then((res) => {
        setPageDetail(res);
      })
      .catch(() => {
        setPageDetail(null);
      });
  }, [apiBase]);

  useEffect(() => {
    if (!selectedSlug) return;
    let active = true;
    void getJson<{ page: WikiPageItem; markdown?: string }>(apiBase, `/api/agent-os/brain/wiki/${encodeURIComponent(selectedSlug)}`)
      .then((res) => {
        if (!active) return;
        setPageDetail(res);
      })
      .catch(() => {
        if (active) setPageDetail(null);
      });
    return () => {
      active = false;
    };
  }, [apiBase, selectedSlug]);

  const handleBootstrap = async () => {
    setActionBusy(true);
    try {
      await fetch(`${apiBase}/api/agent-os/brain/bootstrap`, { method: "POST" });
      fetchPages();
    } finally {
      setActionBusy(false);
    }
  };

  const handleCompile = async (slug: string) => {
    setActionBusy(true);
    try {
      await fetch(`${apiBase}/api/agent-os/brain/wiki/${encodeURIComponent(slug)}/compile`, { method: "POST" });
      fetchDetail(slug);
    } finally {
      setActionBusy(false);
    }
  };

  const filteredPages = domainFilter === "all" ? pages : pages.filter((p) => p.domain === domainFilter);

  return (
    <div>
      <div className="brain-lkb-toolbar">
        <div className="brain-subnav" style={{ marginBottom: 0 }}>
          {["all", "projects", "phases", "architecture", "concepts"].map((d) => (
            <button
              key={d}
              type="button"
              className={`brain-subnav-btn${domainFilter === d ? " brain-subnav-btn--active" : ""}`}
              onClick={() => setDomainFilter(d)}
            >
              <code>{d.toUpperCase()}</code>
            </button>
          ))}
        </div>
        <div className="brain-lkb-actions">
          {actionBusy && <span className="brain-sub"><code>busy</code></span>}
          <button type="button" className="btn" onClick={() => void handleBootstrap()}>
            <code>Bootstrap Phase Specs</code>
          </button>
        </div>
      </div>

      {loading && pages.length === 0 ? (
        <p className="brain-loading"><code>Loading Living Wiki...</code></p>
      ) : (
        <div className="brain-wiki-layout">
          <div className="brain-wiki-list">
            {filteredPages.length === 0 ? (
              <p className="brain-sub"><code>No wiki pages found in this domain.</code></p>
            ) : (
              filteredPages.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  className={`brain-wiki-item${selectedSlug === p.slug ? " brain-wiki-item--selected" : ""}`}
                  onClick={() => setSelectedSlug(p.slug)}
                >
                  <div className="brain-wiki-item-head">
                    <span className="brain-wiki-item-title">{p.title}</span>
                    <span className={`brain-chip ${p.freshness_score > 0.8 ? "brain-chip-ok" : "brain-chip-warn"}`}>
                      <code>{(p.freshness_score * 100).toFixed(0)}%</code>
                    </span>
                  </div>
                  <div className="brain-wiki-item-meta">
                    <code>{p.slug}</code>
                    {p.is_human_curated ? (
                      <span className="brain-chip brain-chip-ok">
                        <code>HUMAN</code>
                      </span>
                    ) : null}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="brain-wiki-view">
            {pageDetail ? (
              <div>
                <div className="brain-wiki-view-header">
                  <div>
                    <h3 className="brain-wiki-view-title">{pageDetail.page.title}</h3>
                    <div className="brain-wiki-item-meta">
                      <code>{pageDetail.page.slug}</code> &bull; <code>domain: {pageDetail.page.domain}</code>
                    </div>
                  </div>
                  <button type="button" className="btn" onClick={() => void handleCompile(pageDetail.page.slug)}>
                    <code>Recompile Page</code>
                  </button>
                </div>

                {pageDetail.markdown?.includes("<!-- PAO:HUMAN-START -->") && (
                  <div className="brain-wiki-human-banner">
                    <code>&#9889; Human-curated sections are preserved across all wiki recompilations.</code>
                  </div>
                )}

                <div className="brain-wiki-markdown">
                  <code>{pageDetail.markdown || "No markdown content compiled yet."}</code>
                </div>
              </div>
            ) : (
              <p className="brain-sub"><code>Select a wiki page to view contents.</code></p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface ClaimItem {
  id: string;
  subject_entity: string;
  predicate: string;
  object_value: string;
  confidence: number;
  status: string;
  valid_from: string;
}

interface ContradictionItem {
  id: string;
  topic: string;
  claim_a_id: string;
  claim_b_id: string;
  severity: string;
  status: string;
  resolution_strategy: string | null;
  resolution_notes: string | null;
}

interface EntityItem {
  id: string;
  canonical_name: string;
  kind: string;
}

function KnowledgePanel({ apiBase }: { apiBase: string }) {
  const [subTab, setSubTab] = useState<"claims" | "contradictions" | "entities">("claims");
  const [claims, setClaims] = useState<ClaimItem[]>([]);
  const [contradictions, setContradictions] = useState<ContradictionItem[]>([]);
  const [entities, setEntities] = useState<EntityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    void Promise.all([
      getJson<{ claims: ClaimItem[] }>(apiBase, "/api/agent-os/brain/claims"),
      getJson<{ contradictions: ContradictionItem[] }>(apiBase, "/api/agent-os/brain/contradictions"),
      getJson<{ entities: EntityItem[] }>(apiBase, "/api/agent-os/brain/entities"),
    ])
      .then(([cRes, contRes, eRes]) => {
        setClaims(cRes.claims || []);
        setContradictions(contRes.contradictions || []);
        setEntities(eRes.entities || []);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
      });
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getJson<{ claims: ClaimItem[] }>(apiBase, "/api/agent-os/brain/claims"),
      getJson<{ contradictions: ContradictionItem[] }>(apiBase, "/api/agent-os/brain/contradictions"),
      getJson<{ entities: EntityItem[] }>(apiBase, "/api/agent-os/brain/entities"),
    ])
      .then(([cRes, contRes, eRes]) => {
        if (!active) return;
        setClaims(cRes.claims || []);
        setContradictions(contRes.contradictions || []);
        setEntities(eRes.entities || []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [apiBase]);

  const handleResolve = async (contradictionId: string) => {
    setResolvingId(contradictionId);
    try {
      await fetch(`${apiBase}/api/agent-os/brain/contradictions/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contradictionId,
          strategy: "SOURCE_PRIORITY",
          resolutionNotes: "Resolved manually by operator in GUI via source priority.",
        }),
      });
      loadData();
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div>
      <div className="brain-subnav">
        <button
          type="button"
          className={`brain-subnav-btn${subTab === "claims" ? " brain-subnav-btn--active" : ""}`}
          onClick={() => setSubTab("claims")}
        >
          <code>Claims ({claims.length})</code>
        </button>
        <button
          type="button"
          className={`brain-subnav-btn${subTab === "contradictions" ? " brain-subnav-btn--active" : ""}`}
          onClick={() => setSubTab("contradictions")}
        >
          <code>Contradictions Inbox ({contradictions.length})</code>
        </button>
        <button
          type="button"
          className={`brain-subnav-btn${subTab === "entities" ? " brain-subnav-btn--active" : ""}`}
          onClick={() => setSubTab("entities")}
        >
          <code>Entities ({entities.length})</code>
        </button>
      </div>

      {loading && <p className="brain-loading"><code>Loading Knowledge Graph...</code></p>}

      {subTab === "claims" && (
        <table className="brain-table">
          <thead>
            <tr>
              <th><code>Subject</code></th>
              <th><code>Predicate</code></th>
              <th><code>Object Value</code></th>
              <th><code>Confidence</code></th>
              <th><code>Status</code></th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.subject_entity}</strong></td>
                <td><code>{c.predicate}</code></td>
                <td><code>{c.object_value}</code></td>
                <td><code>{(c.confidence * 100).toFixed(0)}%</code></td>
                <td><StatusChip status={c.status.toLowerCase()} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {subTab === "contradictions" && (
        <div>
          {contradictions.length === 0 ? (
            <p className="brain-sub"><code>No contradictions detected in Knowledge Base.</code></p>
          ) : (
            contradictions.map((c) => (
              <div
                key={c.id}
                className={`brain-contradiction-card ${c.status === "OPEN" ? "brain-contradiction-card--open" : "brain-contradiction-card--resolved"}`}
              >
                <div className="brain-contradiction-header">
                  <strong>{c.topic}</strong>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span className={`brain-chip ${c.severity === "CRITICAL" ? "brain-chip-bad" : "brain-chip-warn"}`}>
                      <code>{c.severity}</code>
                    </span>
                    <StatusChip status={c.status.toLowerCase()} />
                  </div>
                </div>
                <p className="brain-sub">
                  <code>Conflicting claims: {c.claim_a_id} vs {c.claim_b_id}</code>
                </p>
                {c.resolution_notes && (
                  <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ok, #2e7d32)" }}>
                    <code>{c.resolution_notes}</code>
                  </p>
                )}
                {c.status === "OPEN" && (
                  <div>
                    <button
                      type="button"
                      className="btn"
                      disabled={resolvingId === c.id}
                      onClick={() => void handleResolve(c.id)}
                    >
                      <code>{resolvingId === c.id ? "Resolving..." : "Auto-Resolve via Source Priority"}</code>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {subTab === "entities" && (
        <table className="brain-table">
          <thead>
            <tr>
              <th><code>Canonical Name</code></th>
              <th><code>Kind</code></th>
              <th><code>ID</code></th>
            </tr>
          </thead>
          <tbody>
            {entities.map((e) => (
              <tr key={e.id}>
                <td><strong>{e.canonical_name}</strong></td>
                <td><span className="brain-chip brain-chip-ok"><code>{e.kind}</code></span></td>
                <td><code>{e.id}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface CitationItem {
  sourceTitle: string;
  versionHash?: string;
  chunkSnippet: string;
  lineRange?: string;
}

interface QueryResult {
  answer: string;
  confidence: number;
  strategy: string;
  citations: CitationItem[];
}

function AskBrainPanel({ apiBase }: { apiBase: string }) {
  const [askQuery, setAskQuery] = useState("What is Phase 20.3?");
  const [mode, setMode] = useState<"canonical" | "historical">("canonical");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!askQuery.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/agent-os/brain/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: askQuery, mode }),
      });
      if (res.ok) {
        const body = (await res.json()) as QueryResult;
        setResult(body);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="brain-ask-container">
      <form className="brain-ask-form" onSubmit={handleAsk}>
        <input
          type="text"
          className="brain-ask-input"
          value={askQuery}
          onChange={(e) => setAskQuery(e.target.value)}
          placeholder="ocx: brain query [query] --mode=canonical"
        />
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "canonical" | "historical")}
          style={{ padding: "10px", borderRadius: "8px", background: "var(--bg-input, #222)", color: "#fff", border: "1px solid var(--line, #444)" }}
        >
          <option value="canonical">canonical</option>
          <option value="historical">historical</option>
        </select>
        <button type="submit" className="btn" disabled={loading}>
          <code>{loading ? "querying..." : "Ask Brain"}</code>
        </button>
      </form>

      {result && (
        <div className="brain-ask-response">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="brain-chip brain-chip-ok"><code>strategy: {result.strategy}</code></span>
            <span className="brain-chip brain-chip-ok"><code>confidence: {(result.confidence * 100).toFixed(0)}%</code></span>
          </div>

          <div className="brain-ask-answer">{result.answer}</div>

          {result.citations && result.citations.length > 0 && (
            <div className="brain-citations">
              <strong><code>Evidence &amp; Provenance Citations ({result.citations.length}):</code></strong>
              {result.citations.map((cit, idx) => (
                <div key={idx} className="brain-citation-item">
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <strong>{cit.sourceTitle}</strong>
                    {cit.lineRange && <span className="brain-sub"><code>{cit.lineRange}</code></span>}
                  </div>
                  <p style={{ margin: 0, color: "var(--muted, #9ca3af)" }}><code>{cit.chunkSnippet}</code></p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BrainHealthPanel({ apiBase, initialHealth }: { apiBase: string; initialHealth: {
  healthy: boolean;
  sources: number;
  sourceVersions: number;
  chunks: number;
  entities: number;
  claims: number;
  relations: number;
  decisions: number;
  wikiPages: number;
  contradictions: number;
  unresolvedContradictions: number;
  healthScore: number;
} | null }) {
  const [health, setHealth] = useState(initialHealth);
  const [lint, setLint] = useState<{
    valid: boolean;
    issuesCount: number;
    openContradictions: Array<{ id: string; topic: string; severity: string }>;
    missingProvenance: Array<{ claimId: string }>;
    orphanPages: Array<{ slug: string }>;
    brokenLinks: Array<{ sourceSlug: string; targetSlug: string }>;
  } | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshHealth = useCallback(() => {
    void Promise.all([
      getJson<typeof initialHealth>(apiBase, "/api/agent-os/brain/health"),
      getJson<typeof lint>(apiBase, "/api/agent-os/brain/lint"),
    ])
      .then(([hRes, lRes]) => {
        setHealth(hRes);
        setLint(lRes);
      })
      .catch(() => {});
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getJson<typeof initialHealth>(apiBase, "/api/agent-os/brain/health"),
      getJson<typeof lint>(apiBase, "/api/agent-os/brain/lint"),
    ])
      .then(([hRes, lRes]) => {
        if (!active) return;
        setHealth(hRes);
        setLint(lRes);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [apiBase]);

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      await fetch(`${apiBase}/api/agent-os/brain/rebuild`, { method: "POST" });
      refreshHealth();
    } finally {
      setRebuilding(false);
    }
  };

  const handlePrune = async () => {
    setBusy(true);
    try {
      await fetch(`${apiBase}/api/agent-os/brain/prune`, { method: "POST" });
      refreshHealth();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="brain-lkb-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h3><code>Knowledge Brain Observatory</code></h3>
          {busy && <span className="brain-sub"><code>busy</code></span>}
        </div>
        <div className="brain-lkb-actions">
          <button type="button" className="btn" onClick={() => void refreshHealth()}>
            <code>Run Linter</code>
          </button>
          <button type="button" className="btn" disabled={rebuilding} onClick={() => void handleRebuild()}>
            <code>{rebuilding ? "Rebuilding..." : "Rebuild All Indices"}</code>
          </button>
          <button type="button" className="btn" onClick={() => void handlePrune()}>
            <code>Prune Old Generations</code>
          </button>
        </div>
      </div>

      <div className="brain-scorecard-grid">
        <div className="brain-stat-card">
          <span className="brain-stat-label"><code>Health Score</code></span>
          <span className="brain-stat-value" style={{ color: "var(--ok, #10b981)" }}>
            <code>{health?.healthScore ?? 100}/100</code>
          </span>
          <span className="brain-stat-note"><code>Zero data loss guaranteed</code></span>
        </div>

        <div className="brain-stat-card">
          <span className="brain-stat-label"><code>Registered Sources</code></span>
          <span className="brain-stat-value"><code>{health?.sources ?? 0}</code></span>
          <span className="brain-stat-note"><code>{health?.chunks ?? 0} section chunks</code></span>
        </div>

        <div className="brain-stat-card">
          <span className="brain-stat-label"><code>Atomic Claims</code></span>
          <span className="brain-stat-value"><code>{health?.claims ?? 0}</code></span>
          <span className="brain-stat-note"><code>{health?.relations ?? 0} graph relations</code></span>
        </div>

        <div className="brain-stat-card">
          <span className="brain-stat-label"><code>Living Wiki Pages</code></span>
          <span className="brain-stat-value"><code>{health?.wikiPages ?? 0}</code></span>
          <span className="brain-stat-note"><code>Preserved human sections</code></span>
        </div>

        <div className="brain-stat-card">
          <span className="brain-stat-label"><code>Contradictions</code></span>
          <span className="brain-stat-value" style={{ color: (health?.unresolvedContradictions ?? 0) > 0 ? "var(--bad, #ef4444)" : "var(--ok, #10b981)" }}>
            <code>{health?.unresolvedContradictions ?? 0}</code>
          </span>
          <span className="brain-stat-note"><code>{health?.contradictions ?? 0} total cases detected</code></span>
        </div>
      </div>

      {lint && (
        <div className="brain-wiki-view">
          <h4><code>Knowledge Linter Diagnostic Report</code></h4>
          <p className="brain-sub">
            <code>Orphan Pages: {lint.orphanPages?.length ?? 0} &bull; Broken Wiki Links: {lint.brokenLinks?.length ?? 0} &bull; Missing Provenance: {lint.missingProvenance?.length ?? 0}</code>
          </p>
          {lint.openContradictions && lint.openContradictions.length > 0 && (
            <div className="brain-issues">
              {lint.openContradictions.map((c) => (
                <div key={c.id} className="brain-issue">
                  <IconAlert aria-hidden /> <code>Open Contradiction: {c.topic} (Severity: {c.severity})</code>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}