// PayPal mode constants — the ONE place the sandbox/live switch lives.
//
// GUARDRAIL (non-negotiable): TEST_MODE defaults to true. While true, every
// server call goes to the sandbox API base and the pricing page loads the
// sandbox JS SDK — a buyer cannot be charged real money. Flip to live LATER,
// in code, AFTER the paid features actually exist. There is deliberately NO
// live-switch UI and no env var to toggle this.
//
// This module is intentionally free of node imports so client components can
// import it safely.

export const TEST_MODE = true;

export const PAYPAL_API_BASE = TEST_MODE
  ? "https://api-m.sandbox.paypal.com"
  : "https://api-m.paypal.com";

export const PAYPAL_SDK_BASE = TEST_MODE
  ? "https://www.sandbox.paypal.com"
  : "https://www.paypal.com";

/** Human phrase for the pricing page banner. */
export const TEST_MODE_LABEL = "TEST MODE — sandbox payments, no real money yet";