import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { requireAuth, type AuthRequest } from './authMiddleware.ts';
import { billingCheckoutSchema } from '../shared/schemas.ts';
import { PLAN_QUOTAS, type BillingCycle, type PlanCode } from '../shared/types.ts';

export const billingRouter = Router();

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

function getStripeSecretKey(): string | undefined {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

function getStripePriceId(planCode: PlanCode, cycle: BillingCycle): string | undefined {
  if (planCode === 'starter') return undefined;
  const envKey = `STRIPE_PRICE_${planCode.toUpperCase()}_${cycle.toUpperCase()}`;
  const val = process.env[envKey]?.trim();
  return val && val.length > 0 ? val : undefined;
}

function resolveAppOrigin(req: Request): string {
  const envAppUrl = process.env.APP_URL?.trim();
  if (envAppUrl && /^https?:\/\//.test(envAppUrl)) {
    return envAppUrl.replace(/\/+$/, '');
  }
  const proto = req.header('x-forwarded-proto') || req.protocol || 'http';
  const host = req.header('x-forwarded-host') || req.header('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

function verifyStripeSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const parts = signatureHeader.split(',').reduce<Record<string, string[]>>((acc, item) => {
    const [k, v] = item.split('=');
    if (k && v) {
      acc[k.trim()] = acc[k.trim()] || [];
      acc[k.trim()].push(v.trim());
    }
    return acc;
  }, {});

  const timestamp = parts['t']?.[0];
  const signatures = parts['v1'] || [];
  if (!timestamp || signatures.length === 0) return false;

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
    return false;
  }

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  return signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

billingRouter.get('/status', (_req, res) => {
  res.json({
    stripeConfigured: Boolean(getStripeSecretKey()),
    webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
    annualDiscountPct: 20,
    plans: Object.values(PLAN_QUOTAS),
  });
});

billingRouter.post('/checkout-session', requireAuth, async (req: AuthRequest, res) => {
  const parsed = billingCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Paramètres d’abonnement invalides.',
      issues: parsed.error.issues,
    });
  }

  const { orgId, orgName, planCode, billingCycle, customerEmail } = parsed.data;
  const plan = PLAN_QUOTAS[planCode];

  if (planCode === 'starter') {
    return res.json({
      mode: 'free',
      planCode: 'starter',
      billingCycle,
      message: 'Le plan Starter est gratuit et activable immédiatement sans paiement.',
    });
  }

  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    return res.json({
      mode: 'sandbox',
      planCode,
      billingCycle,
      amountEur:
        billingCycle === 'annual'
          ? Math.round(plan.priceMonthlyEur * 12 * 0.8)
          : plan.priceMonthlyEur,
      message:
        'STRIPE_SECRET_KEY non configurée sur le serveur : vous pouvez activer ce plan en mode démonstration SaaS ou renseigner votre clé Stripe dans les Secrets.',
    });
  }

  try {
    const origin = resolveAppOrigin(req);
    const successUrl = `${origin}/parametres?tab=plans&checkout=success&session_id={CHECKOUT_SESSION_ID}&plan=${planCode}&cycle=${billingCycle}`;
    const cancelUrl = `${origin}/parametres?tab=plans&checkout=cancel`;

    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('success_url', successUrl);
    params.append('cancel_url', cancelUrl);
    params.append('client_reference_id', orgId);
    if (customerEmail || req.user?.email) {
      params.append('customer_email', customerEmail || req.user?.email || '');
    }
    params.append('metadata[orgId]', orgId);
    params.append('metadata[orgName]', orgName);
    params.append('metadata[planCode]', planCode);
    params.append('metadata[billingCycle]', billingCycle);
    params.append('metadata[actorUid]', req.user?.uid ?? '');

    const configuredPriceId = getStripePriceId(planCode, billingCycle);
    if (configuredPriceId) {
      params.append('line_items[0][price]', configuredPriceId);
      params.append('line_items[0][quantity]', '1');
    } else {
      const unitAmountCents =
        billingCycle === 'annual'
          ? Math.round(plan.priceMonthlyEur * 12 * 0.8) * 100
          : plan.priceMonthlyEur * 100;
      params.append('line_items[0][price_data][currency]', 'eur');
      params.append('line_items[0][price_data][unit_amount]', String(unitAmountCents));
      params.append(
        'line_items[0][price_data][recurring][interval]',
        billingCycle === 'annual' ? 'year' : 'month'
      );
      params.append(
        'line_items[0][price_data][product_data][name]',
        `StockFlow ERP — Plan ${plan.name} (${billingCycle === 'annual' ? 'Annuel -20%' : 'Mensuel'})`
      );
      params.append(
        'line_items[0][price_data][product_data][description]',
        `${plan.maxUsers} utilisateurs · ${plan.maxWarehouses} entrepôt(s) · ${plan.maxProducts.toLocaleString('fr-FR')} produits`
      );
      params.append('line_items[0][quantity]', '1');
    }

    const stripeRes = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const stripeJson = (await stripeRes.json()) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };

    if (!stripeRes.ok || !stripeJson.url) {
      return res.status(502).json({
        error: stripeJson.error?.message || 'Erreur lors de la création de la session Stripe Checkout.',
      });
    }

    return res.json({
      mode: 'stripe',
      sessionId: stripeJson.id,
      checkoutUrl: stripeJson.url,
    });
  } catch (err) {
    console.error('Stripe checkout session error:', err);
    return res.status(500).json({
      error: 'Impossible de contacter Stripe Checkout pour le moment.',
    });
  }
});

