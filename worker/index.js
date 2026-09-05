/* ============================================================
   FLICK IMPACT — Cloudflare Worker(flick-impact.com のバックエンド)

   役割:
     1. 静的な index.html の配信(Workers Static Assets。dist/ は worker/build.mjs が作る)
     2. Google ログイン(OAuth 2.0 / OpenID Connect の Authorization Code フロー)
     3. プレイデータ(記録・設定)の保存 API(Workers KV。ユーザーごとに1キー)

   設計:
     - HTML 側は外部スクリプトを読まない。ログインは /auth/google/start への画面遷移だけで、
       Google とのトークン交換・検証はこの Worker がサーバー側で行う
     - セッションは HMAC 署名付きの HttpOnly Cookie(サーバー側に状態を持たない)
     - 記録の統合は「レベルごとにタイムが短いほうを残す」。設定は更新時刻が新しいほうを採用
     - 外部依存なし(npm パッケージ不使用)。設定値は下の SETTINGS、秘密情報は wrangler secret

   バインディング / 変数(wrangler.toml):
     ASSETS               静的アセット
     PLAYDATA             KV ネームスペース
     GOOGLE_CLIENT_ID     Google OAuth クライアント ID(vars)
     CANONICAL_HOST       正規ホスト名。www などのサブドメインはここへ 301(vars・省略可)
     GOOGLE_CLIENT_SECRET Google OAuth クライアントシークレット(secret)
     SESSION_SECRET       Cookie 署名用の乱数(secret。openssl rand -base64 32 などで作る)
   ============================================================ */

const SETTINGS = {
  SESSION_COOKIE: "fi_session",   // ログインセッション(署名付き)
  OAUTH_COOKIE: "fi_oauth",       // ログイン途中の state / PKCE verifier(短命)
  SESSION_TTL: 90 * 24 * 3600,    // セッションの寿命(秒)
  OAUTH_TTL: 10 * 60,             // ログイン開始からコールバックまでの猶予(秒)
  DATA_MAX_BYTES: 64 * 1024,      // 保存データの上限(バイト)。記録は数十レベルで数KB程度
  LEVEL_KEY_MAX: 4,               // レベル番号の桁数上限(記録のキー検査)
  SCOPE: "openid profile",        // 名前の表示に profile が必要。メールは要求しない
  GOOGLE_AUTH: "https://accounts.google.com/o/oauth2/v2/auth",
  GOOGLE_TOKEN: "https://oauth2.googleapis.com/token",
  GOOGLE_ISSUERS: ["https://accounts.google.com", "accounts.google.com"],
  SECURITY_HEADERS: {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
  },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* www.flick-impact.com など正規ホスト以外のサブドメインは正規ホストへ */
    if (env.CANONICAL_HOST && url.hostname !== env.CANONICAL_HOST && url.hostname.endsWith("." + env.CANONICAL_HOST)) {
      url.hostname = env.CANONICAL_HOST;
      return Response.redirect(url.toString(), 301);
    }

    try {
      if (url.pathname.startsWith("/auth/")) return handleAuth(request, url, env);
      if (url.pathname.startsWith("/api/")) return handleApi(request, url, env);
    } catch (err) {
      console.error(err);
      return json({ error: "internal" }, 500);
    }

    /* それ以外は静的アセット(index.html) */
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SETTINGS.SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
};

/* ============================================================
   認証: /auth/google/start → Google → /auth/google/callback → / に戻る
   ============================================================ */
