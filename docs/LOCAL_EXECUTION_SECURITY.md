# Pao-hubPro Local Execution Security & Command Containment

> **Safe Local Execution, Shell Protection & Workspace Anchoring**  
> **Updated:** 2026-09-17

## 1. Threat Vectors in Agentic Execution

When autonomous agents execute terminal commands and modify files, they introduce specific high-severity risks:
1. **Prompt Injection Escape:** Injected instructions in web scrapes, git issues, or user prompts commanding the agent to run `rm -rf /` or `curl | sh`.
2. **Path Traversal:** File mutations referencing `../../etc/shadow` or symlink redirection outside the repository.
3. **Privilege Escalation:** Unsupervised execution of `sudo`, `runas`, or `chmod 777`.
4. **Credential Exfiltration:** Commands attempting `cat ~/.ssh/id_rsa` or `env | grep KEY`.

---

## 2. Structural Security Safeguards

### 2.1 Workspace Anchoring
All filesystem operations resolve through `ToolExecutionSandbox.assertSafeWorkspacePath(path, workspaceRoot)`.  
- Canonical path comparison ensures the target begins with the normalized workspace root.
- Rejects null bytes, UNC share escapes, and parent directory traversal (`..`).

### 2.2 Shell Command Shield
Commands submitted to execution runtimes are screened before process spawning:
- Regular expression heuristics intercept known destructive patterns (`rm -rf /`, `mkfs`, `dd if=`, fork bombs).
- Privilege escalation commands (`sudo`, `su`, `runas`) are strictly blocked.
- Download-and-pipe patterns (`curl | sh`, `wget | sh`) are barred from autonomous execution.

### 2.3 Safe Git Execution
All Git operations utilize `assertSafeRef` and `spawnSync` with `shell: false` to eliminate option injection and argument splitting vulnerabilities.
