const fs = require('fs');
const path = require('path');

const FE_DIR = 'D:/Hammad/metador-replacement-frontend';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// 1. Create API route: app/api/journeys/[[...path]]/route.ts
ensureDir(path.join(FE_DIR, 'app/api/journeys/[[...path]]'));
fs.writeFileSync(path.join(FE_DIR, 'app/api/journeys/[[...path]]/route.ts'), `import type { NextRequest } from "next/server";
import { authResponse, clearSession, sameOrigin, sessionCookie } from "@/lib/auth-server";

type Context = { params: Promise<{ path?: string[] }> };

async function handler(request: NextRequest, context: Context) {
  const { path = [] } = await context.params;
  const token = request.cookies.get(sessionCookie)?.value;
  if (!token) return authResponse({ message: "Please sign in to continue." }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) return authResponse({ message: "Request origin is not allowed." }, 403);

  let body;
  if (request.method !== "GET") {
    try { body = await request.json(); } catch { body = undefined; }
  }

  const base = (process.env.API_BASE_URL || "http://localhost:3000/api").replace(/\\/$/, "");
  const target = new URL(\`\${base}/journeys\${path.length ? \`/\${path.join("/")}\` : ""}\`);
  const rooftopId = request.nextUrl.searchParams.get("rooftopId");
  if (rooftopId) target.searchParams.set("rooftopId", rooftopId);

  try {
    const response = await fetch(target, {
      method: request.method,
      headers: {
        Accept: "application/json",
        Authorization: \`Bearer \${token}\`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (response.status === 401) return clearSession(authResponse({ message: "Session expired." }, 401));
    if (!response.ok) return authResponse(data || { message: "Error in journey service." }, response.status);
    return authResponse(data, response.status);
  } catch (err) {
    return authResponse({ message: "Cannot reach journey service." }, 503);
  }
}

export { handler as GET, handler as POST, handler as PATCH };
`, 'utf8');

// 2. Create API route: app/api/reports/journey-performance/route.ts
ensureDir(path.join(FE_DIR, 'app/api/reports/journey-performance'));
fs.writeFileSync(path.join(FE_DIR, 'app/api/reports/journey-performance/route.ts'), `import type { NextRequest } from "next/server";
import { authResponse, clearSession, sessionCookie } from "@/lib/auth-server";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(sessionCookie)?.value;
  if (!token) return authResponse({ message: "Please sign in to continue." }, 401);

  const base = (process.env.API_BASE_URL || "http://localhost:3000/api").replace(/\\/$/, "");
  const target = new URL(\`\${base}/reports/journey-performance\`);
  for (const p of ["rooftopId", "from", "to"]) {
    const v = request.nextUrl.searchParams.get(p);
    if (v) target.searchParams.set(p, v);
  }

  try {
    const response = await fetch(target, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: \`Bearer \${token}\` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (response.status === 401) return clearSession(authResponse({ message: "Session expired." }, 401));
    if (!response.ok) return authResponse(data || { message: "Error in reports service." }, response.status);
    return authResponse(data, response.status);
  } catch {
    return authResponse({ message: "Cannot reach reports service." }, 503);
  }
}
`, 'utf8');

// 3. Create API route: app/api/writeback/[[...path]]/route.ts
ensureDir(path.join(FE_DIR, 'app/api/writeback/[[...path]]'));
fs.writeFileSync(path.join(FE_DIR, 'app/api/writeback/[[...path]]/route.ts'), `import type { NextRequest } from "next/server";
import { authResponse, clearSession, sameOrigin, sessionCookie } from "@/lib/auth-server";

type Context = { params: Promise<{ path?: string[] }> };

async function handler(request: NextRequest, context: Context) {
  const { path = [] } = await context.params;
  const token = request.cookies.get(sessionCookie)?.value;
  if (!token) return authResponse({ message: "Please sign in to continue." }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) return authResponse({ message: "Request origin is not allowed." }, 403);

  const base = (process.env.API_BASE_URL || "http://localhost:3000/api").replace(/\\/$/, "");
  const target = new URL(\`\${base}/writeback\${path.length ? \`/\${path.join("/")}\` : ""}\`);
  const status = request.nextUrl.searchParams.get("status");
  if (status) target.searchParams.set("status", status);

  try {
    const response = await fetch(target, {
      method: request.method,
      headers: { Accept: "application/json", Authorization: \`Bearer \${token}\` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (response.status === 401) return clearSession(authResponse({ message: "Session expired." }, 401));
    if (!response.ok) return authResponse(data || { message: "Error in writeback service." }, response.status);
    return authResponse(data, response.status);
  } catch {
    return authResponse({ message: "Cannot reach writeback service." }, 503);
  }
}

export { handler as GET, handler as POST };
`, 'utf8');

