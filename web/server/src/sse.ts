import { EventEmitter } from "node:events";
import type { Response } from "express";

type AgentState = "pending" | "running" | "complete" | "error";

export interface AgentProgressEvent {
  type: "agent";
  prNumber: number;
  agent: "summary" | "security" | "documentation";
  state: AgentState;
  message?: string;
}

export interface ReviewLifecycleEvent {
  type: "review";
  prNumber: number;
  state: "started" | "merged" | "written" | "posted" | "complete" | "error";
  message?: string;
  docPath?: string;
  commentUrl?: string | null;
  recommendation?: string;
  riskLevel?: string;
}

export type BusEvent = AgentProgressEvent | ReviewLifecycleEvent;

class ReviewBus extends EventEmitter {
  emitEvent(event: BusEvent): void {
    this.emit("event", event);
  }
}

export const reviewBus = new ReviewBus();
reviewBus.setMaxListeners(50);

/** Attach a client to the SSE stream. Sends a heartbeat every 25s. */
export function attachSseClient(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const listener = (event: BusEvent): void => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  reviewBus.on("event", listener);
  const heartbeat = setInterval(() => res.write(":hb\n\n"), 25000);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    reviewBus.off("event", listener);
  };

  res.on("close", cleanup);
  res.on("error", cleanup);
}
