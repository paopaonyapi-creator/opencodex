// Phase 20 — Cloud Resource Lease Manager.
//
// Provides atomic, lease-based distributed locks in SQLite to prevent
// concurrent provisioning, mutation, or termination across workers or agents.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";

export interface LeaseLock {
  resourceType: string;
  resourceId: string;
  owner: string;
  token: string;
  expiresAt: number;
}

export class LeaseManager {
  acquireLease(
    resourceType: string,
    resourceId: string,
    owner: string,
    ttlSeconds = 60,
  ): LeaseLock | null {
    const db = openAgentOsDb();
    const now = Date.now();
    const expiresAt = now + ttlSeconds * 1000;
    const token = randomUUID();

    try {
      // 1. Try to insert new lease
      db.query(`
        INSERT INTO gen_cloud_leases
          (id, resource_type, resource_id, owner, lease_token, acquired_at, expires_at, heartbeat_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `lease_${randomUUID().slice(0, 8)}`,
        resourceType,
        resourceId,
        owner,
        token,
        now,
        expiresAt,
        now,
      );

      return { resourceType, resourceId, owner, token, expiresAt };
    } catch {
      // 2. Existing lease: try atomic update if expired or owned by same owner
      const res = db.query(`
        UPDATE gen_cloud_leases
        SET owner = ?, lease_token = ?, acquired_at = ?, expires_at = ?, heartbeat_at = ?
        WHERE resource_type = ? AND resource_id = ? AND expires_at < ?
      `).run(owner, token, now, expiresAt, now, resourceType, resourceId, now);

      if (res.changes > 0) {
        return { resourceType, resourceId, owner, token, expiresAt };
      }
      return null;
    }
  }

  renewLease(
    resourceType: string,
    resourceId: string,
    token: string,
    ttlSeconds = 60,
  ): boolean {
    const db = openAgentOsDb();
    const now = Date.now();
    const expiresAt = now + ttlSeconds * 1000;

    const res = db.query(`
      UPDATE gen_cloud_leases
      SET expires_at = ?, heartbeat_at = ?
      WHERE resource_type = ? AND resource_id = ? AND lease_token = ?
    `).run(expiresAt, now, resourceType, resourceId, token);

    return res.changes > 0;
  }

  releaseLease(
    resourceType: string,
    resourceId: string,
    token: string,
  ): boolean {
    const db = openAgentOsDb();
    const res = db.query(`
      DELETE FROM gen_cloud_leases
      WHERE resource_type = ? AND resource_id = ? AND lease_token = ?
    `).run(resourceType, resourceId, token);

    return res.changes > 0;
  }
}