billingRouter.post('/verify-session', requireAuth, async (req: AuthRequest, res) => {
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
  if (!sessionId || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
    return res.status(400).json({ error: 'Identifiant de session Stripe invalide.' });
  }

  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    return res.status(400).json({ error: 'STRIPE_SECRET_KEY non configurée sur le serveur.' });
  }

  try {
    const stripeRes = await fetch(`${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    });
    const session = (await stripeRes.json()) as {
      id?: string;
      status?: string;
      payment_status?: string;
      customer?: string;
      subscription?: string;
      metadata?: {
        orgId?: string;
        planCode?: PlanCode;
        billingCycle?: BillingCycle;
      };
      error?: { message?: string };
    };

    if (!stripeRes.ok) {
      return res.status(502).json({
        error: session.error?.message || 'Vérification Stripe impossible.',
      });
    }

    const paid = session.payment_status === 'paid' || session.status === 'complete';
    return res.json({
      verified: paid,
      orgId: session.metadata?.orgId,
      planCode: session.metadata?.planCode,
      billingCycle: session.metadata?.billingCycle ?? 'monthly',
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
      stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : undefined,
    });
  } catch (err) {
    console.error('Stripe session verification error:', err);
    return res.status(500).json({ error: 'Erreur réseau lors de la vérification Stripe.' });
  }
});

billingRouter.post('/portal-session', requireAuth, async (req: AuthRequest, res) => {
  const stripeCustomerId =
    typeof req.body?.stripeCustomerId === 'string' ? req.body.stripeCustomerId.trim() : '';
  if (!stripeCustomerId || !/^cus_[a-zA-Z0-9]+$/.test(stripeCustomerId)) {
    return res.status(400).json({ error: 'Identifiant client Stripe introuvable pour cette organisation.' });
  }

  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    return res.status(400).json({ error: 'STRIPE_SECRET_KEY non configurée sur le serveur.' });
  }

  try {
    const origin = resolveAppOrigin(req);
    const params = new URLSearchParams();
    params.append('customer', stripeCustomerId);
    params.append('return_url', `${origin}/parametres?tab=plans`);

    const stripeRes = await fetch(`${STRIPE_API_BASE}/billing_portal/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const portalJson = (await stripeRes.json()) as {
      url?: string;
      error?: { message?: string };
    };

    if (!stripeRes.ok || !portalJson.url) {
      return res.status(502).json({
        error: portalJson.error?.message || 'Impossible d’ouvrir le portail client Stripe.',
      });
    }

    return res.json({ portalUrl: portalJson.url });
  } catch (err) {
    console.error('Stripe billing portal error:', err);
    return res.status(500).json({ error: 'Erreur lors de la création du portail Stripe.' });
  }
});

billingRouter.post('/webhook', (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const signatureHeader = req.header('stripe-signature') || '';
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (!webhookSecret) {
    return res.status(503).json({
      received: false,
      error: 'STRIPE_WEBHOOK_SECRET non configuré.',
    });
  }

  if (!rawBody || !signatureHeader || !verifyStripeSignature(rawBody, signatureHeader, webhookSecret)) {
    return res.status(400).json({ error: 'Signature Stripe Webhook invalide.' });
  }

  const event = req.body as { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  console.log(`Stripe webhook verified: ${event.type ?? 'unknown'} (${event.id ?? 'no-id'})`);

  return res.json({ received: true, eventType: event.type ?? null });
});
