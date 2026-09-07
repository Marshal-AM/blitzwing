export async function httpJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      // Free ngrok interstitial bypass for API clients
      "ngrok-skip-browser-warning": "true",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      typeof body === "object"
        ? body.detail?.message || body.detail || body.message || text || res.statusText
        : text || res.statusText
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function listMothers(discoveryUrl) {
  return httpJson(`${discoveryUrl.replace(/\/$/, "")}/v1/mothers`);
}

export async function motherHealth(motherUrl) {
  return httpJson(`${motherUrl.replace(/\/$/, "")}/health`);
}

export async function motherHosts(motherUrl) {
  return httpJson(`${motherUrl.replace(/\/$/, "")}/v1/hosts`);
}

export async function joinHost(motherUrl, payload) {
  return httpJson(`${motherUrl.replace(/\/$/, "")}/v1/hosts/join`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function readyHost(motherUrl, payload) {
  return httpJson(`${motherUrl.replace(/\/$/, "")}/v1/hosts/ready`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function heartbeatHost(motherUrl, payload) {
  return httpJson(`${motherUrl.replace(/\/$/, "")}/v1/hosts/heartbeat`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function leaveHost(motherUrl, payload) {
  return httpJson(`${motherUrl.replace(/\/$/, "")}/v1/hosts/leave`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
