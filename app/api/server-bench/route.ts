import { NextRequest, NextResponse } from "next/server";
import { performance } from "node:perf_hooks";
import os from "node:os";

type HttpMethod = "GET" | "POST";

type SingleCallResult = {
  durationMs: number;
  bytes: number;
  ok: boolean;
  status: number;
  error?: string;
};

type LoadTimeResult = {
  status: number;
  durationMs: number;
  sizeBytes: number;
};

type BandwidthResult = {
  durationSeconds: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalBytes: number;
  averageBytesPerSecond: number;
  peakRequestThroughputBytesPerSecond: number;
  requestErrors: number;
};

type ApiCallResult = {
  requestedSamples: number;
  completedSamples: number;
  successfulSamples: number;
  failedSamples: number;
  maxDurationMs: number;
  avgDurationMs: number;
  p95DurationMs: number;
  slowestSample: SingleCallResult | null;
  sampleCount: number[];
};

type ProcessSnapshot = {
  elapsedMs: number;
  cpuUsagePercent: number;
  cpuTimeMs: number;
  memory: {
    rssMB: number;
    heapUsedMB: number;
    heapTotalMB: number;
    externalMB: number;
    arrayBuffersMB: number;
    heapDeltaMB: number;
    rssDeltaMB: number;
  };
  loadAverage: number[];
  cpus: number;
};

type BenchResponse = {
  targetPath: string;
  requestMethod: HttpMethod;
  loadTime: LoadTimeResult;
  maxBandwidth: BandwidthResult;
  apiCallRuntime: ApiCallResult;
  processPower: ProcessSnapshot;
};

