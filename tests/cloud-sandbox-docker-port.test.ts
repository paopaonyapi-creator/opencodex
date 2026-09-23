import { describe, expect, test } from "bun:test";

import {
  BrokeredCliDockerControlPort,
  type SpawnResult,
} from "../src/agent-os/cloud-sandbox/docker-control/brokered-cli-port";
import { SANDBOX_LABELS, type ContainerSpec } from "../src/agent-os/cloud-sandbox/docker-control/port";
import { CloudSandboxError } from "../src/agent-os/cloud-sandbox/errors";
import { FLOCI_PINNED_IMAGE } from "../src/agent-os/cloud-sandbox/adapters/floci-config";

const ALLOWED = [FLOCI_PINNED_IMAGE, "alpine:3.20"];

function recorder(response: Partial<SpawnResult> = {}) {
  const calls: string[][] = [];
  const port = new BrokeredCliDockerControlPort({
    allowedImages: ALLOWED,
    spawn: async (argv) => {
      calls.push(argv);
      return {
        exitCode: response.exitCode ?? 0,
        stdout: response.stdout ?? `${"a".repeat(64)}\n`,
        stderr: response.stderr ?? "",
      };
    },
  });
  return { port, calls };
}

function spec(overrides: Partial<ContainerSpec> = {}): ContainerSpec {
  return {
    image: FLOCI_PINNED_IMAGE,
    labels: { [SANDBOX_LABELS.sandbox]: "sbx_01", [SANDBOX_LABELS.workspace]: "ws_1" },
    env: { FLOCI_PORT: "4570", FLOCI_STORAGE_MODE: "memory" },
    ports: ["4570/tcp"],
    networkMode: "bridge",
    limits: { cpus: 2, memoryMb: 2048, pidsLimit: 512 },
    ...overrides,
  };
}

