# Next.js Self-Host Server Testbench

A local-only benchmark tool to measure server performance from inside your running Next.js app.

## What this project does

- Measures **load time** for a local route
- Measures **max sustained bandwidth** for a local route
- Measures **max / avg / p95 API runtime** from repeated API calls
- Captures **Next.js process power** (CPU, memory, load average) during test execution

The tool only targets routes inside the same Next.js host (it no longer calls external URLs).

## Project layout

- `app/page.tsx`: Dashboard UI for launching tests
- `app/api/server-bench/route.ts`: Test orchestrator API
- `app/api/bench/health/route.ts`: Internal baseline health endpoint
- `app/api/bench/payload/route.ts`: Payload endpoint used for bandwidth testing

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Start the dev server:

```bash
npm run dev
```

3. Open `http://localhost:3000`.

## How to run a benchmark

1. Choose one of the preset endpoints, or enter a local route that starts with `/api/`.
2. Set test parameters:
   - Duration (2-30s)
   - Concurrency (1-40)
   - Sample count (10-500)
   - Payload size for `/api/bench/payload` (1-5 MB)
3. Click **Run local benchmark** and inspect:
   - Load time
   - Throughput and request success rates
   - API runtime summary
   - Process metrics and memory deltas

## Notes

- `process` metrics are runtime snapshots for the benchmark window, not a full historical time-series.
- The route `/api/server-bench` is protected from self-recursive targeting.
- The target path must be local (`/api/*`) to prevent external traffic from being tested by this tool.
