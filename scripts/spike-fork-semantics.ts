// THROWAWAY SPIKE — NOT PRODUCT CODE. Do not import from backend/ or frontend/.
// Slice 6 (O5) of the SDK-migration plan: determine empirically whether the SDK's
// `runtime.fork()` writes the SAME JSONL file (in-place branch) or a NEW one.
//
// `AgentSessionRuntime.fork()` (dist/core/agent-session-runtime.js) delegates its
// on-disk file behaviour, for a persisted session, to exactly this call chain:
//
//     const sm = SessionManager.open(currentSessionFile, sessionDir);
//     const forkedSessionPath = sm.createBranchedSession(targetLeafId);
//     await this.teardownCurrent("fork", sm.getSessionFile());
//     this.apply(await this.createRuntime({ ... sessionManager: sm ... }));
//
// i.e. the new file is produced by `SessionManager.createBranchedSession()` and the
// runtime's `session` is then REPLACED with a fresh AgentSession pointing at that
// new manager. This script exercises that exact SessionManager call chain headlessly
// (no LLM / provider needed — fork's file semantics live entirely in SessionManager),
// so the observation is deterministic and reproducible.
//
// Run:  npx tsx scripts/spike-fork-semantics.ts

import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

function jsonlFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
}

const cwd = process.cwd();
const sessionDir = mkdtempSync(join(tmpdir(), "spike-fork-"));
console.log("sessionDir:", sessionDir);

// 1. Create a persisted session in the temp sessionDir and add a turn.
const sm = SessionManager.create(cwd, sessionDir);
const userId = sm.appendMessage({
  role: "user",
  content: [{ type: "text", text: "hello, fork me here" }],
  timestamp: Date.now(),
});
// An assistant message forces the file to flush to disk (matches newSession contract).
const assistantId = sm.appendMessage({
  role: "assistant",
  content: [{ type: "text", text: "sure, this is the assistant reply" }],
  api: "messages" as any,
  provider: "anthropic" as any,
  model: "spike",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } as any,
  stopReason: "stop",
  timestamp: Date.now(),
});

const originalFile = sm.getSessionFile()!;
console.log("originalFile:", originalFile);
console.log("userMessageEntryId:", userId);
console.log("jsonl files after 1 turn:", jsonlFiles(sessionDir));
const originalBytesBefore = readFileSync(originalFile, "utf8");

// 2. Replicate runtime.fork()'s persisted branch EXACTLY: re-open the file into a
//    fresh SessionManager, then createBranchedSession(targetLeafId). For fork with
//    position:"before" the targetLeafId is the PARENT of the selected user message;
//    for position:"at" it is the entry id itself. We branch at the user entry (the
//    realistic "fork from this user message" case).
const smForFork = SessionManager.open(originalFile, sessionDir);
const forkedFile = smForFork.createBranchedSession(userId);
console.log("createBranchedSession() returned:", forkedFile);
console.log("smForFork.getSessionFile() after branch:", smForFork.getSessionFile());

// 3. Observations.
const filesAfter = jsonlFiles(sessionDir);
const originalBytesAfter = readFileSync(originalFile, "utf8");
console.log("jsonl files after fork:", filesAfter);
console.log("--- OBSERVATIONS ---");
console.log("SAME_FILE (returned === original)?:", forkedFile === originalFile);
console.log("NEW_FILE created on disk?:", !!forkedFile && forkedFile !== originalFile && existsSync(forkedFile));
console.log("original file still exists?:", existsSync(originalFile));
console.log("original file byte-unchanged?:", originalBytesBefore === originalBytesAfter);
console.log("file count 1 -> N:", filesAfter.length);
console.log(
  "new manager now points at NEW file?:",
  smForFork.getSessionFile() === forkedFile && forkedFile !== originalFile,
);

const verdict = forkedFile && forkedFile !== originalFile ? "NEW-FILE" : "SAME-FILE";
console.log("\nVERDICT:", verdict);

// 4. Second case: branch at the ASSISTANT entry so the branched path contains an
//    assistant message. This shows the new file DOES materialize on disk immediately
//    (the user-entry branch above defers the write per the newSession contract).
const smForFork2 = SessionManager.open(originalFile, sessionDir);
const forkedFile2 = smForFork2.createBranchedSession(assistantId);
console.log("\n--- CASE 2: branch at assistant entry ---");
console.log("createBranchedSession(assistantId) returned:", forkedFile2);
console.log("NEW_FILE materialized on disk?:", !!forkedFile2 && existsSync(forkedFile2));
console.log("distinct from original?:", forkedFile2 !== originalFile && forkedFile2 !== forkedFile);
console.log("jsonl file count now:", jsonlFiles(sessionDir).length);
console.log("original still byte-unchanged?:", readFileSync(originalFile, "utf8") === originalBytesBefore);
