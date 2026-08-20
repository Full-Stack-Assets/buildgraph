const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error(JSON.stringify({ source: "gemini", state: "AUTH_REQUIRED", reason: "GEMINI_API_KEY is not configured" }));
  process.exit(2);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000);

try {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
    headers: { "x-goog-api-key": apiKey },
    signal: controller.signal
  });

  const state = response.ok
    ? "CONNECTED"
    : response.status === 401 || response.status === 403
      ? "AUTH_REQUIRED"
      : response.status === 429
        ? "RATE_LIMITED"
        : "DEGRADED";

  console.log(JSON.stringify({
    source: "gemini",
    state,
    httpStatus: response.status,
    checkedAt: new Date().toISOString(),
    scope: "models_metadata_page_size_1"
  }));

  if (!response.ok) process.exit(1);
} catch (error) {
  const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "unreachable";
  console.error(JSON.stringify({ source: "gemini", state: "UNREACHABLE", reason }));
  process.exit(1);
} finally {
  clearTimeout(timeout);
}
