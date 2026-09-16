// Phase 20.37 — seed manifests (§9, §11, §12, §18) as DATA. Registries can be
// re-mapped without touching router source (§12); the hook policy ships the
// §18 defaults (secret-file deny, outside-workspace deny, destructive-git
// deny, risk-3 approval, quality gate on commit, audit emission).

import type { AgentManifest, HookEvent, HookPolicy, SkillManifest } from "./types";

export const SEED_AGENTS: AgentManifest[] = [
  {
    slug: "orchestrator", name: "Workflow Orchestrator", version: "1.0.0", enabled: true,
    description: "Coordinates workflows, routes work, tracks state, opens approval gates; never makes broad file changes.",
    runtime: { preferred: "deterministic", fallbacks: ["codex"] },
    riskCeiling: 1,
    capabilities: ["workflow.coordinate", "route.decide", "approval.open", "result.synthesize"],
    tools: { allow: ["filesystem.read", "git.status", "git.diff"], deny: ["filesystem.write", "command.destructive", "git.commit"] },
    skills: ["plan", "brainstorm", "remember"],
    routing: { triggerTerms: ["orchestrate", "coordinate", "workflow"], priority: 90 },
    limits: { maxParallelTasks: 1, maxRuntimeSeconds: 600 },
  },
  {
    slug: "explorer", name: "Repository Explorer", version: "1.0.0", enabled: true,
    description: "Read-only codebase structure, architecture and dependency analysis.",
    runtime: { preferred: "deterministic", fallbacks: ["codex", "claude", "local-ai"] },
    riskCeiling: 0,
    capabilities: ["repo.read", "repo.search", "architecture.map", "dependency.inspect"],
    tools: { allow: ["filesystem.read", "filesystem.search", "git.status", "git.diff", "git.log"], deny: ["filesystem.write", "command.destructive", "git.commit"] },
    skills: ["explore", "docs"],
    routing: { triggerTerms: ["explore", "inspect", "analyze repository", "architecture", "dependencies", "structure"], priority: 80 },
    limits: { maxParallelTasks: 3, maxRuntimeSeconds: 900 },
  },
  {
    slug: "planner", name: "Implementation Planner", version: "1.0.0", enabled: true,
    description: "Converts goals into bounded implementation steps with acceptance targets.",
    runtime: { preferred: "deterministic", fallbacks: ["codex", "local-ai"] },
    riskCeiling: 0,
    capabilities: ["plan.write", "module.map", "acceptance.define"],
    tools: { allow: ["filesystem.read", "git.diff"], deny: ["filesystem.write", "command.destructive"] },
    skills: ["plan", "brainstorm", "explore"],
    routing: { triggerTerms: ["plan", "design approach", "break down", "steps"], priority: 78 },
    limits: { maxParallelTasks: 2, maxRuntimeSeconds: 600 },
  },
  {
    slug: "implementer", name: "Bounded Implementer", version: "1.0.0", enabled: true,
    description: "Writes code inside approved workspace scope; works in an isolated worktree when required.",
    runtime: { preferred: "codex", fallbacks: ["claude", "local-ai"] },
    riskCeiling: 2,
    capabilities: ["repo.write", "command.run", "tests.run"],
    tools: { allow: ["filesystem.read", "filesystem.write", "command.run", "git.diff", "git.status"], deny: ["command.destructive", "git.push", "git.commit"] },
    skills: ["implement", "refactor", "docs"],
    routing: { triggerTerms: ["implement", "build", "add feature", "fix", "write code", "แก้", "ทำ"], priority: 75 },
    limits: { maxParallelTasks: 3, maxRuntimeSeconds: 1800 },
  },
  {
    slug: "reviewer", name: "Diff Reviewer", version: "1.0.0", enabled: true,
    description: "Reviews diffs for correctness, regressions and architecture violations; read-only.",
    runtime: { preferred: "deterministic", fallbacks: ["codex"] },
    riskCeiling: 0,
    capabilities: ["diff.review", "regression.detect", "architecture.check"],
    tools: { allow: ["filesystem.read", "git.diff", "git.log"], deny: ["filesystem.write", "command.destructive"] },
    skills: ["review", "security-audit"],
    routing: { triggerTerms: ["review", "check diff", "look over"], priority: 70 },
    limits: { maxParallelTasks: 2, maxRuntimeSeconds: 600 },
  },
  {
    slug: "verifier", name: "Verification Engineer", version: "1.0.0", enabled: true,
    description: "Runs typecheck/tests/build and reports evidence.",
    runtime: { preferred: "deterministic", fallbacks: ["codex"] },
    riskCeiling: 2,
    capabilities: ["tests.run", "build.run", "evidence.report"],
    tools: { allow: ["filesystem.read", "command.run", "git.status"], deny: ["filesystem.write", "command.destructive", "git.push"] },
    skills: ["verify", "test", "commit-check"],
    routing: { triggerTerms: ["verify", "run tests", "typecheck", "validate"], priority: 72 },
    limits: { maxParallelTasks: 2, maxRuntimeSeconds: 1800 },
  },
  {
    slug: "security-auditor", name: "Security Auditor", version: "1.0.0", enabled: true,
    description: "Reviews auth/permissions/secret handling/injection surfaces; read-only; critical findings block DONE.",
    runtime: { preferred: "deterministic", fallbacks: ["codex"] },
    riskCeiling: 0,
    capabilities: ["security.review", "secret.scan", "injection.inspect"],
    tools: { allow: ["filesystem.read", "git.diff"], deny: ["filesystem.write", "command.destructive"] },
    skills: ["security-audit", "review"],
    routing: { triggerTerms: ["security", "audit security", "vulnerability", "secret"], priority: 76 },
    limits: { maxParallelTasks: 2, maxRuntimeSeconds: 600 },
  },
  {
    slug: "test-engineer", name: "Test Engineer", version: "1.0.0", enabled: true,
    description: "Adds unit/integration tests with deterministic fixtures; never weakens assertions.",
    runtime: { preferred: "codex", fallbacks: ["claude"] },
    riskCeiling: 2,
    capabilities: ["tests.write", "fixtures.build"],
    tools: { allow: ["filesystem.read", "filesystem.write", "command.run"], deny: ["command.destructive", "git.push"] },
    skills: ["test", "verify"],
    routing: { triggerTerms: ["add test", "test coverage", "unit test"], priority: 68 },
    limits: { maxParallelTasks: 2, maxRuntimeSeconds: 1200 },
  },
  {
    slug: "memory-curator", name: "Memory Curator", version: "1.0.0", enabled: true,
    description: "Stores approved decisions/patterns/outcomes; never credentials or chain-of-thought.",
    runtime: { preferred: "deterministic", fallbacks: [] },
    riskCeiling: 0,
    capabilities: ["memory.write", "decision.record"],
    tools: { allow: [], deny: ["filesystem.write", "command.destructive"] },
    skills: ["remember", "docs"],
    routing: { triggerTerms: ["remember", "record decision", "save convention"], priority: 50 },
    limits: { maxParallelTasks: 1, maxRuntimeSeconds: 300 },
  },
];

