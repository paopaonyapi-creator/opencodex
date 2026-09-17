# Pao-hubPro Deployment & Infrastructure Guide

> **Production Deployment, Network Isolation & Docker Hardening**  
> **Updated:** 2026-09-17

## 1. Network Topology & Boundaries

```text
[Internet]
    │
    ▼
[Pao-hubPro Ingress Proxy] (Port 8080/8443)
    │
    ▼
[Private Bridge Network: pao-internal-net]
    ├── Pao Core Server (Bun native)
    ├── OmniRoute Gateway Container (Port 9090)
    └── Local Inference Runtime (Ollama / vLLM)
```

---

## 2. Docker Hardening Rules

1. **No Docker Socket:** Never mount `/var/run/docker.sock` into any application or gateway container.
2. **Unprivileged Execution:** Containers run with `privileged: false` and drop unnecessary Linux capabilities (`cap_drop: [ALL]`).
3. **Internal Only:** OmniRoute and inference endpoints bind only to the private bridge network; direct public exposure is prohibited.
4. **Read-Only Root:** Container filesystems run read-only, mounting ephemeral tmpfs only for required workspace directories.