// 4. Create API route: app/api/notifications/[[...path]]/route.ts
ensureDir(path.join(FE_DIR, 'app/api/notifications/[[...path]]'));
fs.writeFileSync(path.join(FE_DIR, 'app/api/notifications/[[...path]]/route.ts'), `import type { NextRequest } from "next/server";
import { authResponse, clearSession, sameOrigin, sessionCookie } from "@/lib/auth-server";

type Context = { params: Promise<{ path?: string[] }> };

async function handler(request: NextRequest, context: Context) {
  const { path = [] } = await context.params;
  const token = request.cookies.get(sessionCookie)?.value;
  if (!token) return authResponse({ message: "Please sign in to continue." }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) return authResponse({ message: "Request origin is not allowed." }, 403);

  const base = (process.env.API_BASE_URL || "http://localhost:3000/api").replace(/\\/$/, "");
  const target = new URL(\`\${base}/notifications\${path.length ? \`/\${path.join("/")}\` : ""}\`);

  try {
    const response = await fetch(target, {
      method: request.method,
      headers: { Accept: "application/json", Authorization: \`Bearer \${token}\` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (response.status === 401) return clearSession(authResponse({ message: "Session expired." }, 401));
    if (!response.ok) return authResponse(data || { message: "Error in notifications service." }, response.status);
    return authResponse(data, response.status);
  } catch {
    return authResponse({ message: "Cannot reach notifications service." }, 503);
  }
}

export { handler as GET, handler as PATCH };
`, 'utf8');

// 5. Create API route: app/api/rooftops/[[...path]]/route.ts
ensureDir(path.join(FE_DIR, 'app/api/rooftops/[[...path]]'));
fs.writeFileSync(path.join(FE_DIR, 'app/api/rooftops/[[...path]]/route.ts'), `import type { NextRequest } from "next/server";
import { authResponse, clearSession, sameOrigin, sessionCookie } from "@/lib/auth-server";

type Context = { params: Promise<{ path?: string[] }> };

async function handler(request: NextRequest, context: Context) {
  const { path = [] } = await context.params;
  const token = request.cookies.get(sessionCookie)?.value;
  if (!token) return authResponse({ message: "Please sign in to continue." }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) return authResponse({ message: "Request origin is not allowed." }, 403);

  let body;
  if (request.method !== "GET") {
    try { body = await request.json(); } catch { body = undefined; }
  }

  const base = (process.env.API_BASE_URL || "http://localhost:3000/api").replace(/\\/$/, "");
  const target = new URL(\`\${base}/rooftops\${path.length ? \`/\${path.join("/")}\` : ""}\`);

  try {
    const response = await fetch(target, {
      method: request.method,
      headers: {
        Accept: "application/json",
        Authorization: \`Bearer \${token}\`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (response.status === 401) return clearSession(authResponse({ message: "Session expired." }, 401));
    if (!response.ok) return authResponse(data || { message: "Error in rooftops service." }, response.status);
    return authResponse(data, response.status);
  } catch {
    return authResponse({ message: "Cannot reach rooftops service." }, 503);
  }
}

export { handler as GET, handler as PATCH };
`, 'utf8');

console.log('API routes created successfully');
