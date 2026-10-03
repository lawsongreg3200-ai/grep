// PayPal checkout wiring — SANDBOX-ONLY until paid features actually exist.
//
// GUARDRAIL (non-negotiable): TEST_MODE is a code constant, default true.
// While true, every PayPal call goes to the sandbox API base and the page loads
// the sandbox JS SDK — a buyer cannot be charged real money. Flipping to live
// happens by changing this one constant (plus the API/SDK bases below) AFTER the
// paid features exist. There is deliberately NO live-switch UI and no env var to
// toggle it.
//
// Credential policy (owner decision): only PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET
// from the environment; no third env var. The code never assumes whether they are
// sandbox or live — if they don't authenticate against the sandbox API, every call
// fails loudly and honestly and nothing is recorded as paid.

import { PAYPAL_API_BASE, TEST_MODE } from "./paypal-config";
export { PAYPAL_SDK_BASE, TEST_MODE } from "./paypal-config";

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET ?? "";

export const USD = "USD";

export interface Tier {
  id: string;
  label: string;
  amount: string;
  currency: string;
}

export const TIERS: Record<"report-extras" | "watchlist", Tier> = {
  "report-extras": {
    id: "report-extras",
    label: "Report extras — PDF + deep-lookup credit",
    amount: "10.00",
    currency: USD,
  },
  watchlist: {
    id: "watchlist",
    label: "Integrity Watchlist",
    amount: "19.00",
    currency: USD,
  },
};

// ---------------------------------------------------------------------------
// Storage: every order / subscription record as JSON under
// /home/team/shared/data/orders/, plus the cached Billing Plan id in
// paypal-plan.json. File-based until DATABASE_URL exists (same philosophy as
// src/lib/store.ts — swappable later).
// ---------------------------------------------------------------------------

const DATA_ROOT = process.env.INTEGRITY_DATA_DIR ?? "/home/team/shared/data";
export const ORDERS_DIR = `${DATA_ROOT}/orders`;
const PLAN_CACHE_PATH = `${DATA_ROOT}/paypal-plan.json`;

export interface OrderRecord {
  kind: "order";
  orderId: string; // PayPal order id (filename key)
  refId: string; // internal reference id
  tier: string;
  label: string;
  amount: string;
  currency: string;
  status: string; // PayPal order status: CREATED / COMPLETED / FAILED
  payerEmail?: string;
  captureId?: string;
  captureStatus?: string;
  createdAt: string;
  capturedAt?: string;
  /** Honest failure detail, set when PayPal rejected something. */
  error?: string;
}

export interface SubscriptionRecord {
  kind: "subscription";
  subscriptionId: string; // e.g. I-XXXX
  planId: string;
  tier: string;
  amount: string;
  currency: string;
  interval: string;
  status: string; // PayPal subscription status
  payerEmail?: string;
  createdAt: string;
  error?: string;
}

export type PaypalRecord = OrderRecord | SubscriptionRecord;

export interface PlanInfo {
  productId: string;
  planId: string;
  createdAt: string;
  testMode: boolean;
}

function jsonFile<T>(path: string, data: T | null): T | null {
  const { existsSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
  try {
    if (data === null) {
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, "utf8")) as T;
    }
    mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true, mode: 0o775 });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
    return data;
  } catch {
    return null;
  }
}

export function readRecord(key: string): PaypalRecord | null {
  return jsonFile<PaypalRecord>(`${ORDERS_DIR}/${key}.json`, null);
}

export function writeRecord(rec: PaypalRecord): void {
  const key = rec.kind === "order" ? rec.orderId : rec.subscriptionId;
  jsonFile<PaypalRecord>(`${ORDERS_DIR}/${key}.json`, rec);
}