export const SEED_SKILLS: SkillManifest[] = [
  { slug: "brainstorm", name: "Brainstorm Options", version: "1.0.0", enabled: true, riskLevel: 0, description: "Generate solution options before planning.", triggerTerms: ["brainstorm", "ideas", "options"], capabilities: ["ideation"], tools: { required: [], optional: [] }, workflow: { requires: [], followedBy: ["plan"] } },
  { slug: "explore", name: "Explore Repository", version: "1.0.0", enabled: true, riskLevel: 0, description: "Read-only repository exploration and architecture mapping.", triggerTerms: ["explore", "inspect", "architecture", "dependencies"], capabilities: ["repo.read", "architecture.map"], tools: { required: ["filesystem.read"], optional: ["git.log"] }, workflow: { requires: [], followedBy: ["plan"] } },
  { slug: "plan", name: "Plan Change", version: "1.0.0", enabled: true, riskLevel: 0, description: "Break a goal into bounded implementation steps.", triggerTerms: ["plan", "steps", "break down"], capabilities: ["plan.write"], tools: { required: ["filesystem.read"], optional: [] }, workflow: { requires: ["explore"], followedBy: ["implement"] } },
  { slug: "implement", name: "Implement Change", version: "1.0.0", enabled: true, riskLevel: 2, description: "Apply a bounded change inside the approved workspace.", triggerTerms: ["implement", "build", "add feature", "fix", "refactor"], capabilities: ["repo.write", "command.run"], tools: { required: ["filesystem.read", "filesystem.write", "git.diff"], optional: ["command.run"] }, workflow: { requires: ["explore", "plan"], followedBy: ["verify", "review"] } },
  { slug: "verify", name: "Verify Build", version: "1.0.0", enabled: true, riskLevel: 2, description: "Run typecheck/tests/build and collect evidence.", triggerTerms: ["verify", "typecheck", "validate"], capabilities: ["tests.run", "build.run"], tools: { required: ["command.run"], optional: ["filesystem.read"] }, workflow: { requires: ["implement"], followedBy: ["review"] } },
  { slug: "review", name: "Review Diff", version: "1.0.0", enabled: true, riskLevel: 0, description: "Review diffs for correctness and regression risk.", triggerTerms: ["review", "check diff"], capabilities: ["diff.review"], tools: { required: ["git.diff"], optional: ["filesystem.read"] }, workflow: { requires: ["implement"], followedBy: [] } },
  { slug: "security-audit", name: "Security Audit", version: "1.0.0", enabled: true, riskLevel: 0, description: "Audit security surfaces: auth, secrets, injection.", triggerTerms: ["security", "vulnerability", "secret scan"], capabilities: ["security.review"], tools: { required: ["git.diff"], optional: ["filesystem.read"] }, workflow: { requires: [], followedBy: [] } },
  { slug: "test", name: "Write Tests", version: "1.0.0", enabled: true, riskLevel: 2, description: "Add deterministic tests for the changed surface.", triggerTerms: ["test", "coverage"], capabilities: ["tests.write"], tools: { required: ["filesystem.write"], optional: ["command.run"] }, workflow: { requires: ["implement"], followedBy: ["verify"] } },
  { slug: "refactor", name: "Refactor", version: "1.0.0", enabled: true, riskLevel: 2, description: "Restructure code without behavior change.", triggerTerms: ["refactor", "clean up"], capabilities: ["repo.write"], tools: { required: ["filesystem.read", "filesystem.write"], optional: [] }, workflow: { requires: ["plan"], followedBy: ["verify", "review"] } },
  { slug: "docs", name: "Docs Update", version: "1.0.0", enabled: true, riskLevel: 1, description: "Update documentation for the changed surface.", triggerTerms: ["docs", "readme", "documentation"], capabilities: ["docs.write"], tools: { required: ["filesystem.read"], optional: ["filesystem.write"] }, workflow: { requires: [], followedBy: [] } },
  { slug: "remember", name: "Remember Decision", version: "1.0.0", enabled: true, riskLevel: 0, description: "Persist an approved decision or convention to memory.", triggerTerms: ["remember", "record decision"], capabilities: ["memory.write"], tools: { required: [], optional: [] }, workflow: { requires: [], followedBy: [] } },
  { slug: "commit-check", name: "Commit Gate Check", version: "1.0.0", enabled: true, riskLevel: 1, description: "Verify quality gates before a commit is allowed.", triggerTerms: ["commit check", "pre-commit"], capabilities: ["verification.check"], tools: { required: ["command.run"], optional: [] }, workflow: { requires: ["verify"], followedBy: [] } },
];

