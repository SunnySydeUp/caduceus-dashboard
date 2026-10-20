// What happens to the files the owner picks, drops or pastes (M1 #10): an archive is unpacked and its files take its place in the list, then
// everything is admitted against the limits. Free of the DOM and of React.
import { isArchive, unpackArchive } from './archive.ts';
import { admit, MAX_ATTACHMENTS, type Attachment, type Candidate, type Problem } from './attachments.ts';

/** Adds what was picked to the attachments, in the order it was picked. What was left out, and why, is in `problems`. */
export async function attachFiles(current: readonly Attachment[], picked: readonly Candidate[]): Promise<{ attachments: Attachment[]; problems: Problem[] }> {
  const candidates: Candidate[] = [];
  const problems: Problem[] = [];
  for (const candidate of picked) {
    if (!isArchive(candidate.name)) {
      candidates.push(candidate);
      continue;
    }
    // Only as many files as will fit are unpacked: the rest are named, not read.
    const unpacked = await unpackArchive(candidate, Math.max(0, MAX_ATTACHMENTS - current.length - candidates.length));
    candidates.push(...unpacked.entries);
    problems.push(...unpacked.problems);
  }
  const admitted = admit(current, candidates);
  return { attachments: admitted.attachments, problems: [...problems, ...admitted.problems] };
}
