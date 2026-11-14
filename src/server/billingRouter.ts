import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { requireAuth, type AuthRequest } from './authMiddleware.ts';
import { billingCheckoutSchema } from '../shared/schemas.ts';
import { adminDb } from './firebaseAdmin.ts';
import { PLAN_QUOTAS, type BillingCycle, type PlanCode, type SubscriptionStatus } from '../shared/types.ts';

export const billingRouter = Router();

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const validId = /^[A-Za-z0-9_-]{1,128}$/;

function getStripeSecretKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY?.trim() || undefined;
}

function getStripePriceId(planCode: PlanCode, cycle: BillingCycle): string | undefined {
  if (planCode === 'starter') return undefined;
  return process.env[`STRIPE_PRICE_${planCode.toUpperCase()}_${cycle.toUpperCase()}`]?.trim() || undefined;
}

function resolveAppOrigin(): string {
  const configured = process.env.APP_URL?.trim();
  if (configured && /^https:\/\//.test(configured)) return configured.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') throw new Error('APP_URL HTTPS doit être configurée en production.');
  return 'http://localhost:3000';
}

function verifyStripeSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  const parts = signatureHeader.split(',').reduce<Record<string, string[]>>((acc, item) => {
    const [key, value] = item.split('=');
    if (key && value) (acc[key.trim()] ||= []).push(value.trim());
    return acc;
  }, {});
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  return signatures.some((signature) => {
    const candidate = Buffer.from(signature, 'hex');
    return candidate.length === expectedBuf.length && crypto.timingSafeEqual(candidate, expectedBuf);
  });
}

async function getOrgForAdmin(orgId: string, uid: string) {
  if (!validId.test(orgId)) return null;
  const [orgSnap, memberSnap] = await Promise.all([
    adminDb.doc(`organizations/${orgId}`).get(),
    adminDb.doc(`organizations/${orgId}/members/${uid}`).get(),
  ]);
  if (!orgSnap.exists || !memberSnap.exists) return null;
  const member = memberSnap.data();
  if (member?.status !== 'active' || !['owner', 'admin'].includes(member.role)) return null;
  return { ref: orgSnap.ref, data: orgSnap.data()! };
}

