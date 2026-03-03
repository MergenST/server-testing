"use client";

import { FormEvent, useState } from "react";

type HttpMethod = "GET" | "POST";

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

type ApiCallSample = {
  durationMs: number;
  status: number;
  ok: boolean;
  bytes: number;
  error?: string;
};

type ApiCallResult = {
  requestedSamples: number;
  completedSamples: number;
  successfulSamples: number;
  failedSamples: number;
  maxDurationMs: number;
  avgDurationMs: number;
  p95DurationMs: number;
  slowestSample: ApiCallSample | null;
  sampleCount: number[];
};

type ProcessPowerResult = {
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

type BenchmarkResult = {
  targetPath: string;
  requestMethod: HttpMethod;
  loadTime: LoadTimeResult;
  maxBandwidth: BandwidthResult;
  apiCallRuntime: ApiCallResult;
  processPower: ProcessPowerResult;
};

type FormValues = {
  targetPath: string;
  requestMethod: HttpMethod;
  requestBody: string;
  payloadSizeMb: number;
  durationSeconds: number;
  concurrency: number;
  apiCallSamples: number;
};

const SELF_PRESETS = [
  {
    label: "Self API /api/bench/health",
    value: "/api/bench/health",
    hint: "Small JSON response for latency",
  },
  {
    label: "Self payload 1 MB",
    value: "/api/bench/payload?sizeBytes=1048576",
    hint: "Large payload for bandwidth",
  },
  {
    label: "Self payload 5 MB",
    value: "/api/bench/payload?sizeBytes=5242880",
    hint: "Heavier sustained bandwidth test",
  },
] as const;

function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "0 B";
  }
  if (value >= 1024 ** 3) {
    return `${(value / 1024 ** 3).toFixed(2)} GB`;
  }
  if (value >= 1024 ** 2) {
    return `${(value / 1024 ** 2).toFixed(2)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(2)} KB`;
  }
  return `${value.toFixed(0)} B`;
}

