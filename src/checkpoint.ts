import type { TicketProperty } from "./tickets.ts";

export interface CheckpointData {
  /** Next chunk index to process (0-based). All chunks before this are complete. */
  nextChunk: number;
  /** Byte positions of output files at the end of the last completed chunk. */
  filePositions: {
    ticketsCsv: number;
    messagesCsv: number;
    dumpJsonl: number;
  };
  /** Cumulative stats up to (but not including) nextChunk. */
  stats: {
    processed: number;
    totalEmails: number;
    totalConversations: number;
    errors: number;
  };
}

/** Save checkpoint atomically (write tmp + rename). */
export async function saveCheckpoint(
  outputDir: string,
  data: CheckpointData,
): Promise<void> {
  const path = `${outputDir}/checkpoint.json`;
  const tmp = `${path}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(data, null, 2));
  await Deno.rename(tmp, path);
}

/** Load checkpoint, or return null if none exists. */
export async function loadCheckpoint(
  outputDir: string,
): Promise<CheckpointData | null> {
  try {
    const text = await Deno.readTextFile(`${outputDir}/checkpoint.json`);
    return JSON.parse(text) as CheckpointData;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

/** Remove checkpoint file (called on successful completion). */
export async function clearCheckpoint(outputDir: string): Promise<void> {
  try {
    await Deno.remove(`${outputDir}/checkpoint.json`);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}

/** Cache ticket IDs to disk so we never re-fetch 388k IDs on resume. */
export async function saveTicketIds(
  outputDir: string,
  ids: string[],
): Promise<void> {
  await Deno.writeTextFile(
    `${outputDir}/ticket_ids.json`,
    JSON.stringify(ids),
  );
}

/** Load cached ticket IDs, or return null if not cached. */
export async function loadTicketIds(
  outputDir: string,
): Promise<string[] | null> {
  try {
    const text = await Deno.readTextFile(`${outputDir}/ticket_ids.json`);
    return JSON.parse(text) as string[];
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

/** Cache property definitions to disk. */
export async function saveProperties(
  outputDir: string,
  properties: TicketProperty[],
): Promise<void> {
  await Deno.writeTextFile(
    `${outputDir}/properties.json`,
    JSON.stringify(properties),
  );
}

/** Load cached property definitions, or return null if not cached. */
export async function loadProperties(
  outputDir: string,
): Promise<TicketProperty[] | null> {
  try {
    const text = await Deno.readTextFile(`${outputDir}/properties.json`);
    return JSON.parse(text) as TicketProperty[];
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}