async function applyOrganizationPlan(params: {
  orgId: string;
  planCode: PlanCode;
  billingCycle: BillingCycle;
  subscriptionStatus: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  actorUid: string;
  summary: string;
}) {
  const orgRef = adminDb.doc(`organizations/${params.orgId}`);
  const snapshot = await orgRef.get();
  if (!snapshot.exists) throw new Error('Organisation introuvable.');
  const org = snapshot.data()!;
  const memberUids = Array.isArray(org.memberUids) ? org.memberUids : [];
  const batch = adminDb.batch();
  batch.update(orgRef, {
    plan: params.planCode,
    billingCycle: params.billingCycle,
    subscriptionStatus: params.subscriptionStatus,
    ...(params.stripeCustomerId ? { stripeCustomerId: params.stripeCustomerId } : {}),
    ...(params.stripeSubscriptionId ? { stripeSubscriptionId: params.stripeSubscriptionId } : {}),
    planUpdatedAt: new Date(),
    updatedAt: new Date(),
  });
  const logId = `billing_${crypto.randomUUID().replace(/-/g, '')}`;
  batch.set(orgRef.collection('auditLogs').doc(logId), {
    id: logId,
    orgId: params.orgId,
    actorUid: params.actorUid || 'stripe_system',
    actorEmail: 'billing@stockflow.local',
    action: 'PLAN_UPDATED',
    entityType: 'subscription',
    entityId: params.orgId,
    summary: params.summary.slice(0, 300),
    memberUids: memberUids.length ? memberUids : [String(org.ownerId)],
    createdAt: new Date(),
  });
  await batch.commit();
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
  if (!parsed.success) return res.status(400).json({ error: 'Paramètres d’abonnement invalides.', issues: parsed.error.issues });
  const { orgId, planCode, billingCycle } = parsed.data;
  const authorizedOrg = await getOrgForAdmin(orgId, req.user!.uid);
  if (!authorizedOrg) return res.status(403).json({ error: 'Droits administrateur requis pour cette organisation.' });
  if (planCode === 'starter') {
    return res.status(409).json({ error: 'Pour revenir au plan Starter, résiliez d’abord l’abonnement actif depuis le portail Stripe.' });
  }
  const secretKey = getStripeSecretKey();
  if (!secretKey) return res.status(503).json({ error: 'Souscription indisponible : Stripe n’est pas configuré sur le serveur.' });

  try {
    const plan = PLAN_QUOTAS[planCode];
    const origin = resolveAppOrigin();
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('success_url', `${origin}/parametres?tab=plans&checkout=success&session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', `${origin}/parametres?tab=plans&checkout=cancel`);
    params.append('client_reference_id', orgId);
    if (req.user?.email) params.append('customer_email', req.user.email);
    params.append('metadata[orgId]', orgId);
    params.append('metadata[planCode]', planCode);
    params.append('metadata[billingCycle]', billingCycle);
    params.append('metadata[actorUid]', req.user!.uid);
    params.append('subscription_data[metadata][orgId]', orgId);
    params.append('subscription_data[metadata][planCode]', planCode);
    params.append('subscription_data[metadata][billingCycle]', billingCycle);
    const priceId = getStripePriceId(planCode, billingCycle);
    if (priceId) {
      params.append('line_items[0][price]', priceId);
    } else {
      const amount = billingCycle === 'annual'
        ? Math.round(plan.priceMonthlyEur * 12 * 0.8) * 100
        : plan.priceMonthlyEur * 100;
      params.append('line_items[0][price_data][currency]', 'eur');
      params.append('line_items[0][price_data][unit_amount]', String(amount));
      params.append('line_items[0][price_data][recurring][interval]', billingCycle === 'annual' ? 'year' : 'month');
      params.append('line_items[0][price_data][product_data][name]', `StockFlow ERP — ${plan.name}`);
    }
    params.append('line_items[0][quantity]', '1');
    const stripeRes = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const stripeJson = await stripeRes.json() as { id?: string; url?: string; error?: { message?: string } };
    if (!stripeRes.ok || !stripeJson.url) {
      return res.status(502).json({ error: stripeJson.error?.message || 'Création Stripe Checkout impossible.' });
    }
    return res.json({ mode: 'stripe', sessionId: stripeJson.id, checkoutUrl: stripeJson.url });
  } catch (error) {
    console.error('Stripe checkout session error:', error);
    return res.status(500).json({ error: 'Impossible de créer la session Stripe.' });
  }
});

billingRouter.post('/verify-session', requireAuth, async (req: AuthRequest, res) => {
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return res.status(400).json({ error: 'Identifiant Stripe invalide.' });
  const secretKey = getStripeSecretKey();
  if (!secretKey) return res.status(503).json({ error: 'Stripe n’est pas configuré.' });

  try {
    const stripeRes = await fetch(`${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const session = await stripeRes.json() as {
      id?: string; mode?: string; status?: string; payment_status?: string;
      customer?: string; subscription?: string;
      metadata?: { orgId?: string; planCode?: PlanCode; billingCycle?: BillingCycle; actorUid?: string };
      error?: { message?: string };
    };
    if (!stripeRes.ok) return res.status(502).json({ error: session.error?.message || 'Vérification Stripe impossible.' });
    const orgId = session.metadata?.orgId;
    const planCode = session.metadata?.planCode;
    const cycle = session.metadata?.billingCycle;
    if (
      session.id !== sessionId || session.mode !== 'subscription' || session.status !== 'complete' ||
      !['paid', 'no_payment_required'].includes(session.payment_status || '') ||
      !orgId || !planCode || !PLAN_QUOTAS[planCode] || !cycle ||
      !['monthly', 'annual'].includes(cycle) || session.metadata?.actorUid !== req.user!.uid
    ) {
      return res.status(400).json({ verified: false, error: 'Session non payée ou métadonnées non valides pour cet utilisateur.' });
    }
    const authorizedOrg = await getOrgForAdmin(orgId, req.user!.uid);
    if (!authorizedOrg) return res.status(403).json({ verified: false, error: 'Vous ne disposez plus des droits administrateur sur cette organisation.' });
    if (typeof session.subscription !== 'string' || typeof session.customer !== 'string') {
      return res.status(400).json({ verified: false, error: 'Abonnement ou client Stripe manquant.' });
    }
    const subRes = await fetch(`${STRIPE_API_BASE}/subscriptions/${encodeURIComponent(session.subscription)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const subscription = await subRes.json() as { status?: string; metadata?: Record<string, string>; error?: { message?: string } };
    if (!subRes.ok || !['active', 'trialing'].includes(subscription.status || '')) {
      return res.status(400).json({ verified: false, error: subscription.error?.message || 'Abonnement Stripe non actif.' });
    }
    await applyOrganizationPlan({
      orgId, planCode, billingCycle: cycle, subscriptionStatus: subscription.status as SubscriptionStatus,
      stripeCustomerId: session.customer, stripeSubscriptionId: session.subscription,
      actorUid: req.user!.uid, summary: `Abonnement Stripe confirmé : plan ${planCode.toUpperCase()}.`,
    });
    return res.json({ verified: true, orgId, planCode, billingCycle: cycle });
  } catch (error) {
    console.error('Stripe session verification error:', error);
    return res.status(500).json({ verified: false, error: 'Erreur lors de la vérification ou de l’activation Stripe.' });
  }
});

billingRouter.post('/portal-session', requireAuth, async (req: AuthRequest, res) => {
  const orgId = typeof req.body?.orgId === 'string' ? req.body.orgId.trim() : '';
  const authorizedOrg = await getOrgForAdmin(orgId, req.user!.uid);
  if (!authorizedOrg) return res.status(403).json({ error: 'Droits administrateur requis pour cette organisation.' });
  const stripeCustomerId = authorizedOrg.data.stripeCustomerId;
  if (typeof stripeCustomerId !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(stripeCustomerId)) {
    return res.status(404).json({ error: 'Client Stripe introuvable pour cette organisation.' });
  }
  const secretKey = getStripeSecretKey();
  if (!secretKey) return res.status(503).json({ error: 'Stripe n’est pas configuré.' });

  try {
    const params = new URLSearchParams();
    params.append('customer', stripeCustomerId);
    params.append('return_url', `${resolveAppOrigin()}/parametres?tab=plans`);
    const stripeRes = await fetch(`${STRIPE_API_BASE}/billing_portal/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const result = await stripeRes.json() as { url?: string; error?: { message?: string } };
    if (!stripeRes.ok || !result.url) return res.status(502).json({ error: result.error?.message || 'Portail Stripe indisponible.' });
    return res.json({ portalUrl: result.url });
  } catch (error) {
    console.error('Stripe portal session error:', error);
    return res.status(500).json({ error: 'Erreur lors de la création du portail Stripe.' });
  }
});

billingRouter.post('/webhook', async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const signature = req.header('stripe-signature') || '';
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!secret) return res.status(503).json({ received: false, error: 'STRIPE_WEBHOOK_SECRET non configuré.' });
  if (!rawBody || !signature || !verifyStripeSignature(rawBody, signature, secret)) {
    return res.status(400).json({ error: 'Signature Stripe invalide.' });
  }
  const event = req.body as { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  if (!event.id || !event.type || !event.data?.object) return res.status(400).json({ error: 'Événement Stripe incomplet.' });

  try {
    const eventRef = adminDb.doc(`stripeWebhookEvents/${event.id.replace(/[^A-Za-z0-9_-]/g, '_')}`);
    if ((await eventRef.get()).exists) return res.json({ received: true, duplicate: true });
    const object = event.data.object;
    const metadata = (object.metadata || {}) as Record<string, string>;
    let orgId = metadata.orgId;
    let planCode = metadata.planCode as PlanCode | undefined;
    let cycle = metadata.billingCycle as BillingCycle | undefined;
    const customerId = typeof object.customer === 'string' ? object.customer : undefined;
    const subscriptionId = event.type.startsWith('customer.subscription.') && typeof object.id === 'string'
      ? object.id
      : typeof object.subscription === 'string' ? object.subscription : undefined;
    let status: SubscriptionStatus = 'active';

    if (event.type === 'checkout.session.completed') {
      if (object.mode !== 'subscription' || object.status !== 'complete' ||
          !['paid', 'no_payment_required'].includes(String(object.payment_status))) {
        return res.status(400).json({ error: 'Checkout non finalisé.' });
      }
      if (subscriptionId) {
        const subResponse = await fetch(`${STRIPE_API_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
          headers: { Authorization: `Bearer ${secret}` },
        });
        const sub = await subResponse.json() as { status?: string; metadata?: Record<string, string> };
        if (!subResponse.ok || !['active', 'trialing'].includes(sub.status || '')) return res.status(400).json({ error: 'Abonnement non actif.' });
        status = sub.status as SubscriptionStatus;
        planCode ||= sub.metadata?.planCode as PlanCode;
        cycle ||= sub.metadata?.billingCycle as BillingCycle;
        orgId ||= sub.metadata?.orgId;
      }
    } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const stripeStatus = String(object.status || (event.type.endsWith('.deleted') ? 'canceled' : 'active'));
      status = ['active', 'trialing', 'past_due', 'canceled'].includes(stripeStatus)
        ? stripeStatus as SubscriptionStatus
        : 'canceled';
      if (status === 'canceled') planCode = 'starter';
    } else {
      await eventRef.create({ type: event.type, receivedAt: new Date(), ignored: true });
      return res.json({ received: true, ignored: true });
    }

    if (!orgId && customerId) {
      const orgs = await adminDb.collection('organizations').where('stripeCustomerId', '==', customerId).limit(1).get();
      orgId = orgs.docs[0]?.id;
    }
    if (!orgId && subscriptionId) {
      const orgs = await adminDb.collection('organizations').where('stripeSubscriptionId', '==', subscriptionId).limit(1).get();
      orgId = orgs.docs[0]?.id;
    }
    if (!orgId || !validId.test(orgId) || !planCode || !PLAN_QUOTAS[planCode]) {
      await eventRef.create({ type: event.type, receivedAt: new Date(), ignored: true, reason: 'Organisation ou plan introuvable' });
      return res.json({ received: true, ignored: true });
    }
    await applyOrganizationPlan({
      orgId, planCode, billingCycle: cycle === 'annual' ? 'annual' : 'monthly', subscriptionStatus: status,
      stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId,
      actorUid: 'stripe_system', summary: `Événement Stripe ${event.type} synchronisé.`,
    });
    await eventRef.create({ type: event.type, orgId, receivedAt: new Date(), processed: true });
    return res.json({ received: true, processed: true });
  } catch (error) {
    console.error('Stripe webhook processing error:', error);
    return res.status(500).json({ error: 'Échec de traitement du webhook Stripe.' });
  }
});
