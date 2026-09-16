/**
 * Phase 20.55 — exclusive device leases so two tasks cannot drive one device.
 */

import { openAgentOsDb } from "../db";

export interface DeviceLease {
  readonly id: string;
  readonly deviceId: string;
  readonly taskId: string;
  readonly owner: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
}

function now(): number {
  return Date.now();
}

export class DeviceLockService {
  acquire(deviceId: string, taskId: string, owner = "mobile-runtime", ttlMs = 10 * 60_000): DeviceLease {
    this.expireStale();
    const db = openAgentOsDb();
    const existing = db.query("SELECT id, device_id, task_id, owner, acquired_at, expires_at FROM mobile_device_leases WHERE device_id = ? AND released_at IS NULL").get(deviceId) as
      | { id: string; device_id: string; task_id: string; owner: string; acquired_at: number; expires_at: number }
      | undefined;
    if (existing && existing.expires_at > now() && existing.task_id !== taskId) {
      throw new Error(`DEVICE_BUSY: device ${deviceId} is leased to ${existing.task_id}`);
    }
    const lease: DeviceLease = {
      id: `lease_${now()}_${Math.random().toString(36).slice(2, 7)}`,
      deviceId,
      taskId,
      owner,
      acquiredAt: now(),
      expiresAt: now() + ttlMs,
    };
    db.query(`INSERT INTO mobile_device_leases (id, device_id, task_id, owner, acquired_at, expires_at, released_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)`).run(lease.id, deviceId, taskId, owner, lease.acquiredAt, lease.expiresAt);
    return lease;
  }

  release(deviceId: string, taskId: string): void {
    openAgentOsDb()
      .query("UPDATE mobile_device_leases SET released_at = ? WHERE device_id = ? AND task_id = ? AND released_at IS NULL")
      .run(now(), deviceId, taskId);
  }

  current(deviceId: string): DeviceLease | null {
    this.expireStale();
    const row = openAgentOsDb()
      .query("SELECT id, device_id, task_id, owner, acquired_at, expires_at FROM mobile_device_leases WHERE device_id = ? AND released_at IS NULL")
      .get(deviceId) as { id: string; device_id: string; task_id: string; owner: string; acquired_at: number; expires_at: number } | undefined;
    if (!row) return null;
    return { id: row.id, deviceId: row.device_id, taskId: row.task_id, owner: row.owner, acquiredAt: row.acquired_at, expiresAt: row.expires_at };
  }

  private expireStale(): void {
    openAgentOsDb()
      .query("UPDATE mobile_device_leases SET released_at = ? WHERE released_at IS NULL AND expires_at <= ?")
      .run(now(), now());
  }
}

let lockSingleton: DeviceLockService | null = null;
export function getDeviceLockService(): DeviceLockService {
  if (!lockSingleton) lockSingleton = new DeviceLockService();
  return lockSingleton;
}

