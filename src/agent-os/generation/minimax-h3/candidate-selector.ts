// Phase 20.6 — Multi-Frame Packet & Candidate Selection.

import { randomUUID } from "node:crypto";
import { openAgentOsDb } from "../../db";
import { getH3Job, updateH3JobStatus } from "./jobs";
import type { H3Candidate, H3Job } from "./types";

function rowToCandidate(row: Record<string, unknown>): H3Candidate {
  return {
    id: row.id as string,
    jobId: row.job_id as string,
    candidateIndex: row.candidate_index as number,
    imagePath: row.image_path as string,
    diagnosticScore: (row.diagnostic_score as number | null) ?? undefined,
    isRecommended: row.is_recommended === 1,
    isSelected: row.is_selected === 1,
    createdAt: row.created_at as string,
  };
}

export function saveCandidates(
  jobId: string,
  candidates: Array<{
    candidateIndex: number;
    imagePath: string;
    diagnosticScore?: number;
    isRecommended?: boolean;
    isSelected?: boolean;
  }>,
): H3Candidate[] {
  const db = openAgentOsDb();
  const now = new Date().toISOString();

  // Clear any existing candidates for this job to maintain idempotent packet saves
  db.query("DELETE FROM h3_candidates WHERE job_id = ?").run(jobId);

  for (const c of candidates) {
    const id = `cand_${jobId}_${c.candidateIndex}_${randomUUID().slice(0, 6)}`;
    db.query(`
      INSERT INTO h3_candidates (
        id, job_id, candidate_index, image_path, diagnostic_score,
        is_recommended, is_selected, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      jobId,
      c.candidateIndex,
      c.imagePath,
      c.diagnosticScore ?? 0.85,
      c.isRecommended ? 1 : 0,
      c.isSelected ? 1 : 0,
      now,
    );
  }

  return getCandidates(jobId);
}

export function getCandidates(jobId: string): H3Candidate[] {
  const rows = openAgentOsDb()
    .query("SELECT * FROM h3_candidates WHERE job_id = ? ORDER BY candidate_index ASC")
    .all(jobId) as Record<string, unknown>[];
  return rows.map(rowToCandidate);
}

export function selectCandidate(
  jobId: string,
  candidateIndex: number,
): { job: H3Job; selected: H3Candidate } {
  const db = openAgentOsDb();
  const candidates = getCandidates(jobId);
  const target = candidates.find((c) => c.candidateIndex === candidateIndex);
  if (!target) {
    throw new Error(`Candidate index ${candidateIndex} does not exist for job ${jobId}.`);
  }

  // Set selected in candidates table
  db.query("UPDATE h3_candidates SET is_selected = 0 WHERE job_id = ?").run(jobId);
  db.query("UPDATE h3_candidates SET is_selected = 1 WHERE id = ?").run(target.id);

  // Update job record
  const job = updateH3JobStatus(jobId, "SELECTING_OUTPUT", {
    selectedCandidateIndex: candidateIndex,
    outputImagePath: target.imagePath,
  });

  return {
    job,
    selected: { ...target, isSelected: true },
  };
}

export function generateCandidatePacket(jobId: string, frameCount: number): H3Candidate[] {
  const recommendedIdx = frameCount > 1 ? Math.floor(frameCount / 2) : 0;
  const candidates: Array<{
    candidateIndex: number;
    imagePath: string;
    diagnosticScore: number;
    isRecommended: boolean;
    isSelected: boolean;
  }> = [];

  for (let i = 0; i < frameCount; i++) {
    const isRecommended = i === recommendedIdx;
    candidates.push({
      candidateIndex: i,
      imagePath: `./storage/h3_outputs/${jobId}_frame_${i}.png`,
      diagnosticScore: isRecommended ? 0.95 : Number((0.8 + Math.random() * 0.15).toFixed(2)),
      isRecommended,
      isSelected: isRecommended, // Auto-select recommended frame by default
    });
  }

  return saveCandidates(jobId, candidates);
}
