import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = (__ENV.LOAD_TEST_BASE_URL || "").replace(/\/$/u, "");
const bypassSecret = (__ENV.VERCEL_AUTOMATION_BYPASS_SECRET || "").trim();

export const options = {
  scenarios: {
    health_burst: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 10,
      maxVUs: 100,
      stages: [
        { target: 25, duration: "1m" },
        { target: 50, duration: "2m" },
        { target: 0, duration: "1m" },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800", "p(99)<2000"],
  },
};

export default function () {
  if (!baseUrl) throw new Error("Define LOAD_TEST_BASE_URL apuntando a staging.");
  const response = http.get(`${baseUrl}/api/health`, {
    headers: {
      accept: "application/json",
      ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
    },
    tags: { endpoint: "health" },
  });
  check(response, {
    "health responde HTTP 200": (value) => value.status === 200,
    "health indica ready": (value) => value.json("status") === "ready",
  });
  sleep(1);
}