const MAX_DURATION_SECONDS = 30;
const MIN_DURATION_SECONDS = 2;
const MAX_CONCURRENCY = 40;
const MIN_CONCURRENCY = 1;
const MAX_SAMPLES = 500;
const MIN_SAMPLES = 10;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.floor(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function normalizeMethod(method: string | undefined): HttpMethod {
  const normalized = (method ?? "GET").toUpperCase();
  return normalized === "POST" ? "POST" : "GET";
}

function safeBytes(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function bytesToMb(value: number): number {
  return Number((safeBytes(value) / (1024 * 1024)).toFixed(2));
}

function nonNegativeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function buildSelfTargetUrl(rawTarget: string, serverOrigin: string): string {
  const trimmed = rawTarget.trim();
  const normalizedPath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const resolved = new URL(normalizedPath, serverOrigin);

  if (resolved.origin !== new URL(serverOrigin).origin) {
    throw new Error("Target must be on the same Next.js host.");
  }

  if (!resolved.pathname.startsWith("/api/")) {
    throw new Error("Target must be an /api route in this app.");
  }

  if (resolved.pathname === "/api/server-bench") {
    throw new Error(
      "Target cannot be /api/server-bench to avoid recursive load testing.",
    );
  }

  return resolved.toString();
}

async function runSingleCall(
  targetUrl: string,
  requestMethod: HttpMethod,
  requestBody: string,
): Promise<SingleCallResult> {
  const started = performance.now();
  try {
    const init: RequestInit = {
      method: requestMethod,
      headers: {
        accept: "application/json, text/plain, */*",
      },
    };

    if (requestMethod === "POST" && requestBody) {
      init.body = requestBody;
      init.headers = {
        "content-type": "application/json",
        ...init.headers,
      };
    }

    const response = await fetch(targetUrl, init);
    const buffer = await response.arrayBuffer();
    const durationMs = performance.now() - started;

    return {
      durationMs,
      bytes: buffer.byteLength,
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    return {
      durationMs: performance.now() - started,
      bytes: 0,
      ok: false,
      status: 0,
      error:
        error instanceof Error && error.message
          ? error.message
          : "Request failed",
    };
  }
}

async function measureLoadTime(
  targetUrl: string,
  requestMethod: HttpMethod,
  requestBody: string,
): Promise<LoadTimeResult> {
  const result = await runSingleCall(targetUrl, requestMethod, requestBody);
  return {
    status: result.status,
    durationMs: result.durationMs,
    sizeBytes: result.bytes,
  };
}

async function measureMaxBandwidth(
  targetUrl: string,
  requestMethod: HttpMethod,
  requestBody: string,
  durationSeconds: number,
  concurrency: number,
): Promise<BandwidthResult> {
  const startedAt = Date.now();
  const endAt = startedAt + durationSeconds * 1000;
  let totalRequests = 0;
  let successfulRequests = 0;
  let failedRequests = 0;
  let requestErrors = 0;
  let totalBytes = 0;
  let peakRequestThroughputBytesPerSecond = 0;

  const worker = async () => {
    while (Date.now() < endAt) {
      const result = await runSingleCall(targetUrl, requestMethod, requestBody);
      totalRequests += 1;

      if (result.ok) {
        successfulRequests += 1;
      } else {
        failedRequests += 1;
      }

      if (result.error) {
        requestErrors += 1;
      }

      totalBytes += result.bytes;

      if (result.durationMs > 0) {
        const requestThroughput = result.bytes / (result.durationMs / 1000);
        if (requestThroughput > peakRequestThroughputBytesPerSecond) {
          peakRequestThroughputBytesPerSecond = requestThroughput;
        }
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const actualDurationSeconds = Math.max(0.5, (Date.now() - startedAt) / 1000);
  const averageBytesPerSecond = totalBytes / actualDurationSeconds;

  return {
    durationSeconds,
    totalRequests,
    successfulRequests,
    failedRequests,
    totalBytes,
    averageBytesPerSecond,
    peakRequestThroughputBytesPerSecond,
    requestErrors,
  };
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.floor((sorted.length - 1) * 0.95));
  return sorted[index];
}

async function measureApiCallRuntime(
  targetUrl: string,
  requestMethod: HttpMethod,
  requestBody: string,
  samples: number,
): Promise<ApiCallResult> {
  let completedSamples = 0;
  let successfulSamples = 0;
  let failedSamples = 0;
  let maxDurationMs = 0;
  let slowestSample: SingleCallResult | null = null;
  const durations: number[] = [];
  const allSamples: SingleCallResult[] = [];

  for (let i = 0; i < samples; i += 1) {
    const result = await runSingleCall(targetUrl, requestMethod, requestBody);
    completedSamples += 1;
    allSamples.push(result);

    if (!result.ok) {
      failedSamples += 1;
    } else {
      successfulSamples += 1;
    }

    if (result.durationMs > maxDurationMs) {
      maxDurationMs = result.durationMs;
      slowestSample = result;
    }
    durations.push(result.durationMs);
  }

  const avgDurationMs = durations.length
    ? durations.reduce((sum, value) => sum + value, 0) / durations.length
    : 0;

  return {
    requestedSamples: samples,
    completedSamples,
    successfulSamples,
    failedSamples,
    maxDurationMs,
    avgDurationMs,
    p95DurationMs: percentile95(durations),
    slowestSample,
    sampleCount: allSamples.map((_, idx) => idx + 1),
  };
}

function collectProcessPower(
  startedAt: number,
  startedCpu: NodeJS.CpuUsage,
  startedMemory: NodeJS.MemoryUsage,
  endedAt: number,
  endedCpu: NodeJS.CpuUsage,
  endedMemory: NodeJS.MemoryUsage,
): ProcessSnapshot {
  const elapsedMs = Math.max(1, endedAt - startedAt);
  const userCpuMs = nonNegativeNumber(endedCpu.user - startedCpu.user) / 1000;
  const systemCpuMs = nonNegativeNumber(endedCpu.system - startedCpu.system) / 1000;
  const totalCpuMs = userCpuMs + systemCpuMs;

  const cpuCores = os.cpus().length || 1;
  const cpuUsagePercent = Math.min(
    100 * cpuCores,
    Math.max(0, (totalCpuMs / (elapsedMs * cpuCores)) * 100),
  );

  return {
    elapsedMs,
    cpuUsagePercent,
    cpuTimeMs: totalCpuMs,
    memory: {
      rssMB: bytesToMb(endedMemory.rss),
      heapUsedMB: bytesToMb(endedMemory.heapUsed),
      heapTotalMB: bytesToMb(endedMemory.heapTotal),
      externalMB: bytesToMb(endedMemory.external),
      arrayBuffersMB: bytesToMb(endedMemory.arrayBuffers),
      heapDeltaMB: bytesToMb(endedMemory.heapUsed - startedMemory.heapUsed),
      rssDeltaMB: bytesToMb(endedMemory.rss - startedMemory.rss),
    },
    loadAverage: os.loadavg().map((value) => Number(value.toFixed(3))),
    cpus: cpuCores,
  };
}

export async function POST(request: NextRequest) {
  let payload: {
    targetPath?: string;
    requestMethod?: string;
    requestBody?: string;
    durationSeconds?: number;
    concurrency?: number;
    apiCallSamples?: number;
  };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload. Send Content-Type: application/json." },
      { status: 400 },
    );
  }

  if (!payload.targetPath || typeof payload.targetPath !== "string") {
    return NextResponse.json(
      { error: "`targetPath` is required and must be a string." },
      { status: 400 },
    );
  }

  let targetUrl: string;
  try {
    targetUrl = buildSelfTargetUrl(payload.targetPath, request.url);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid target route. Use a local /api route like /api/bench/health.",
      },
      { status: 400 },
    );
  }

  const requestMethod = normalizeMethod(payload.requestMethod);
  const requestBody = typeof payload.requestBody === "string" ? payload.requestBody : "";
  const durationSeconds = clampInt(
    payload.durationSeconds,
    MIN_DURATION_SECONDS,
    MAX_DURATION_SECONDS,
    8,
  );
  const concurrency = clampInt(
    payload.concurrency,
    MIN_CONCURRENCY,
    MAX_CONCURRENCY,
    4,
  );
  const apiCallSamples = clampInt(
    payload.apiCallSamples,
    MIN_SAMPLES,
    MAX_SAMPLES,
    50,
  );

  const startedAt = performance.now();
  const startedCpu = process.cpuUsage();
  const startedMemory = process.memoryUsage();

  const loadTime = await measureLoadTime(
    targetUrl,
    requestMethod,
    requestBody,
  );
  const maxBandwidth = await measureMaxBandwidth(
    targetUrl,
    requestMethod,
    requestBody,
    durationSeconds,
    concurrency,
  );
  const apiCallRuntime = await measureApiCallRuntime(
    targetUrl,
    requestMethod,
    requestBody,
    apiCallSamples,
  );

  const endedAt = performance.now();
  const processPower = collectProcessPower(
    startedAt,
    startedCpu,
    startedMemory,
    endedAt,
    process.cpuUsage(startedCpu),
    process.memoryUsage(),
  );

  const parsedTarget = new URL(targetUrl);
  const response: BenchResponse = {
    targetPath: `${parsedTarget.pathname}${parsedTarget.search}`,
    requestMethod,
    loadTime,
    maxBandwidth,
    apiCallRuntime,
    processPower,
  };

  return NextResponse.json(response);
}