export function listRecords(): PaypalRecord[] {
  const { readdirSync, existsSync } = require("node:fs");
  try {
    if (!existsSync(ORDERS_DIR)) return [];
    const files: string[] = readdirSync(ORDERS_DIR) as string[];
    return files
      .filter((f: string) => f.endsWith(".json"))
      .map((f: string) => jsonFile<PaypalRecord>(`${ORDERS_DIR}/${f}`, null))
      .filter((r: PaypalRecord | null): r is PaypalRecord => r !== null)
      .sort((a: PaypalRecord, b: PaypalRecord) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function readPlanCache(): PlanInfo | null {
  return jsonFile<PlanInfo>(PLAN_CACHE_PATH, null);
}

export function writePlanCache(info: PlanInfo): void {
  jsonFile<PlanInfo>(PLAN_CACHE_PATH, info);
}

// ---------------------------------------------------------------------------
// Payment provider errors — honest, surfaced to the UI as-is.
// ---------------------------------------------------------------------------

export class PaypalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaypalConfigError";
  }
}

export class PaypalApiError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, details: unknown) {
    super(
      `PayPal API error (HTTP ${status}): ${
        typeof details === "object" && details !== null && "error_description" in details
          ? String((details as { error_description: unknown }).error_description)
          : typeof details === "object" && details !== null && "message" in details
            ? String((details as { message: unknown }).message)
            : JSON.stringify(details)
      }`
    );
    this.name = "PaypalApiError";
    this.status = status;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// OAuth2 client-credentials token (cached). Failures are cached briefly so a
// misconfigured app doesn't hammer the API on every page load.
// ---------------------------------------------------------------------------

let tokenCache: { token: string; expiresAt: number } | null = null;
let errorCache: { reason: string; until: number } | null = null;

export function paypalConfigured(): boolean {
  return CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;
}

async function getAccessToken(): Promise<string> {
  if (!paypalConfigured()) {
    throw new PaypalConfigError(
      "PayPal credentials are not set (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET missing). Nothing can be created."
    );
  }
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
  if (errorCache && errorCache.until > Date.now()) {
    throw new PaypalConfigError(errorCache.reason);
  }

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`, "utf8").toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: controller.signal,
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!res.ok || !body.access_token) {
      const reason = describeAuthFailure(res.status, body);
      errorCache = { reason, until: Date.now() + 60_000 };
      throw new PaypalConfigError(reason);
    }
    tokenCache = {
      token: body.access_token,
      expiresAt: Date.now() + ((body.expires_in ?? 32400) - 60) * 1000,
    };
    return tokenCache.token;
  } finally {
    clearTimeout(timer);
  }
}

/** Turn an OAuth failure into a precise, honest, human message (never a hint). */
function describeAuthFailure(status: number, body: Record<string, unknown>): string {
  const detail =
    body.error_description !== undefined
      ? String(body.error_description)
      : body.error !== undefined
        ? String(body.error)
        : JSON.stringify(body);
  const hint =
    status === 401
      ? " — PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET do not authenticate against the PayPal sandbox API. They may be LIVE (production) credentials; sandbox testing needs a sandbox app's client id/secret. No order was created and no money moved."
      : "";
  return `PayPal sandbox rejected the configured credentials (HTTP ${status}: ${detail})${hint}`;
}

// ---------------------------------------------------------------------------
// PayPal REST v2 calls
// ---------------------------------------------------------------------------

async function paypalFetch(path: string, init: { method?: string; body?: unknown } = {}) {
  const token = await getAccessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(`${PAYPAL_API_BASE}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `integrity-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      throw new PaypalApiError(res.status, body);
    }
    return body as Record<string, any>;
  } finally {
    clearTimeout(timer);
  }
}

function randomRef(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Create the $10.00 one-off order. Amount is fixed server-side — never client-supplied. */
export async function createReportExtrasOrder(): Promise<OrderRecord> {
  const tier = TIERS["report-extras"];
  const refId = randomRef("inc");
  const res = await paypalFetch("/v2/checkout/orders", {
    method: "POST",
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: refId,
          description: tier.label,
          amount: { currency_code: tier.currency, value: tier.amount },
        },
      ],
    },
  });
  const record: OrderRecord = {
    kind: "order",
    orderId: String(res.id),
    refId,
    tier: tier.id,
    label: tier.label,
    amount: tier.amount,
    currency: tier.currency,
    status: String(res.status ?? "CREATED"),
    createdAt: new Date().toISOString(),
  };
  writeRecord(record);
  return record;
}

/** Capture an approved order. Records the real result; throws on failure. */
export async function captureOrder(orderId: string): Promise<OrderRecord> {
  const existing = readRecord(orderId) as OrderRecord | null;
  const res = await paypalFetch(`/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
  });
  const captures: Array<Record<string, any>> =
    res.purchase_units?.[0]?.payments?.captures ?? [];
  const first = captures[0];
  const record: OrderRecord = {
    kind: "order",
    orderId: String(res.id ?? orderId),
    refId: existing?.refId ?? `inc-${orderId}`,
    tier: existing?.tier ?? "report-extras",
    label: existing?.label ?? TIERS["report-extras"].label,
    amount: existing?.amount ?? TIERS["report-extras"].amount,
    currency: existing?.currency ?? USD,
    status: String(res.status ?? (first?.status ?? "UNKNOWN")),
    payerEmail: typeof res.payer?.email_address === "string" ? res.payer.email_address : undefined,
    captureId: typeof first?.id === "string" ? first.id : undefined,
    captureStatus: typeof first?.status === "string" ? first.status : undefined,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    capturedAt: new Date().toISOString(),
  };
  writeRecord(record);
  return record;
}

/** Lazily ensure the Watchlist Product + Billing Plan exist; cache the ids. */
let planMemo: { info: PlanInfo } | { error: string } | null = null;

