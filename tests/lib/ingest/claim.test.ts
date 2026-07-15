import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The per-paper claim guard is what keeps two concurrent pipeline runs for the
 * same paper (double submit, or a manual re-ingest racing a retry) from
 * interleaving delete-chunks -> insert-chunks or clobbering each other's
 * status writes. We can't hit a real Postgres here, so createAdminClient is
 * replaced with a scripted fake that returns one queued response per `from()`
 * call and records every chain for assertions.
 *
 * Covered:
 *  - losing the claim race throws IngestAlreadyRunningError and performs NO
 *    further writes (the loser must never touch the healthy run's status)
 *  - zero claimed rows for a nonexistent paper reports "not found", not a
 *    bogus conflict
 *  - a successful claim uses the right conditional UPDATE and proceeds into
 *    the pipeline; a hard failure then writes status=failed as before
 */

type Resp = { data?: unknown; error?: { message: string } | null };
type CallRec = { chain: string[]; args: unknown[][] };

let responses: Resp[] = [];
let calls: CallRec[] = [];

function makeFakeAdmin() {
  let i = 0;
  return {
    from(table: string) {
      const rec: CallRec = { chain: ["from"], args: [[table]] };
      calls.push(rec);
      const resp = responses[i++] ?? { data: null, error: null };
      const builder: unknown = new Proxy(function () {}, {
        get(_t, prop: string) {
          if (prop === "then") {
            return (
              res: (v: unknown) => unknown,
              rej: (e: unknown) => unknown
            ) => Promise.resolve({ data: null, error: null, ...resp }).then(res, rej);
          }
          return (...args: unknown[]) => {
            rec.chain.push(prop);
            rec.args.push(args);
            return builder;
          };
        },
      });
      return builder;
    },
    storage: {
      from: () => ({
        download: async () => ({ data: null, error: { message: "storage down" } }),
      }),
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeFakeAdmin(),
}));
// parsePdf pulls in unpdf; never reached in these tests but mocked so the
// import stays cheap.
vi.mock("@/lib/ingest/parsePdf", () => ({ parsePdf: vi.fn() }));

import { ingestPaper, IngestAlreadyRunningError } from "@/lib/ingest";

beforeEach(() => {
  responses = [];
  calls = [];
});

/** The claim chain must be: update(status->parsing) . eq(id) . not(status in active) . select() */
function expectClaimShape(rec: CallRec) {
  expect(rec.chain).toEqual(["from", "update", "eq", "not", "select"]);
  expect(rec.args[1][0]).toMatchObject({ status: "parsing", error: null });
  expect(rec.args[2]).toEqual(["id", "paper-1"]);
  expect(rec.args[3]).toEqual(["status", "in", "(parsing,embedding,summarizing,retrying)"]);
}

describe("ingestPaper claim guard", () => {
  it("throws IngestAlreadyRunningError and writes nothing when the claim is lost", async () => {
    responses = [
      { data: [] }, // claim: zero rows updated
      { data: { id: "paper-1", status: "embedding" } }, // disambiguation select
    ];

    await expect(ingestPaper("paper-1")).rejects.toBeInstanceOf(IngestAlreadyRunningError);

    expectClaimShape(calls[0]);
    expect(calls[1].chain).toEqual(["from", "select", "eq", "maybeSingle"]);
    // Crucial: the loser performed exactly these two reads/conditional-writes
    // and nothing else — no status update that could clobber the healthy run.
    expect(calls).toHaveLength(2);
  });

  it("reports 'paper not found' (not a conflict) when the row does not exist", async () => {
    responses = [
      { data: [] }, // claim: zero rows
      { data: null }, // disambiguation: row missing
    ];

    await expect(ingestPaper("paper-1")).rejects.toThrow(/paper not found/);
    expect(calls).toHaveLength(2);
  });

  it("proceeds into the pipeline after a successful claim and still fails hard properly", async () => {
    responses = [
      { data: [{ id: "paper-1" }] }, // claim succeeds
      { data: { id: "paper-1", user_id: "u1", storage_path: "u1/p.pdf" } }, // paper fetch
      {}, // setStatus(parsing, 10)
      {}, // final status=failed write in the catch path
    ];

    // Storage download is scripted to fail, so the pipeline dies right after
    // the claim — far enough to prove the claim let it through.
    await expect(ingestPaper("paper-1")).rejects.toThrow(/download failed/);

    expectClaimShape(calls[0]);
    const failedWrite = calls.find(
      (c) =>
        c.chain.includes("update") &&
        c.args.some((a) => (a[0] as { status?: string })?.status === "failed")
    );
    expect(failedWrite).toBeDefined();
  });
});