describe("phase 20.15 M7 — the broker refuses before it ever spawns", () => {
  test("a privileged spec never reaches the CLI", async () => {
    const { port, calls } = recorder();
    const err = await port.createContainer(spec({ privileged: true })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudSandboxError);
    expect((err as CloudSandboxError).code).toBe("CLOUD_POLICY_DENIED");
    expect((err as CloudSandboxError).retryable).toBe(false);
    // The whole security claim rests on this: refusal happens upstream of the transport, not
    // as a filter that a different code path could skip.
    expect(calls).toEqual([]);
  });

  test("host namespaces, devices and LAN publishing are all refused pre-spawn", async () => {
    for (const bad of [
      spec({ networkMode: "host" }),
      spec({ pidMode: "host" }),
      spec({ ipcMode: "host" }),
      spec({ devices: ["/dev/kvm"] }),
      spec({ binds: ["C:\\Users\\me\\.ssh:/keys"] }),
      spec({ binds: ["/var/run/docker.sock:/var/run/docker.sock"] }),
      spec({ image: "attacker/control:1" }),
    ]) {
      const { port, calls } = recorder();
      await expect(port.createContainer(bad)).rejects.toThrow(/refused by the broker/);
      expect(calls).toEqual([]);
    }
  });

  test("an id that is not hex is refused, so it cannot become a flag or a path", async () => {
    const { port, calls } = recorder();
    for (const bad of ["--help", "../etc", "a".repeat(11), "", "sh -c rm", "a".repeat(65)]) {
      await expect(port.startContainer(bad)).rejects.toThrow(/not a container id/);
    }
    expect(calls).toEqual([]);
  });

  test("a non-zero CLI exit surfaces as an unreachable adapter, not a silent success", async () => {
    const { port } = recorder({ exitCode: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" });
    await expect(port.createContainer(spec())).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
    expect(await port.isReachable()).toBe(false);
  });
});

describe("phase 20.15 M7 — argv construction is auditable", () => {
  test("the operation slot is never caller-controlled", async () => {
    const { port, calls } = recorder();
    await port.createContainer(spec());
    const argv = calls[0]!;

    expect(argv[0]).toBe("docker");
    expect(argv[1]).toBe("create");
    expect(argv.at(-1)).toBe(FLOCI_PINNED_IMAGE);
    // An image must be the last positional argument: anywhere earlier and a crafted value could
    // land in a flag position.
    expect(argv.slice(2, -1)).not.toContain(FLOCI_PINNED_IMAGE);
    expect(argv).not.toContain("sh");
    // Asserted against argv slots rather than the joined string: a substring scan flagged
    // "--pids-limit" as containing "--pid", which is the false-positive shape that would
    // eventually get this assertion deleted instead of fixed.
    const forbiddenSlots = ["--privileged", "--pid", "--pid=host", "--ipc", "--uts", "--device", "--security-opt"];
    for (const flag of forbiddenSlots) {
      expect(argv).not.toContain(flag);
      expect(argv.some((a) => a.startsWith(`${flag}=`))).toBe(false);
    }
  });

  test("published ports are bound to loopback, and labels carry the sandbox id", async () => {
    const { port, calls } = recorder();
    await port.createContainer(spec());
    const argv = calls[0]!;
    expect(argv).toContain("--publish");
    expect(argv[argv.indexOf("--publish") + 1]).toBe("127.0.0.1:4570:4570/tcp");
    expect(argv.some((a) => a === `${SANDBOX_LABELS.sandbox}=sbx_01`)).toBe(true);
    expect(argv).toContain("--memory");
    expect(argv).toContain("--pids-limit");
  });

  test("a Windows bind survives parsing instead of mounting drive letter C", async () => {
    const { port, calls } = recorder();
    await port.createContainer(spec({ binds: ["C:\\workspace:/workspace"] }));
    const mount = calls[0]!.find((a) => a.startsWith("--mount")) ?? "";
    const value = calls[0]![calls[0]!.indexOf("--mount") + 1];
    expect(mount).toBe("--mount");
    expect(value).toBe("type=bind,source=C:\\workspace,target=/workspace");
  });

  test("a 64-hex id is returned, anything else is refused", async () => {
    const ok = recorder({ stdout: `${"b".repeat(64)}\n` });
    expect(await ok.port.createContainer(spec())).toBe("b".repeat(64));

    const bad = recorder({ stdout: "usage: docker create [OPTIONS] IMAGE\n" });
    await expect(bad.port.createContainer(spec())).rejects.toMatchObject({ code: "SANDBOX_START_FAILED" });
  });
});

describe("phase 20.15 M7 — inspect and leak listing", () => {
  test("inspect maps the CLI record into ContainerInfo", async () => {
    const id = "c".repeat(64);
    const { port } = recorder({
      stdout: JSON.stringify({
        Id: id,
        Name: "/pao-sbx_01",
        Config: { Image: FLOCI_PINNED_IMAGE, Labels: { "pao.sandbox.id": "sbx_01" } },
        State: { Status: "running" },
        Created: "2026-09-23T00:00:00Z",
      }),
    });
    const info = await port.inspectContainer(id);
    expect(info).toMatchObject({ id, name: "pao-sbx_01", state: "running", createdAt: "2026-09-23T00:00:00Z" });
    expect(info.labels["pao.sandbox.id"]).toBe("sbx_01");
  });

  test("listByLabel parses one JSON object per line", async () => {
    const { port, calls } = recorder({
      stdout: [
        JSON.stringify({ ID: "d".repeat(64), Image: "lambda", Names: "lam", Status: "Up 2 seconds", Labels: "pao.sandbox.id=sbx_01,stage=worker" }),
        "",
      ].join("\n"),
    });
    const rows = await port.listByLabel(`${SANDBOX_LABELS.sandbox}=sbx_01`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "running", name: "lam" });
    expect(rows[0]!.labels.stage).toBe("worker");
    expect(calls[0]).toContain("label=pao.sandbox.id=sbx_01");
    // --all is required: an exited orphan is exactly what leak detection is for.
    expect(calls[0]).toContain("--all");
  });
});
