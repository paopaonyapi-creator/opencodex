// Device Registry for Phase 20.12 Pao-hubPro × Google ARTEMIS Mobile Agent Gateway

import { openAgentOsDb } from "../db";
import type { MobileDevice, RegisterDeviceInput, DeviceType, TrustLevel, DeviceStatus } from "./types";

export class MobileDeviceRegistry {
  constructor() {
    this.ensureDefaultDevice();
  }

  private ensureDefaultDevice(): void {
    const db = openAgentOsDb();
    const countRow = db.query("SELECT COUNT(*) as count FROM mobile_devices").get() as { count: number };
    if (!countRow || countRow.count === 0) {
      // Seed initial standard emulator device
      this.registerDevice({
        alias: "android-test-01",
        provider: "artemis",
        providerDeviceId: "emulator-5554",
        deviceType: "emulator",
        trustLevel: "test",
        allowAgent: true,
        allowShell: false,
        requiresApproval: false,
        labels: ["android", "test", "pixel", "emulator"],
      });
    }
  }

  public registerDevice(input: RegisterDeviceInput): MobileDevice {
    const db = openAgentOsDb();
    const now = Date.now();
    const id = `dev_${now}_${Math.random().toString(36).slice(2, 6)}`;
    const deviceType: DeviceType = input.deviceType || "emulator";
    const trustLevel: TrustLevel = input.trustLevel || "test";

    // Strict security rule from Section 20.12.3:
    // physical_personal must default to allow_agent = false, allow_shell = false, requires_approval = true
    const isPersonal = deviceType === "physical_personal";
    const allowAgent = isPersonal ? false : (input.allowAgent ?? true);
    const allowShell = isPersonal ? false : (input.allowShell ?? false);
    const requiresApproval = isPersonal ? true : (input.requiresApproval ?? false);

    const device: MobileDevice = {
      id,
      alias: input.alias,
      provider: input.provider || "artemis",
      providerDeviceId: input.providerDeviceId,
      deviceType,
      trustLevel,
      status: "ready",
      allowAgent,
      allowShell,
      requiresApproval,
      labels: input.labels || [],
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };

    db.query(`
      INSERT INTO mobile_devices (
        id, alias, provider, provider_device_id, device_type, trust_level,
        status, allow_agent, allow_shell, requires_approval, labels_json,
        last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      device.id,
      device.alias,
      device.provider,
      device.providerDeviceId,
      device.deviceType,
      device.trustLevel,
      device.status,
      device.allowAgent ? 1 : 0,
      device.allowShell ? 1 : 0,
      device.requiresApproval ? 1 : 0,
      JSON.stringify(device.labels),
      device.lastSeenAt,
      device.createdAt,
      device.updatedAt,
    );

    return device;
  }

  public getDevice(idOrAlias: string): MobileDevice | null {
    this.ensureDefaultDevice();
    const db = openAgentOsDb();
    const row = db.query(`
      SELECT * FROM mobile_devices WHERE id = ? OR alias = ? LIMIT 1
    `).get(idOrAlias, idOrAlias) as any;

    if (!row) return null;
    return this.mapRow(row);
  }

  public listDevices(): MobileDevice[] {
    this.ensureDefaultDevice();
    const db = openAgentOsDb();
    const rows = db.query("SELECT * FROM mobile_devices ORDER BY created_at ASC").all() as any[];
    return rows.map((r) => this.mapRow(r));
  }

  public updateStatus(idOrAlias: string, status: DeviceStatus): boolean {
    const db = openAgentOsDb();
    const now = Date.now();
    const res = db.query(`
      UPDATE mobile_devices
      SET status = ?, last_seen_at = ?, updated_at = ?
      WHERE id = ? OR alias = ?
    `).run(status, now, now, idOrAlias, idOrAlias);
    return res.changes > 0;
  }

  public updateHeartbeat(idOrAlias: string): boolean {
    const db = openAgentOsDb();
    const now = Date.now();
    const res = db.query(`
      UPDATE mobile_devices
      SET last_seen_at = ?, updated_at = ?
      WHERE id = ? OR alias = ?
    `).run(now, now, idOrAlias, idOrAlias);
    return res.changes > 0;
  }

  public setAgentAccess(idOrAlias: string, allowAgent: boolean): boolean {
    const db = openAgentOsDb();
    const now = Date.now();
    const res = db.query(`
      UPDATE mobile_devices
      SET allow_agent = ?, updated_at = ?
      WHERE id = ? OR alias = ?
    `).run(allowAgent ? 1 : 0, now, idOrAlias, idOrAlias);
    return res.changes > 0;
  }

  public maskSerial(serial: string): string {
    if (serial.length <= 6) return "***";
    return `${serial.slice(0, 3)}****${serial.slice(-3)}`;
  }

  private mapRow(row: any): MobileDevice {
    return {
      id: row.id,
      alias: row.alias,
      provider: row.provider,
      providerDeviceId: row.provider_device_id,
      deviceType: row.device_type,
      trustLevel: row.trust_level,
      status: row.status,
      allowAgent: row.allow_agent === 1,
      allowShell: row.allow_shell === 1,
      requiresApproval: row.requires_approval === 1,
      labels: JSON.parse(row.labels_json || "[]"),
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

let deviceRegistryInstance: MobileDeviceRegistry | null = null;
export function getMobileDeviceRegistry(): MobileDeviceRegistry {
  if (!deviceRegistryInstance) {
    deviceRegistryInstance = new MobileDeviceRegistry();
  }
  return deviceRegistryInstance;
}

export function resetMobileDeviceRegistryForTests(): void {
  deviceRegistryInstance = null;
}