function formatBytesPerSec(value: number): string {
  return `${formatBytes(value)}/s`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function isPayloadPath(path: string): boolean {
  return path.trim().split("?")[0] === "/api/bench/payload";
}

function resolveTargetPath(targetPath: string, payloadSizeMb: number): string {
  const trimmed = targetPath.trim();
  const trimmedBase = trimmed.split("?")[0];

  if (trimmedBase !== "/api/bench/payload") {
    return trimmed || "/api/bench/health";
  }

  const resolvedPayloadSizeMb = Number.isFinite(payloadSizeMb)
    ? Math.max(1, Math.floor(payloadSizeMb))
    : 1;
  const sizeBytes = resolvedPayloadSizeMb * 1024 * 1024;
  return `${trimmedBase}?sizeBytes=${sizeBytes}`;
}

function formatPayloadHint(path: string): string {
  if (!isPayloadPath(path)) {
    return "";
  }

  const current = new URLSearchParams(path.split("?")[1] ?? "").get("sizeBytes");
  return current ? `Current size: ${formatBytes(Number(current))}` : "";
}

export default function Home() {
  const [formState, setFormState] = useState<FormValues>({
    targetPath: "/api/bench/health",
    requestMethod: "GET",
    requestBody: "",
    payloadSizeMb: 1,
    durationSeconds: 8,
    concurrency: 4,
    apiCallSamples: 50,
  });
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [rawResult, setRawResult] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");

  const setField = (name: keyof FormValues, value: string) => {
    if (name === "targetPath" || name === "requestBody" || name === "requestMethod") {
      setFormState((prev) => ({
        ...prev,
        [name]: value,
      }));
      return;
    }

    setFormState((prev) => ({
      ...prev,
      [name]: Number(value),
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsRunning(true);
    setError("");
    setResult(null);
    setRawResult("");

    try {
      const payloadPath = resolveTargetPath(formState.targetPath, formState.payloadSizeMb);

      const payload = {
        targetPath: payloadPath,
        requestMethod: formState.requestMethod,
        requestBody:
          formState.requestMethod === "POST" && formState.requestBody.trim()
            ? formState.requestBody
            : "",
        durationSeconds: formState.durationSeconds,
        concurrency: formState.concurrency,
        apiCallSamples: formState.apiCallSamples,
      };

      const response = await fetch("/api/server-bench", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Server testing request failed");
      }

      setResult(data as BenchmarkResult);
      setRawResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error occurred.");
    } finally {
      setIsRunning(false);
    }
  };

  const payloadHint = formatPayloadHint(formState.targetPath);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 bg-[radial-gradient(circle_at_top,#f6f9ff_0%,#eef2ff_40%,#f8fafc_100%)] px-6 py-10 text-slate-900 md:px-10">
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white/85 p-6 shadow-lg backdrop-blur-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-indigo-700">
          Next.js Self-Host Testbench
        </p>
        <h1 className="text-3xl font-bold text-slate-900">
          Benchmark this Next.js server only
        </h1>
        <p className="text-sm text-slate-600">
          This tool now targets routes in the same Next.js process only (no external
          hosts). Use the built-in local API routes to measure load, bandwidth,
          API runtime and process resources.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm">
        <p className="mb-3 text-sm font-medium text-slate-700">Quick local targets</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SELF_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="rounded-lg border border-slate-300 bg-slate-50 p-3 text-left text-sm hover:bg-slate-100"
              onClick={() => setField("targetPath", preset.value)}
            >
              <p className="font-semibold text-slate-900">{preset.label}</p>
              <p className="text-xs text-slate-500">{preset.hint}</p>
            </button>
          ))}
        </div>
      </section>

      <form
        className="grid gap-6 rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm md:grid-cols-2"
        onSubmit={handleSubmit}
      >
        <label className="md:col-span-2 flex flex-col gap-2 text-sm font-medium">
          Target path (Next.js local API route only)
          <input
            className="rounded-lg border border-slate-300 p-3 text-sm"
            required
            value={formState.targetPath}
            onChange={(event) => setField("targetPath", event.target.value)}
            placeholder="/api/bench/health"
          />
          {payloadHint && <p className="text-xs text-slate-500">{payloadHint}</p>}
          <p className="text-xs text-slate-500">Example: /api/bench/payload?sizeBytes=2097152</p>
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium">
          HTTP method
          <select
            value={formState.requestMethod}
            className="rounded-lg border border-slate-300 p-3"
            onChange={(event) =>
              setField("requestMethod", event.target.value as HttpMethod)
            }
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium">
          Duration for bandwidth test (2-30s)
          <input
            type="number"
            min={2}
            max={30}
            value={formState.durationSeconds}
            onChange={(event) => setField("durationSeconds", event.target.value)}
            className="rounded-lg border border-slate-300 p-3"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium">
          Concurrency (1-40)
          <input
            type="number"
            min={1}
            max={40}
            value={formState.concurrency}
            onChange={(event) => setField("concurrency", event.target.value)}
            className="rounded-lg border border-slate-300 p-3"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium">
          API sample count (10-500)
          <input
            type="number"
            min={10}
            max={500}
            value={formState.apiCallSamples}
            onChange={(event) => setField("apiCallSamples", event.target.value)}
            className="rounded-lg border border-slate-300 p-3"
          />
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium">
          Payload size for /api/bench/payload (MB)
          <input
            type="number"
            min={1}
            max={5}
            value={formState.payloadSizeMb}
            onChange={(event) => setField("payloadSizeMb", event.target.value)}
            className="rounded-lg border border-slate-300 p-3"
            disabled={!isPayloadPath(formState.targetPath)}
          />
          <p className="text-xs text-slate-500">
            Used only when target is /api/bench/payload. Ignored otherwise.
          </p>
        </label>

        <label className="md:col-span-2 flex flex-col gap-2 text-sm font-medium">
          JSON body for POST (optional)
          <textarea
            className="min-h-24 rounded-lg border border-slate-300 p-3 text-sm"
            value={formState.requestBody}
            onChange={(event) => setField("requestBody", event.target.value)}
            placeholder='{"example":"value"}'
            disabled={formState.requestMethod !== "POST"}
          />
        </label>

        <button
          type="submit"
          disabled={isRunning}
          className="rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400 md:col-span-2"
        >
          {isRunning ? "Running benchmark..." : "Run local benchmark"}
        </button>
      </form>

      {error && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
          <p className="font-semibold">Error</p>
          <p>{error}</p>
        </section>
      )}

      {result && (
        <section className="grid gap-4 md:grid-cols-2">
          <article className="rounded-xl border border-slate-200 bg-white/95 p-4">
            <p className="mb-2 text-sm uppercase tracking-[0.15em] text-slate-500">
              Target route
            </p>
            <p className="truncate text-sm text-slate-700">{result.targetPath}</p>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white/95 p-4">
            <p className="mb-2 text-sm uppercase tracking-[0.15em] text-slate-500">
              Load time
            </p>
            <h2 className="text-2xl font-bold">
              {formatMs(result.loadTime.durationMs)}
            </h2>
            <p className="text-sm text-slate-600">
              Status {result.loadTime.status} · {formatBytes(result.loadTime.sizeBytes)}
            </p>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white/95 p-4">
            <p className="mb-2 text-sm uppercase tracking-[0.15em] text-slate-500">
              Max bandwidth
            </p>
            <p className="text-2xl font-bold">
              {formatBytesPerSec(result.maxBandwidth.averageBytesPerSecond)}
            </p>
            <p className="text-sm text-slate-600">
              Peak request throughput: {" "}
              {formatBytesPerSec(
                result.maxBandwidth.peakRequestThroughputBytesPerSecond,
              )}
            </p>
            <p className="text-sm text-slate-600">
              {result.maxBandwidth.successfulRequests} / {" "}
              {result.maxBandwidth.totalRequests} successful
              requests · {result.maxBandwidth.failedRequests} failed · {" "}
              {result.maxBandwidth.requestErrors} fetch errors
            </p>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white/95 p-4">
            <p className="mb-2 text-sm uppercase tracking-[0.2em] text-slate-500">
              API call runtime
            </p>
            <p className="text-2xl font-bold">
              {formatMs(result.apiCallRuntime.maxDurationMs)}
            </p>
            <p className="text-sm text-slate-600">
              Avg {formatMs(result.apiCallRuntime.avgDurationMs)} · p95 {" "}
              {formatMs(result.apiCallRuntime.p95DurationMs)} · Success {" "}
              {result.apiCallRuntime.successfulSamples}/
              {result.apiCallRuntime.completedSamples}
            </p>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white/95 p-4 md:col-span-2">
            <p className="mb-2 text-sm uppercase tracking-[0.15em] text-slate-500">
              Process power (Next.js runtime)
            </p>
            <p className="text-2xl font-bold">
              {formatPercent(result.processPower.cpuUsagePercent)}
            </p>
            <p className="text-sm text-slate-600">
              CPU time {formatMs(result.processPower.cpuTimeMs)} over {" "}
              {formatMs(result.processPower.elapsedMs)} · {result.processPower.cpus} core(s)
            </p>
            <p className="text-sm text-slate-600">
              RSS {formatBytes(result.processPower.memory.rssMB * 1024 * 1024)} ·
              Heap used {formatBytes(result.processPower.memory.heapUsedMB * 1024 * 1024)} ·
              Heap delta {formatBytes(result.processPower.memory.heapDeltaMB * 1024 * 1024)}
            </p>
            <p className="text-sm text-slate-600">
              Load avg {result.processPower.loadAverage.map((value) => value.toFixed(2)).join(" / ")}
            </p>
          </article>
        </section>
      )}

      {rawResult && (
        <section className="rounded-xl border border-slate-200 bg-slate-900 p-4 text-xs text-emerald-100">
          <p className="mb-2 font-semibold text-emerald-300">Raw JSON result</p>
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap">
            {rawResult}
          </pre>
        </section>
      )}
    </main>
  );
}
