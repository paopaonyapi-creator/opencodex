#!/usr/bin/env python3
"""Phase 20.33 — Open WebUI ↔ Pao integration contract smoke (doc §49, §X).

Checks, against configured URLs:
  1. PAO provider router answers GET /v1/models
  2. Pao MCP gateway: initialize -> tools/list returns pao.* entries
  3. A read-only governed tool call executes (or reports the fail-closed
     grant gap — both are contract-acceptable; hard failures are not)
  4. A high-risk tool call returns approval_required and never executes

Targets are operator-configured loopback/private service URLs. The fetch guard
below refuses anything else: only http(s), only loopback / private-network
addresses (or VERIFY_ALLOW_REMOTE=1 for a deliberate remote gateway), never
link-local or cloud-metadata addresses.

Usage:
  PAO_LLM_BASE_URL=http://127.0.0.1:PORT/v1 \
  PAO_MCP_URL=http://127.0.0.1:PORT/api/agent-os/ai-workspace/mcp \
  PAO_PROXY_TOKEN=... python bootstrap/verify.py
"""

import ipaddress
import json
import os
import socket
import sys
import urllib.request
from urllib.parse import urlparse

LLM_URL = os.environ.get("PAO_LLM_BASE_URL", "").rstrip("/")
MCP_URL = os.environ.get("PAO_MCP_URL", "").rstrip("/")
TOKEN = os.environ.get("PAO_PROXY_TOKEN", "")

failures = []


def assert_safe_target(url):
    """Refuse non-http(s) schemes and cloud-metadata / link-local targets."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"refusing non-http(s) target: {parsed.scheme or '(empty)'}")
    host = parsed.hostname or ""
    if "metadata" in host or host.endswith(".internal"):
        raise ValueError(f"refusing metadata-like host: {host}")
    infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if address.is_link_local:
            raise ValueError(f"refusing link-local address for {host}: {address}")
        if not (address.is_loopback or address.is_private) and os.environ.get("VERIFY_ALLOW_REMOTE") != "1":
            raise ValueError(f"refusing public address {address} for {host} (set VERIFY_ALLOW_REMOTE=1 to allow)")


def check(name, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {name}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def http_json(url, payload=None, token=None, timeout=15):
    assert_safe_target(url)
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode())


def mcp(method, params=None, token=None):
    return http_json(MCP_URL, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}, token)


def main():
    if not LLM_URL or not MCP_URL:
        print("Set PAO_LLM_BASE_URL, PAO_MCP_URL and PAO_PROXY_TOKEN")
        sys.exit(2)

    try:
        models = http_json(LLM_URL + "/models", token=TOKEN)
        ids = [m.get("id", "") for m in models.get("data", [])]
        check("provider router /v1/models reachable", True, "")
        check("pao aliases discoverable", any(str(i).startswith("pao") for i in ids), f"models={ids[:8]}")
    except Exception as exc:  # noqa: BLE001
        check("provider router /v1/models reachable", False, str(exc))

    try:
        init = mcp("initialize", {"protocolVersion": "2024-11-05"}, TOKEN)
        check("MCP initialize", "result" in init and "serverInfo" in init.get("result", {}))
        tools = mcp("tools/list", {}, TOKEN)
        names = [t.get("name", "") for t in tools.get("result", {}).get("tools", [])]
        check("MCP tools/list has pao.* catalog", any(n.startswith("pao.") for n in names), f"tools={names[:8]}")
    except Exception as exc:  # noqa: BLE001
        check("MCP initialize/tools/list", False, str(exc))
        return

    try:
        call = mcp("tools/call", {"name": "pao.system.health", "arguments": {"actor": "verify.py"}}, TOKEN)
        body = json.loads(call["result"]["content"][0]["text"])
        check("read-only tool call handled", body.get("status") in ("success", "denied"), f"status={body.get('status')}")
    except Exception as exc:  # noqa: BLE001
        check("read-only tool call handled", False, str(exc))

    try:
        call = mcp("tools/call", {"name": "pao.shell.execute", "arguments": {"binary": "bun", "args": "[\"--version\"]", "actor": "verify.py"}}, TOKEN)
        body = json.loads(call["result"]["content"][0]["text"])
        check("high-risk tool requires approval (fail-closed)", body.get("status") in ("approval_required", "denied", "failed"), f"status={body.get('status')}")
    except Exception as exc:  # noqa: BLE001
        check("high-risk tool requires approval", False, str(exc))

    print()
    if failures:
        print("FAILURES:", ", ".join(failures))
        sys.exit(1)
    print("Open WebUI ↔ Pao contract smoke: all checks passed")


if __name__ == "__main__":
    main()
