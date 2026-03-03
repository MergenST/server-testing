import { NextRequest } from "next/server";

const MIN_PAYLOAD_BYTES = 1024;
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_PAYLOAD_BYTES = 512 * 1024;

function clampPayloadBytes(rawSize: string | null): number {
  if (!rawSize) return DEFAULT_PAYLOAD_BYTES;

  const parsed = Number(rawSize);
  if (!Number.isFinite(parsed)) return DEFAULT_PAYLOAD_BYTES;

  const rounded = Math.floor(parsed);
  return Math.min(MAX_PAYLOAD_BYTES, Math.max(MIN_PAYLOAD_BYTES, rounded));
}

export async function GET(request: NextRequest) {
  const rawSizeBytes = new URL(request.url).searchParams.get("sizeBytes");
  const sizeBytes = clampPayloadBytes(rawSizeBytes);

  const payload = "x".repeat(sizeBytes);

  return new Response(payload, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store, no-cache",
      "x-payload-bytes": String(sizeBytes),
    },
  });
}
