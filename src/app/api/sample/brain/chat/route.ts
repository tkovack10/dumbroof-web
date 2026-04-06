import { NextRequest } from "next/server";
import { SAMPLE_RICHARD_CONTEXT } from "@/lib/sample-claim-data";

/**
 * POST /api/sample/brain/chat
 *
 * Public, rate-limited streaming chat endpoint for the demo Richard in
 * /sample/dashboard. Pipes directly to Claude Sonnet 4.6 (raw fetch, no
 * SDK) with a pre-loaded sample claim context. Streams SSE.
 *
 * Rate limit: 5 messages per IP per hour, tracked in-memory. This cap
 * holds up to ~100 concurrent demo users per function instance without
 * worrying about abuse. For higher scale, swap to Supabase-backed counts.
 *
 * Unlike the real claim-brain chat (which lives on the Railway FastAPI
 * backend and uses Supabase-scoped auth + streaming tools), this one is
 * Claude-only — no tool use, no file generation, no email sending. The
 * demo is read-only. The system prompt reminds Richard of that.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// In-memory rate limit store. { ip → [timestamps] }
// Resets on function cold start — fine for a demo endpoint.
const rateLimitStore = new Map<string, number[]>();

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetAtMs: number } {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (rateLimitStore.get(ip) || []).filter((t) => t >= windowStart);

  if (timestamps.length >= RATE_LIMIT_MAX) {
    const oldest = Math.min(...timestamps);
    return {
      allowed: false,
      remaining: 0,
      resetAtMs: oldest + RATE_LIMIT_WINDOW_MS,
    };
  }

  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX - timestamps.length,
    resetAtMs: now + RATE_LIMIT_WINDOW_MS,
  };
}

type Message = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Richard is temporarily unavailable (no API key)" }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
  }

  // Rate limit
  const ip = getClientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    const resetMinutes = Math.ceil((limit.resetAtMs - Date.now()) / 60000);
    return new Response(
      JSON.stringify({
        error: `Demo chat limit reached (${RATE_LIMIT_MAX} messages per hour). Try again in ${resetMinutes} minutes, or sign up to unlock unlimited access.`,
      }),
      { status: 429, headers: { "content-type": "application/json" } }
    );
  }

  // Parse incoming messages
  let messages: Message[];
  try {
    const body = await req.json();
    messages = Array.isArray(body.messages) ? body.messages : [];
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return new Response(JSON.stringify({ error: "messages[] must end with a user message" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Cap conversation history to the last 10 exchanges to keep tokens bounded
  const trimmedMessages = messages.slice(-20);

  // Call Claude with streaming
  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        stream: true,
        system: SAMPLE_RICHARD_CONTEXT,
        messages: trimmedMessages,
      }),
    });
  } catch (err) {
    console.error("[sample brain] Anthropic fetch threw", err);
    return new Response(
      JSON.stringify({ error: "Couldn't reach Richard right now. Try again in a moment." }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const body = await upstream.text().catch(() => "");
    console.error("[sample brain] Anthropic error", upstream.status, body.slice(0, 300));
    return new Response(
      JSON.stringify({ error: `Richard had an error (status ${upstream.status})` }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  // Transform Anthropic's SSE stream → a simpler text-delta SSE stream
  // that the client component can consume without Anthropic SDK.
  // Client receives lines like: `data: {"delta":"hello"}\n\n`
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";
          for (const event of events) {
            const lines = event.split("\n");
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6);
              if (payload === "[DONE]") continue;
              try {
                const data = JSON.parse(payload);
                if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
                  const text = data.delta.text as string;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: text })}\n\n`));
                } else if (data.type === "message_stop") {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
                }
              } catch {
                // malformed JSON from upstream — skip this event
              }
            }
          }
        }
      } catch (err) {
        console.error("[sample brain] stream read error", err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: "stream interrupted" })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-RateLimit-Remaining": String(limit.remaining),
      "X-RateLimit-Reset": String(limit.resetAtMs),
    },
  });
}
