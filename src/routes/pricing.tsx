import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PageHeading, Shell } from "~/components/SiteShell";
import { PAYPAL_SDK_BASE, TEST_MODE_LABEL } from "~/lib/paypal-config";

export const Route = createFileRoute("/pricing")({
  component: Pricing,
});

interface PaypalStatus {
  testMode: boolean;
  clientIdSet: boolean;
  clientId: string;
  configured: boolean;
  error: string | null;
  hasPlan: boolean;
  planId: string | null;
  planError: string | null;
}

type Status = PaypalStatus | null | "loading";

function Pricing() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let alive = true;
    fetch("/api/paypal/status")
      .then((r) => r.json())
      .then((j) => {
        if (alive) setStatus(j as PaypalStatus);
      })
      .catch(() => {
        if (alive) setStatus(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Shell>
      <div className="border border-[#B57BE0]/40 bg-[#B57BE0]/10 px-4 py-3 text-xs font-bold tracking-wider text-[#B57BE0]">
        {TEST_MODE_LABEL}
      </div>

      <PageHeading kicker="Pricing">Paid tiers are in test mode.</PageHeading>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/55">
        The findings are always free. Paid tiers are in TEST MODE (sandbox — no real money). Anything
        you try here uses PayPal's sandbox, never real money.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <Plan
          name="Free"
          price="$0"
          period="per user"
          features={[
            "1 full report per user",
            "Every finding visible, always",
            "Viewing any report anyone has created is always free",
          ]}
          tag="current"
        />
        <Plan
          name="Report extras"
          price="$10"
          period="one-off"
          features={[
            "1 deep-lookup credit — scans up to ~15 pages of one site (legal/pricing/about/FAQ + linked pages), claims extracted from all of them",
            "Print-ready PDF view of any report",
            "The report page itself never charges to reveal",
          ]}
          tag="test mode"
          note="The deep lookup and the print-ready PDF view are live now. In test mode the credit is granted when a sandbox capture is marked COMPLETED — no real money moves until we go live."
        >
          <CheckoutSlot status={status} kind="extras" />
        </Plan>
        <Plan
          name="Watchlist"
          price="$19"
          period="per month"
          features={[
            "Re-scans of sites you track",
            "Email when their claims change",
            "Higher scan limits and bulk scanning",
          ]}
          tag="test mode"
          note="Watchlist is NOT built yet: the email alerts need an email capability the team doesn't have. This card only exercises the sandbox checkout — no real money, and nothing is delivered."
        >
          <CheckoutSlot status={status} kind="watchlist" />
        </Plan>
      </div>

      <p className="mt-10 max-w-xl border-t border-white/10 pt-6 text-xs leading-relaxed text-white/40">
        We will never charge to reveal findings. If a status can't be evidenced, it's Unknown — on the
        free tier and the paid tiers alike.
      </p>
    </Shell>
  );
}

function CheckoutSlot({ status, kind }: { status: Status; kind: "extras" | "watchlist" }) {
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  if (status === "loading") {
    return <p className="mt-4 text-xs text-white/40">Checking checkout status…</p>;
  }
  if (status === null) {
    return (
      <p className="mt-4 text-xs text-red-300">
        Checkout status unavailable — the pricing page could not reach its own API.
      </p>
    );
  }
  if (!status.clientIdSet) {
    return (
      <p className="mt-4 text-xs text-white/40">
        Checkout not configured yet (no PayPal credentials in the environment).
      </p>
    );
  }
  if (!status.configured) {
    return (
      <div className="mt-4 space-y-2 text-xs">
        <p className="text-red-300">Checkout is not ready in test mode.</p>
        {status.error && <p className="text-white/50">{status.error}</p>}
      </div>
    );
  }

  if (kind === "extras") {
    return <ExtrasCheckout clientId={status.clientId} error={error} setError={setError} result={result} setResult={setResult} />;
  }
  if (!status.hasPlan) {
    return (
      <div className="mt-4 space-y-2 text-xs">
        <p className="text-red-300">Watchlist checkout is not ready in test mode.</p>
        {status.planError ? <p className="text-white/50">{status.planError}</p> : null}
      </div>
    );
  }
  return (
    <WatchlistCheckout
      clientId={status.clientId}
      planId={status.planId ?? ""}
      error={error}
      setError={setError}
      result={result}
      setResult={setResult}
    />
  );
}

// ---------------------------------------------------------------------------
// PayPal JS SDK helpers (client-only). TEST_MODE ensures the SDK is loaded from
// the SANDBOX host; the client id that reaches the browser is the one from the
// environment — if the sandbox rejects it, the load/request fails and the honest
// error is shown instead of a fake button.
// ---------------------------------------------------------------------------

const sdkLoads = new Map<string, Promise<void>>();

function loadSdk(namespace: string, src: string): Promise<void> {
  const cached = sdkLoads.get(src);
  if (cached) return cached;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.namespace = namespace;
    script.onload = () => {
      if ((window as unknown as Record<string, unknown>)[namespace]) resolve();
      else reject(new Error(`The PayPal SDK loaded but its ${namespace} components are unavailable.`));
    };
    script.onerror = () =>
      reject(new Error("The PayPal sandbox JS SDK could not be loaded — the configured client id is not a valid sandbox app id."));
    document.head.appendChild(script);
  });
  sdkLoads.set(src, promise);
  return promise;
}

interface CheckoutProps {
  clientId: string;
  error: string | null;
  setError: (e: string | null) => void;
  result: string | null;
  setResult: (r: string | null) => void;
}

