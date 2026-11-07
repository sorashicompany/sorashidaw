const API_ORIGIN = "https://sorashidaw-api.sorashithegod.workers.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const target = new URL(url.pathname + url.search, API_ORIGIN);
      const headers = new Headers(request.headers);
      headers.set("x-forwarded-host", url.host);
      return fetch(new Request(target, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
      }));
    }
    return env.ASSETS.fetch(request);
  },
};
