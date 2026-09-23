import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  FORBIDDEN_BIND_PREFIXES,
  isForbiddenBind,
  parseBindSource,
  validateContainerSpec,
  type ContainerSpec,
} from "../src/agent-os/cloud-sandbox/docker-control/port";
import { NullDockerControlPort } from "../src/agent-os/cloud-sandbox/docker-control/null-port";
import { CloudSandboxError } from "../src/agent-os/cloud-sandbox/errors";

/**
 * Source spec §37 host protection, and §15's rule that the agent never reaches the Docker
 * socket. The guard is only real if it rejects the escalation cases AND still admits the
 * legitimate one, so every rejection test below is paired with an allow test — a validator
 * that refuses everything passes every rejection assertion and protects nothing.
 */
function spec(overrides: Partial<ContainerSpec> = {}): ContainerSpec {
  return {
    image: "floci/floci:1.4.2",
    name: "pao-sbx-test",
    labels: { "pao.sandbox.id": "sbx_test" },
    ...overrides,
  };
}

describe("phase 20.15 — container spec validation (source spec §37)", () => {
  test("a plain sandbox container is admitted", () => {
    const verdict = validateContainerSpec(
      spec({ binds: ["/workspace:/workspace", "/tmp:/tmp"], networkMode: "bridge", readonlyRootfs: true }),
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.rejections).toEqual([]);
  });

  test("privileged, host namespaces and device passthrough are each refused", () => {
    expect(validateContainerSpec(spec({ privileged: true })).rejections).toContain("privileged");
    expect(validateContainerSpec(spec({ networkMode: "host" })).rejections).toContain("host-network");
    expect(validateContainerSpec(spec({ pidMode: "host" })).rejections).toContain("host-pid");
    expect(validateContainerSpec(spec({ ipcMode: "host" })).rejections).toContain("host-ipc");
    expect(validateContainerSpec(spec({ devices: ["/dev/kvm"] })).rejections).toContain(
      "device-passthrough",
    );
  });

  test("every rejection accumulates rather than stopping at the first", () => {
    const verdict = validateContainerSpec(
      spec({ privileged: true, networkMode: "host", binds: ["/etc:/host-etc"] }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.rejections).toEqual(
      expect.arrayContaining(["privileged", "host-network", "forbidden-bind-mount"]),
    );
  });

  test("host paths listed in §37 are refused as bind sources", () => {
    for (const source of ["/", "/etc", "/root", "/home", "/home/user", "/var/run", "/root/.aws"]) {
      expect(isForbiddenBind(source)).toBe(true);
    }
  });

  test("the paths §14 explicitly allows are NOT refused", () => {
    // If these were caught, the guard would be unusable and someone would disable it.
    for (const source of ["/workspace", "/tmp", "./data", "/var/lib/pao/sandbox", "/data/users/svc"]) {
      expect(isForbiddenBind(source)).toBe(false);
    }
  });

  test("the running user's profile is refused on whichever platform we are on", () => {
    // §37 lists /root and ~/.ssh, which on Linux covers the profile. On Windows the profile
    // is C:\Users\<name> and matches neither spelling, so homedir() is the portable form.
    const home = homedir();
    expect(isForbiddenBind(home)).toBe(true);
    expect(isForbiddenBind(join(home, "projects", "secrets"))).toBe(true);
    expect(isForbiddenBind(parseBindSource(`${home}:/workspace`))).toBe(true);
  });

  test("a Windows profiles root is refused as the analogue of /home", () => {
    expect(isForbiddenBind("C:\\Users")).toBe(true);
    expect(isForbiddenBind("C:\\Users\\someone-else")).toBe(true);
    expect(isForbiddenBind("C:\\Users\\someone-else\\Documents")).toBe(true);
    // Anchored on a drive letter, so a POSIX path that merely contains "users" is unaffected.
    expect(isForbiddenBind("/srv/users")).toBe(false);
  });

  test("credential and SSH directories are refused, including Windows spellings", () => {
    for (const source of [
      "~/.ssh",
      "~/.ssh/id_rsa",
      "~/.aws",
      "~/.azure",
      "~/.config/gcloud",
      "~/.docker",
      "/var/run/docker.sock",
      "C:\\Users\\me\\.ssh",
      "C:\\Users\\me\\.aws\\credentials",
      "//./pipe/docker_engine",
    ]) {
      expect(isForbiddenBind(source)).toBe(true);
    }
  });

  test("a Windows drive root is refused as the equivalent of mounting /", () => {
    expect(isForbiddenBind("C:\\")).toBe(true);
    expect(isForbiddenBind("c:")).toBe(true);
  });

  test("the forbidden list is non-empty, so the loop above cannot pass vacuously", () => {
    expect(FORBIDDEN_BIND_PREFIXES.length).toBeGreaterThan(0);
  });
});

describe("phase 20.15 — bind spec parsing on Windows", () => {
  test("a drive letter is not mistaken for the source", () => {
    // `split(":")[0]` returns "C" here, which matches no forbidden prefix — the exact way a
    // home-directory mount would slip through on this platform.
    expect(parseBindSource("C:\\Users\\me:/workspace")).toBe("C:\\Users\\me");
    expect(isForbiddenBind(parseBindSource("C:\\Users\\me:/workspace"))).toBe(true);
  });

  test("POSIX specs and mode suffixes still parse", () => {
    expect(parseBindSource("/workspace:/workspace")).toBe("/workspace");
    expect(parseBindSource("/tmp:/tmp:ro")).toBe("/tmp");
    expect(parseBindSource("./data:/data")).toBe("./data");
    expect(parseBindSource("C:\\data:/data:ro")).toBe("C:\\data");
  });

  test("a Windows bind into a forbidden directory is caught end to end", () => {
    const verdict = validateContainerSpec(spec({ binds: ["C:\\Users\\me\\.ssh:/keys:ro"] }));
    expect(verdict.ok).toBe(false);
    expect(verdict.rejections).toContain("forbidden-bind-mount");
  });
});

describe("phase 20.15 — image allowlist", () => {
  test("an unlisted image is refused when an allowlist is supplied", () => {
    const allowlist = ["floci/floci:1.4.2"];
    expect(validateContainerSpec(spec(), allowlist).ok).toBe(true);
    const verdict = validateContainerSpec(spec({ image: "evil/image:1" }), allowlist);
    expect(verdict.ok).toBe(false);
    expect(verdict.rejections).toContain("image-not-allowlisted");
  });

  test("omitting the allowlist skips that one check but keeps every other", () => {
    // Answers §74 "where does the image allowlist live": a port that has no policy must not
    // silently become permissive about privilege too.
    const verdict = validateContainerSpec(spec({ image: "anything:1", privileged: true }));
    expect(verdict.rejections).not.toContain("image-not-allowlisted");
    expect(verdict.rejections).toContain("privileged");
  });
});

describe("phase 20.15 — NullDockerControlPort (docs §10 default)", () => {
  const port = new NullDockerControlPort();

  test("reports itself unreachable", async () => {
    expect(await port.isReachable()).toBe(false);
  });

  test("still validates, so a bad spec is rejected for the right reason", () => {
    expect(port.validate(spec({ privileged: true })).rejections).toContain("privileged");
    expect(port.validate(spec()).ok).toBe(true);
  });

  test("every mutation refuses with DOCKER_UNAVAILABLE, and that code is retryable", async () => {
    const attempts: Array<Promise<unknown>> = [
      port.createContainer(spec()),
      port.startContainer("c1"),
      port.inspectContainer("c1"),
      port.stopContainer("c1"),
      port.removeContainer("c1"),
    ];
    for (const attempt of attempts) {
      const caught = await attempt.then(
        () => null,
        (err: unknown) => err,
      );
      expect(caught).toBeInstanceOf(CloudSandboxError);
      const err = caught as CloudSandboxError;
      expect(err.code).toBe("DOCKER_UNAVAILABLE");
      // §59 lists a temporary container-start failure as retryable: the daemon may still be
      // coming up, which on this host means Docker Desktop has not been started by hand.
      expect(err.retryable).toBe(true);
    }
  });

  test("a rejected spec is refused before scheduling, not as a generic unavailability", async () => {
    await expect(port.createContainer(spec({ privileged: true }))).rejects.toThrow(/rejected before scheduling/);
  });

  test("listByLabel is empty rather than an error, so cleanup does not fail without Docker", async () => {
    expect(await port.listByLabel("pao.sandbox.id=sbx_x")).toEqual([]);
  });
});
