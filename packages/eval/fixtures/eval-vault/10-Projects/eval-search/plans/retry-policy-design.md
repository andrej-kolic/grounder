---
topics: ["retry", "backoff", "jobs"]
---

# Plan: retry policy for failed jobs

## Goal

Failed background jobs should retry with exponential backoff instead of
either failing permanently or hammering the queue.

## Steps

1. Add a retry count and next-attempt timestamp to the job record.
2. On failure, compute the next attempt with exponential backoff and a
   jitter, capped at a max delay.
3. After the retry limit is hit, move the job to a dead-letter queue
   instead of retrying forever.

## Decisions / open questions

- Dead-letter jobs are inspected manually for now; no auto-replay yet.

## Status

Draft