export async function ensureWatchlistPlan(): Promise<PlanInfo> {
  if (planMemo) {
    if ("info" in planMemo) return planMemo.info;
    throw new PaypalConfigError(planMemo.error);
  }
  const cached = readPlanCache();
  if (cached && cached.testMode === TEST_MODE) {
    planMemo = { info: cached };
    return cached;
  }
  try {
    const product = await paypalFetch("/v1/catalogs/products", {
      method: "POST",
      body: {
        name: "Integrity Watchlist",
        description: "Monthly watchlist: re-scans of sites you track, email when their claims change.",
        type: "SERVICE",
      },
    });
    const plan = await paypalFetch("/v1/billing/plans", {
      method: "POST",
      body: {
        product_id: String(product.id),
        name: "Integrity Watchlist",
        description: "Watchlist subscription — $19.00 USD per month.",
        billing_cycles: [
          {
            frequency: { interval_unit: "MONTH", interval_count: 1 },
            tenure_type: "REGULAR",
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: { fixed_price: { value: TIERS.watchlist.amount, currency_code: TIERS.watchlist.currency } },
          },
        ],
        payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
      },
    });
    const info: PlanInfo = {
      productId: String(product.id),
      planId: String(plan.id),
      createdAt: new Date().toISOString(),
      testMode: TEST_MODE,
    };
    writePlanCache(info);
    planMemo = { info };
    return info;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown plan creation failure";
    // Persist the negative result for this process only; retried after restart.
    planMemo = { error: message };
    throw new PaypalConfigError(`${message} — the Watchlist plan could not be created in sandbox.`);
  }
}

/** Create a $19/mo Watchlist subscription (server-side creation; status = APPROVAL_PENDING). */
export async function createWatchlistSubscription(): Promise<SubscriptionRecord> {
  const { planId } = await ensureWatchlistPlan();
  const res = await paypalFetch("/v1/billing/subscriptions", {
    method: "POST",
    body: {
      plan_id: planId,
      quantity: "1",
      application_context: { user_action: "SUBSCRIBE_NOW" },
    },
  });
  const record: SubscriptionRecord = {
    kind: "subscription",
    subscriptionId: String(res.id),
    planId,
    tier: TIERS.watchlist.id,
    amount: TIERS.watchlist.amount,
    currency: TIERS.watchlist.currency,
    interval: "P1M",
    status: String(res.status ?? "UNKNOWN"),
    createdAt: new Date().toISOString(),
  };
  writeRecord(record);
  return record;
}

/** Fetch and record the real state of an existing subscription (e.g. after SDK approval). */
export async function recordSubscription(subscriptionId: string): Promise<SubscriptionRecord> {
  const existing = readRecord(subscriptionId) as SubscriptionRecord | null;
  const res = await paypalFetch(`/v1/billing/subscriptions/${subscriptionId}`);
  const record: SubscriptionRecord = {
    kind: "subscription",
    subscriptionId: String(res.id ?? subscriptionId),
    planId: String(res.plan_id ?? existing?.planId ?? ""),
    tier: TIERS.watchlist.id,
    amount: TIERS.watchlist.amount,
    currency: TIERS.watchlist.currency,
    interval: "P1M",
    status: res.status === "APPROVAL_PENDING" && existing ? existing.status : String(res.status ?? "UNKNOWN"),
    payerEmail: typeof res.subscriber?.email_address === "string" ? res.subscriber.email_address : existing?.payerEmail,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  writeRecord(record);
  return record;
}

// ---------------------------------------------------------------------------
// Status probe for the pricing page (drives what the page honestly shows).
// ---------------------------------------------------------------------------

export interface PaypalStatus {
  testMode: boolean;
  clientIdSet: boolean;
  clientId: string;
  configured: boolean;
  error: string | null;
  hasPlan: boolean;
  planId: string | null;
  planError: string | null;
  apiBase: string;
}

export async function paypalStatus(): Promise<PaypalStatus> {
  const base: PaypalStatus = {
    testMode: TEST_MODE,
    clientIdSet: paypalConfigured(),
    clientId: paypalConfigured() ? CLIENT_ID : "",
    configured: false,
    error: null,
    hasPlan: false,
    planId: null,
    planError: null,
    apiBase: PAYPAL_API_BASE,
  };
  if (!paypalConfigured()) {
    base.error = "PayPal credentials are not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET unset).";
    return base;
  }
  try {
    await getAccessToken();
    base.configured = true;
    try {
      const info = await ensureWatchlistPlan();
      base.hasPlan = true;
      base.planId = info.planId;
    } catch (err) {
      base.planError = err instanceof Error ? err.message : "Plan creation failed (account limitation?)";
    }
  } catch (err) {
    base.error = err instanceof Error ? err.message : "PayPal sandbox is unreachable.";
  }
  return base;
}