async function handleAuth(request, url, env) {
  const path = url.pathname;

  if (path === "/auth/google/start" && request.method === "GET") {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_SECRET) {
      return redirectHome(url, "error", "config");
    }
    const state = randomToken();
    const verifier = randomToken();
    const challenge = base64url(await sha256(new TextEncoder().encode(verifier)));
    const auth = new URL(SETTINGS.GOOGLE_AUTH);
    auth.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(url),
      response_type: "code",
      scope: SETTINGS.SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    const headers = new Headers({ Location: auth.toString() });
    headers.append("Set-Cookie", cookie(SETTINGS.OAUTH_COOKIE, `${state}.${verifier}`, {
      maxAge: SETTINGS.OAUTH_TTL, path: "/auth", secure: isHttps(url),
    }));
    return new Response(null, { status: 302, headers });
  }

  if (path === "/auth/google/callback" && request.method === "GET") {
    const clearOauth = cookie(SETTINGS.OAUTH_COOKIE, "", { maxAge: 0, path: "/auth", secure: isHttps(url) });
    const fail = (reason) => redirectHome(url, "error", reason, [clearOauth]);

    if (url.searchParams.get("error")) return fail("denied"); // ユーザーが同意画面でキャンセル
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const saved = readCookie(request, SETTINGS.OAUTH_COOKIE);
    if (!code || !state || !saved) return fail("state");
    const dot = saved.indexOf(".");
    const savedState = saved.slice(0, dot);
    const verifier = saved.slice(dot + 1);
    if (dot < 0 || !timingSafeEqual(savedState, state)) return fail("state");

    /* 認可コードをトークンへ交換(クライアントシークレット + PKCE) */
    const tokenRes = await fetch(SETTINGS.GOOGLE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(url),
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
    });
    if (!tokenRes.ok) {
      console.error("token exchange failed", tokenRes.status, await tokenRes.text());
      return fail("exchange");
    }
    const tokens = await tokenRes.json();

    /* ID トークンの検証。Google のトークンエンドポイントから TLS 経由で直接受け取った
       トークンなので署名検証は省略できる(OIDC Core 3.1.3.7.6)。aud / iss / exp は確認する */
    const claims = decodeJwtPayload(tokens.id_token);
    if (!claims || claims.aud !== env.GOOGLE_CLIENT_ID || !SETTINGS.GOOGLE_ISSUERS.includes(claims.iss) ||
        !claims.sub || !(claims.exp * 1000 > Date.now())) {
      return fail("token");
    }

    const session = await signSession(env.SESSION_SECRET, {
      sub: claims.sub,
      name: typeof claims.name === "string" ? claims.name.slice(0, 80) : "",
      exp: Math.floor(Date.now() / 1000) + SETTINGS.SESSION_TTL,
    });
    return redirectHome(url, "ok", null, [
      clearOauth,
      cookie(SETTINGS.SESSION_COOKIE, session, { maxAge: SETTINGS.SESSION_TTL, path: "/", secure: isHttps(url) }),
    ]);
  }

  if (path === "/auth/logout" && request.method === "POST") {
    if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);
    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": cookie(SETTINGS.SESSION_COOKIE, "", { maxAge: 0, path: "/", secure: isHttps(url) }) },
    });
  }

  return json({ error: "not_found" }, 404);
}

/* ============================================================
   API: /api/me(ログイン状態) /api/data(プレイデータの取得・保存)
   ============================================================ */
async function handleApi(request, url, env) {
  const path = url.pathname;
  const user = env.SESSION_SECRET ? await verifySession(env.SESSION_SECRET, readCookie(request, SETTINGS.SESSION_COOKIE)) : null;

  if (path === "/api/me" && request.method === "GET") {
    return json({ user: user ? { name: user.name } : null });
  }

  if (path === "/api/data") {
    if (!user) return json({ error: "unauthorized" }, 401);
    const key = `user:${user.sub}`;

    if (request.method === "GET") {
      const data = await env.PLAYDATA.get(key, "json");
      return json({ data: data ?? null });
    }

    if (request.method === "PUT") {
      if (!sameOrigin(request, url)) return json({ error: "forbidden" }, 403);
      const raw = await request.text();
      if (raw.length > SETTINGS.DATA_MAX_BYTES) return json({ error: "too_large" }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }
      const incoming = sanitizeData(body);
      if (!incoming) return json({ error: "bad_data" }, 400);
      /* 別端末からの保存と衝突しても記録を失わないよう、サーバー側でも統合する */
      const current = await env.PLAYDATA.get(key, "json");
      const merged = mergeData(current, incoming);
      merged.savedAt = Date.now();
      await env.PLAYDATA.put(key, JSON.stringify(merged));
      return json({ data: merged });
    }
  }

  return json({ error: "not_found" }, 404);
}