function ExtrasCheckout({ clientId, error, setError, result, setResult }: CheckoutProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    const sdkSrc = `${PAYPAL_SDK_BASE}/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
    loadSdk("paypalOrders", sdkSrc)
      .then(() => {
        if (disposed || !ref.current) return;
        const lib = (window as Record<string, any>).paypalOrders;
        if (!lib?.Buttons) {
          setError("PayPal checkout components did not load in this configuration.");
          return;
        }
        lib.Buttons({
          style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal", tagline: false },
          createOrder: async () => {
            const r = await fetch("/api/paypal/order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tier: "report-extras" }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error ?? "Order creation failed.");
            return j.orderId as string;
          },
          onApprove: async (data: { orderID?: string }) => {
            try {
              const r = await fetch(`/api/paypal/order/${encodeURIComponent(data.orderID ?? "")}/capture`, {
                method: "POST",
              });
              const j = await r.json();
              if (!r.ok) throw new Error(j.error ?? "Capture failed.");
              setError(null);
              setResult(
                j.captureStatus === "COMPLETED"
                  ? `Sandbox payment captured: ${j.amount ?? "$10.00 USD"} (test money only).`
                  : `PayPal reports: order ${j.status}, capture ${String(j.captureStatus ?? "pending")}.`
              );
            } catch (e) {
              setResult(null);
              setError(e instanceof Error ? e.message : "Capture failed — nothing was charged.");
            }
          },
          onError: (err: unknown) => {
            setResult(null);
            setError(err instanceof Error ? err.message : "The PayPal button failed to load — checkout unavailable.");
          },
        }).render(ref.current);
      })
      .catch((e: unknown) => {
        if (!disposed) setError(e instanceof Error ? e.message : "PayPal SDK failed to load.");
      });
    return () => {
      disposed = true;
    };
  }, [clientId, setError, setResult]);

  return (
    <div className="mt-5 space-y-2">
      <div ref={ref} className="min-h-[44px]" />
      {error && <p className="text-xs text-red-300">{error}</p>}
      {result && <p className="text-xs text-green-400">{result}</p>}
      {!error && !result && <p className="text-xs text-white/35">Sandbox test payment — no real money.</p>}
    </div>
  );
}

function WatchlistCheckout({ clientId, planId, error, setError, result, setResult }: CheckoutProps & { planId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    const sdkSrc = `${PAYPAL_SDK_BASE}/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=subscription&vault=true`;
    loadSdk("paypalSubs", sdkSrc)
      .then(() => {
        if (disposed || !ref.current) return;
        const lib = (window as Record<string, any>).paypalSubs;
        if (!lib?.SubscriptionButtons) {
          setError("PayPal subscription components did not load in this configuration.");
          return;
        }
        lib.SubscriptionButtons({
          style: { label: "subscribe", shape: "rect", color: "gold" },
          createSubscription: (_data: unknown, actions: { subscription: { create: (o: { planId: string }) => Promise<string> } }) =>
            actions.subscription.create({ planId }),
          onApprove: async (data: { subscriptionID?: string }) => {
            try {
              const r = await fetch("/api/paypal/subscription", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "record", subscriptionId: data.subscriptionID ?? "" }),
              });
              const j = await r.json();
              if (!r.ok) throw new Error(j.error ?? "Recording subscription failed.");
              setError(null);
              setResult(
                `Sandbox subscription ${String(j.subscriptionId)} approved — status from PayPal: ${String(j.status)}. No real money.`
              );
            } catch (e) {
              setResult(null);
              setError(e instanceof Error ? e.message : "Recording the subscription failed.");
            }
          },
          onError: (err: unknown) => {
            setResult(null);
            setError(err instanceof Error ? err.message : "The subscription button failed to load.");
          },
        }).render(ref.current);
      })
      .catch((e: unknown) => {
        if (!disposed) setError(e instanceof Error ? e.message : "PayPal SDK failed to load.");
      });
    return () => {
      disposed = true;
    };
  }, [clientId, planId, setError, setResult]);

  return (
    <div className="mt-5 space-y-2">
      <div ref={ref} className="min-h-[44px]" />
      {error && <p className="text-xs text-red-300">{error}</p>}
      {result && <p className="text-xs text-green-400">{result}</p>}
      {!error && !result && <p className="text-xs text-white/35">Sandbox subscription — billed in test money only.</p>}
    </div>
  );
}

function Plan({
  name,
  price,
  period,
  features,
  tag,
  note,
  children,
}: {
  name: string;
  price: string;
  period: string;
  features: string[];
  tag?: string;
  /** Replaces the generic "features not built yet" note when a tier has real features. */
  note?: string;
  children?: React.ReactNode;
}) {
  const test = tag === "test mode";
  const soon = tag === "coming soon";
  return (
    <div className="panel flex flex-col bg-white/[0.03] p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-black tracking-tight text-white">{name}</h2>
        {tag &&
          (test ? (
            <span className="micro-label text-[#B57BE0]">{tag}</span>
          ) : soon ? (
            <span className="micro-label text-white/35">{tag}</span>
          ) : (
            <span className="micro-label accent-green">{tag}</span>
          ))}
      </div>
      <div className="mt-4">
        <span className="text-3xl font-black tracking-tighter text-white">{price}</span>
        <span className="ml-2 text-xs uppercase tracking-widest text-white/40">{period}</span>
      </div>
      <ul className="mt-5 space-y-3 text-xs leading-relaxed text-white/50">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className="accent-purple mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current" />
            {f}
          </li>
        ))}
      </ul>
      {children}
      {test && (
        <p className="mt-4 text-[11px] leading-relaxed text-white/35">
          {note ??
            "The features above are not built yet — in test mode this only exercises the sandbox checkout, never real money."}
        </p>
      )}
    </div>
  );
}