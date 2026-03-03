import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "self-bench",
    route: "/api/bench/health",
    timestamp: Date.now(),
  });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "text/plain";
  let body: unknown = null;

  if (contentType.includes("application/json")) {
    body = await request.json().catch(() => null);
  } else {
    body = await request.text().catch(() => null);
  }

  return NextResponse.json({
    ok: true,
    service: "self-bench",
    route: "/api/bench/health",
    receivedType: typeof body,
    timestamp: Date.now(),
  });
}