/* 受け取ったデータを型どおりに切り出す。形が違えば null */
function sanitizeData(body) {
  if (!body || typeof body !== "object") return null;
  const records = {};
  const levelKey = new RegExp(`^[1-9]\\d{0,${SETTINGS.LEVEL_KEY_MAX - 1}}$`);
  for (const [lv, rec] of Object.entries(body.records ?? {})) {
    if (!levelKey.test(lv) || !rec || typeof rec !== "object" || !Number.isFinite(rec.time)) continue;
    records[lv] = rec;
  }
  const settings = body.settings && typeof body.settings === "object" && !Array.isArray(body.settings) ? body.settings : {};
  const updatedAt = Number.isFinite(body.updatedAt) ? body.updatedAt : Date.now();
  return { records, settings, updatedAt };
}

/* 統合: 記録はレベルごとにタイムが短いほう、設定は updatedAt が新しいほう */
function mergeData(current, incoming) {
  if (!current) return incoming;
  const records = { ...current.records };
  for (const [lv, rec] of Object.entries(incoming.records)) {
    if (!records[lv] || rec.time < records[lv].time) records[lv] = rec;
  }
  const newer = incoming.updatedAt >= (current.updatedAt ?? 0);
  return {
    records,
    settings: newer ? incoming.settings : current.settings,
    updatedAt: newer ? incoming.updatedAt : current.updatedAt,
  };
}

/* ============================================================
   セッション Cookie: base64url(JSON) + "." + base64url(HMAC-SHA256)
   ============================================================ */
async function hmacKey(secret, usage) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}
async function signSession(secret, payload) {
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), new TextEncoder().encode(body));
  return `${body}.${base64url(sig)}`;
}
async function verifySession(secret, token) {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = fromBase64url(token.slice(dot + 1));
  if (!sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), sig, new TextEncoder().encode(body));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
    if (!payload || typeof payload.sub !== "string" || !(payload.exp * 1000 > Date.now())) return null;
    return payload;
  } catch { return null; }
}

/* ============================================================
   小道具
   ============================================================ */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SETTINGS.SECURITY_HEADERS },
  });
}
/* トップへ戻す。結果は ?auth=ok / ?auth=error&reason=... で HTML 側に伝える */
function redirectHome(url, auth, reason, cookies = []) {
  const to = new URL("/", url);
  to.searchParams.set("auth", auth);
  if (reason) to.searchParams.set("reason", reason);
  const headers = new Headers({ Location: to.toString() });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}
function redirectUri(url) { return `${url.origin}/auth/google/callback`; }
function isHttps(url) { return url.protocol === "https:"; }
/* 状態を変える要求は同一オリジンからのみ受ける(ブラウザは POST/PUT に必ず Origin を付ける) */
function sameOrigin(request, url) { return request.headers.get("Origin") === url.origin; }

function cookie(name, value, { maxAge, path, secure }) {
  let s = `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
  if (secure) s += "; Secure";
  return s;
}
function readCookie(request, name) {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

function randomToken() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return base64url(buf);
}
async function sha256(bytes) { return crypto.subtle.digest("SHA-256", bytes); }
function base64url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64url(s) {
  try {
    const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4));
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  } catch { return null; }
}
function decodeJwtPayload(jwt) {
  if (typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(new TextDecoder().decode(fromBase64url(parts[1]))); } catch { return null; }
}
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
