import { useEffect, useRef, useState, useCallback } from "react";
import type { DashboardEvent } from "../api/types";

const MAX_BUFFER = 200;
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;

export type SSEStatus = "connecting" | "connected" | "disconnected" | "error";

export function useSSE(url: string) {
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [status, setStatus] = useState<SSEStatus>("connecting");
  const lastIdRef = useRef<number | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const fullUrl =
      lastIdRef.current !== null
        ? `${url}?lastEventId=${lastIdRef.current}`
        : url;

    const es = new EventSource(fullUrl);
    esRef.current = es;
    setStatus("connecting");

    es.onopen = () => {
      setStatus("connected");
      retryCountRef.current = 0;
    };

    es.onmessage = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data as string) as DashboardEvent;
        lastIdRef.current = event.id;
        setEvents((prev) => {
          const next = [...prev, event];
          return next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next;
        });
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setStatus("disconnected");

      const delay = Math.min(
        BASE_DELAY * Math.pow(2, retryCountRef.current),
        MAX_DELAY
      );
      retryCountRef.current += 1;

      retryTimerRef.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, [connect]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, status, clearEvents };
}