export const SEED_HOOK_POLICIES: HookPolicy[] = [
  {
    id: "deny-secret-file-write", event: "PRE_FILE_WRITE", priority: 10, mode: "enforce",
    action: "deny",
    when: { pathMatches: ["**/.env", "**/.env.*", "**/*id_rsa*", "**/*.pem", "**/credentials.json", "**/.ssh/**"] },
    message: "Writing secret-bearing files is blocked.",
  },
  {
    id: "deny-outside-workspace-write", event: "PRE_FILE_WRITE", priority: 20, mode: "enforce",
    action: "deny", when: { outsideWorkspace: true },
    message: "Writes outside the approved workspace are blocked.",
  },
  {
    id: "deny-destructive-git", event: "PRE_COMMAND", priority: 20, mode: "enforce",
    action: "deny",
    when: { commandMatches: ["git reset --hard", "git clean -fd", "git clean -fdx", "git push --force", "git push -f"] },
    message: "Destructive Git operations are blocked.",
  },
  {
    id: "approval-remote-mutation", event: "PRE_TOOL_USE", priority: 210, mode: "enforce",
    action: "require_approval", when: { riskGte: 3 },
    message: "External/privileged mutation requires approval.",
  },
  {
    id: "require-tests-before-commit", event: "PRE_COMMIT", priority: 310, mode: "enforce",
    action: "deny", when: { verificationNotPassed: true },
    message: "Verification must pass before a commit gate opens.",
  },
  {
    id: "redact-audit", event: "POST_TOOL_USE", priority: 420, mode: "enforce",
    action: "emit_audit", when: {},
    message: "Emit redacted audit event for tool completion.",
  },
];

export const HOOK_EVENT_PRIORITY_BANDS = "0-99 security, 100-199 workspace/git, 200-299 approval/risk, 300-399 quality, 400-499 metrics/audit, 500+ advisory";

export function hookEvents(): readonly HookEvent[] {
  return ["PRE_ROUTE", "POST_ROUTE", "PRE_AGENT_DISPATCH", "POST_AGENT_DISPATCH", "PRE_TOOL_USE", "POST_TOOL_USE", "PRE_FILE_WRITE", "PRE_COMMAND", "PRE_COMMIT", "RUN_STATUS_CHANGE", "ERROR"];
}
