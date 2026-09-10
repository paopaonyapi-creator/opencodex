import { describe, expect, test } from 'bun:test';
import { FileGrantBroker, mimeForPath } from '../src/agent-os/browser-provider/universal/file-grants';

/**
 * Phase 20.19 — one-time file grant broker.
 *
 * The property under test is that an adapter can never name a file the job did not
 * approve. Every test here tries to spend a grant outside its intended frame: another
 * job, after expiry, or more times than allowed.
 */

const MIB = 1024 * 1024;

describe('Phase 20.19 — file grant broker', () => {
  test('a granted file resolves for the job that owns it', () => {
    const broker = new FileGrantBroker();
    const minted = broker.mint({ jobId: 'JOB-1', path: '/tmp/ref.png', bytes: 1024 });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    const redeemed = broker.redeem(minted.grant.grantId, 'JOB-1');
    expect(redeemed.ok).toBe(true);
    if (redeemed.ok) expect(redeemed.path).toBe('/tmp/ref.png');
  });

  test('the public grant never exposes the real path', () => {
    // This is the whole point: an adapter learns a name and a size, never a location.
    const broker = new FileGrantBroker();
    const minted = broker.mint({ jobId: 'JOB-1', path: '/secret/place/ref.png', bytes: 1024 });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(JSON.stringify(minted.grant)).not.toContain('/secret/place');
    expect(minted.grant.name).toBe('ref.png');
  });

  test('a grant cannot be spent by a different job', () => {
    const broker = new FileGrantBroker();
    const minted = broker.mint({ jobId: 'JOB-1', path: '/tmp/ref.png', bytes: 1024 });
    if (!minted.ok) return;
    const stolen = broker.redeem(minted.grant.grantId, 'JOB-2');
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.reason).toContain('different job');
  });

  test('a cross-job attempt does not break the owning job', () => {
    // Refusing must not consume the grant, or one bad caller would deny the good one.
    const broker = new FileGrantBroker();
    const minted = broker.mint({ jobId: 'JOB-1', path: '/tmp/ref.png', bytes: 1024 });
    if (!minted.ok) return;
    broker.redeem(minted.grant.grantId, 'JOB-2');
    expect(broker.redeem(minted.grant.grantId, 'JOB-1').ok).toBe(true);
  });

  test('a spent grant is deleted rather than left reusable', () => {
    const broker = new FileGrantBroker({ maxReads: 1 });
    const minted = broker.mint({ jobId: 'JOB-1', path: '/tmp/ref.png', bytes: 1024 });
    if (!minted.ok) return;
    expect(broker.redeem(minted.grant.grantId, 'JOB-1').ok).toBe(true);
    expect(broker.redeem(minted.grant.grantId, 'JOB-1').ok).toBe(false);
  });

  test('reads are bounded even when the grant survives', () => {
    const broker = new FileGrantBroker({ maxReads: 2 });
    const minted = broker.mint({ jobId: 'JOB-1', path: '/tmp/ref.png', bytes: 1024 });
    if (!minted.ok) return;
    expect(broker.redeem(minted.grant.grantId, 'JOB-1').ok).toBe(true);
    expect(broker.redeem(minted.grant.grantId, 'JOB-1').ok).toBe(true);
    expect(broker.redeem(minted.grant.grantId, 'JOB-1').ok).toBe(false);
  });

  test('an expired grant is refused', () => {
    let clock = 1_000_000;
    const broker = new FileGrantBroker({ ttlMs: 1000, now: () => clock });
    const minted = broker.mint({ jobId: 'JOB-1', path: '/tmp/ref.png', bytes: 1024 });
    if (!minted.ok) return;
    clock += 2000;
    const redeemed = broker.redeem(minted.grant.grantId, 'JOB-1');
    expect(redeemed.ok).toBe(false);
    if (!redeemed.ok) expect(redeemed.reason).toContain('expired');
  });

  test('an oversized file is refused before a grant exists', () => {
    const broker = new FileGrantBroker({ maxBytes: 10 * MIB });
    expect(broker.mint({ jobId: 'JOB-1', path: '/tmp/big.mp4', bytes: 50 * MIB }).ok).toBe(false);
  });

  test('a declared type that contradicts the extension is refused', () => {
    // A caller confused about what it is uploading is not a caller to guess for.
    const broker = new FileGrantBroker();
    const minted = broker.mint({ jobId: 'JOB-1', path: '/tmp/ref.png', bytes: 1024, declaredMimeType: 'video/mp4' });
    expect(minted.ok).toBe(false);
    if (!minted.ok) expect(minted.reason).toContain('does not match');
  });

  test('a matching declared type is accepted', () => {
    const broker = new FileGrantBroker();
    expect(broker.mint({ jobId: 'JOB-1', path: '/tmp/ref.png', bytes: 1024, declaredMimeType: 'image/png' }).ok).toBe(true);
  });

  test('mime is derived from the extension, not trusted from the caller', () => {
    expect(mimeForPath('/a/b/c.png')).toBe('image/png');
    expect(mimeForPath('/a/b/c.JPEG')).toBe('image/jpeg');
    expect(mimeForPath('/a/b/c.unknown')).toBe('application/octet-stream');
  });

  test('a grant without a job or a file is refused', () => {
    const broker = new FileGrantBroker();
    expect(broker.mint({ jobId: '', path: '/tmp/ref.png', bytes: 1 }).ok).toBe(false);
    expect(broker.mint({ jobId: 'JOB-1', path: '', bytes: 1 }).ok).toBe(false);
  });

  test('inspection does not consume a read', () => {
    // Dry run must be able to describe the plan without spending it.
    const broker = new FileGrantBroker({ maxReads: 1 });
    const minted = broker.mint({ jobId: 'JOB-1', path: '/tmp/ref.png', bytes: 1024 });
    if (!minted.ok) return;
    expect(broker.inspect(minted.grant.grantId)).not.toBeNull();
    expect(broker.redeem(minted.grant.grantId, 'JOB-1').ok).toBe(true);
  });

  test('grants are listable per job and revocable', () => {
    const broker = new FileGrantBroker();
    broker.mint({ jobId: 'JOB-1', path: '/tmp/a.png', bytes: 1 });
    broker.mint({ jobId: 'JOB-1', path: '/tmp/b.png', bytes: 1 });
    broker.mint({ jobId: 'JOB-2', path: '/tmp/c.png', bytes: 1 });
    expect(broker.listForJob('JOB-1')).toHaveLength(2);
    expect(broker.revokeJob('JOB-1')).toBe(2);
    expect(broker.listForJob('JOB-1')).toHaveLength(0);
    expect(broker.listForJob('JOB-2')).toHaveLength(1);
  });

  test('an unknown grant id is refused rather than resolved', () => {
    const broker = new FileGrantBroker();
    expect(broker.redeem('grant_never_minted', 'JOB-1').ok).toBe(false);
  });
});
