import { useEffect, useRef, useState } from "react";
import type { AgentName } from "./api";

export type AgentUiState = "pending" | "running" | "complete" | "error";

export interface AgentEvent {
  type: "agent";
  prNumber: number;
  agent: AgentName;
  state: AgentUiState;
  message?: string;
}

export interface ReviewEvent {
  type: "review";
  prNumber: number;
  state: "started" | "merged" | "written" | "posted" | "complete" | "error";
  message?: string;
  docPath?: string;
  commentUrl?: string | null;
  recommendation?: string;
  riskLevel?: string;
}

export type StreamEvent = AgentEvent | ReviewEvent;

/** Subscribes to the server SSE stream and returns the latest per-agent state for a PR. */
export function useReviewStream(prNumber: number | null): {
  agents: Record<AgentName, AgentUiState>;
  lastReview: ReviewEvent | null;
  connected: boolean;
} {
  const [agents, setAgents] = useState<Record<AgentName, AgentUiState>>({
    summary: "pending",
    security: "pending",
    documentation: "pending"
  });
  const [lastReview, setLastReview] = useState<ReviewEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (prNumber == null) return;
    const es = new EventSource("/api/events");
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const onAgent = (e: MessageEvent): void => {
      try {
        const data = JSON.parse(e.data) as AgentEvent;
        if (data.prNumber !== prNumber) return;
        setAgents((prev) => ({ ...prev, [data.agent]: data.state }));
      } catch { /* ignore malformed frame */ }
    };
    const onReview = (e: MessageEvent): void => {
      try {
        const data = JSON.parse(e.data) as ReviewEvent;
        if (data.prNumber !== prNumber) return;
        setLastReview(data);
      } catch { /* ignore malformed frame */ }
    };
    es.addEventListener("agent", onAgent);
    es.addEventListener("review", onReview);
    return () => {
      es.removeEventListener("agent", onAgent);
      es.removeEventListener("review", onReview);
      es.close();
      esRef.current = null;
    };
  }, [prNumber]);

  return { agents, lastReview, connected };
}
