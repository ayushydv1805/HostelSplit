const STORAGE_KEY = "hostelsplit-auth-session-v1";
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

export const cloudConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

function headers(session, extra) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: "Bearer " + ((session && session.access_token) || SUPABASE_KEY),
    ...(extra || {}),
  };
}

async function readResponse(response) {
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    const message = payload && (payload.message || payload.msg || payload.error_description || payload.error);
    throw new Error(message || ("Request failed with status " + response.status));
  }
  return payload;
}

function saveSession(session) {
  if (!session) {
    clearCachedSession();
    return null;
  }
  const saved = {
    ...session,
    expires_at: session.expires_at || (session.expires_in ? Math.floor(Date.now() / 1000) + session.expires_in : null),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* Auth remains usable for this tab. */ }
  return saved;
}

export function clearCachedSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be blocked. */ }
}

export function getCachedSession() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export async function refreshSession() {
  if (!cloudConfigured) return null;
  const current = getCachedSession();
  if (!current || !current.refresh_token) return current;
  if (current.expires_at && current.expires_at > Math.floor(Date.now() / 1000) + 60) return current;

  const response = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: headers(null, { "Content-Type": "application/json" }),
    body: JSON.stringify({ refresh_token: current.refresh_token }),
  });
  const refreshed = await readResponse(response);
  return saveSession(refreshed);
}

export async function signIn(email, password) {
  if (!cloudConfigured) throw new Error("Cloud login is not configured. Add the Supabase environment variables first.");
  const response = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: headers(null, { "Content-Type": "application/json" }),
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  return saveSession(await readResponse(response));
}

export async function signUp(email, password, displayName) {
  if (!cloudConfigured) throw new Error("Cloud login is not configured. Add the Supabase environment variables first.");
  const response = await fetch(SUPABASE_URL + "/auth/v1/signup", {
    method: "POST",
    headers: headers(null, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      data: { display_name: displayName.trim() },
    }),
  });
  const result = await readResponse(response);
  if (result.access_token) return { session: saveSession(result), confirmationRequired: false };
  return { session: null, confirmationRequired: true };
}

export async function signOut() {
  const session = getCachedSession();
  if (cloudConfigured && session && session.access_token) {
    try {
      await fetch(SUPABASE_URL + "/auth/v1/logout", {
        method: "POST",
        headers: headers(session),
      });
    } catch {
      // Clear local credentials even if the network is temporarily unavailable.
    }
  }
  saveSession(null);
}

export async function getCurrentUser(session) {
  const response = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: headers(session) });
  return readResponse(response);
}

export async function requestPasswordReset(email) {
  const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
  const url = SUPABASE_URL + "/auth/v1/recover" + (redirectTo ? "?redirect_to=" + encodeURIComponent(redirectTo) : "");
  const response = await fetch(url, {
    method: "POST",
    headers: headers(null, { "Content-Type": "application/json" }),
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  await readResponse(response);
}

export async function completePasswordRecovery(accessToken, password) {
  if (!cloudConfigured) throw new Error("Cloud login is not configured.");
  if (!accessToken) throw new Error("This password-reset link is missing its recovery token. Request a fresh link and try again.");
  const response = await fetch(SUPABASE_URL + "/auth/v1/user", {
    method: "PUT",
    headers: headers({ access_token: accessToken }, { "Content-Type": "application/json" }),
    body: JSON.stringify({ password }),
  });
  return readResponse(response);
}

async function restRequest(path, options, session) {
  if (!cloudConfigured) throw new Error("Cloud mode is not configured.");
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers: headers(session, {
      "Content-Type": "application/json",
      ...(options && options.headers ? options.headers : {}),
    }),
  });
  return readResponse(response);
}

function queryString(params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => query.set(key, String(value)));
  return query.toString();
}

export async function selectRows(table, params, session) {
  return restRequest(table + (params && Object.keys(params).length ? "?" + queryString(params) : ""), {}, session);
}

export async function insertRows(table, rows, session, onConflict) {
  const params = onConflict ? "?on_conflict=" + encodeURIComponent(onConflict) : "";
  const headersExtra = { Prefer: onConflict ? "resolution=merge-duplicates,return=representation" : "return=representation" };
  return restRequest(table + params, {
    method: "POST",
    headers: headersExtra,
    body: JSON.stringify(rows),
  }, session);
}

export async function updateRows(table, filters, values, session) {
  return restRequest(table + "?" + queryString(filters || {}), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(values),
  }, session);
}

export async function deleteRows(table, filters, session) {
  return restRequest(table + "?" + queryString(filters || {}), {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  }, session);
}

export async function callRpc(name, args, session) {
  return restRequest("rpc/" + name, {
    method: "POST",
    body: JSON.stringify(args || {}),
  }, session);
}

export async function uploadReceipt(path, file, session) {
  const response = await fetch(SUPABASE_URL + "/storage/v1/object/receipts/" + path, {
    method: "POST",
    headers: headers(session, {
      "Content-Type": file.type || "image/jpeg",
      "x-upsert": "true",
    }),
    body: file,
  });
  return readResponse(response);
}

export async function getReceiptUrl(path, session) {
  const response = await fetch(SUPABASE_URL + "/storage/v1/object/sign/receipts/" + path, {
    method: "POST",
    headers: headers(session, { "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: 300 }),
  });
  const result = await readResponse(response);
  return result.signedURL && result.signedURL.startsWith("http")
    ? result.signedURL
    : SUPABASE_URL + "/storage/v1" + result.signedURL;
}

export function getSupabaseProjectUrl() {
  return SUPABASE_URL;
}
