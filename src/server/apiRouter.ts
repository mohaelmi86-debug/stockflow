import { Router } from 'express';
import { requireAuth, type AuthRequest } from './authMiddleware.ts';
import { aiRouter } from './aiRouter.ts';
import { billingRouter } from './billingRouter.ts';
import { productSchema, stockMovementSchema } from '../shared/schemas.ts';
import { PLAN_QUOTAS } from '../shared/types.ts';

export const apiRouter = Router();

apiRouter.use('/ai', aiRouter);
apiRouter.use('/billing', billingRouter);

apiRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'StockFlow ERP API',
    phase: 7,
    timestamp: new Date().toISOString(),
  });
});

apiRouter.get('/plans', (_req, res) => {
  res.json({
    plans: Object.values(PLAN_QUOTAS),
  });
});

apiRouter.get('/docs', (_req, res) => {
  res.json({
    openapi: '3.0.3',
    info: {
      title: 'StockFlow ERP REST API',
      version: '1.0.0',
      description: 'API REST multi-tenant pour la gestion des organisations, produits, entrepôts, facturation Stripe et assistant IA.',
    },
    endpoints: [
      { method: 'GET', path: '/api/health', auth: false, description: 'État de disponibilité du serveur API (Phase 7)' },
      { method: 'GET', path: '/api/plans', auth: false, description: 'Catalogue des plans SaaS et quotas serveur' },
      { method: 'GET', path: '/api/billing/status', auth: false, description: 'Statut de configuration Stripe et catalogue tarifaire' },
      { method: 'POST', path: '/api/billing/checkout-session', auth: true, description: 'Création d’une session Stripe Checkout ou mode démo SaaS' },
      { method: 'POST', path: '/api/billing/verify-session', auth: true, description: 'Vérification d’une session Stripe Checkout finalisée' },
      { method: 'POST', path: '/api/billing/portal-session', auth: true, description: 'Ouverture du portail client Stripe' },
      { method: 'POST', path: '/api/billing/webhook', auth: false, description: 'Réception sécurisée HMAC des événements Stripe' },
      { method: 'GET', path: '/api/auth/verify', auth: true, description: 'Vérification du jeton Firebase Auth côté serveur' },
      { method: 'POST', path: '/api/validate/product', auth: true, description: 'Validation Zod et calcul marge/TVA d’un produit' },
      { method: 'POST', path: '/api/validate/movement', auth: true, description: 'Validation Zod d’un mouvement de stock traçable' },
      { method: 'POST', path: '/api/ai/chat', auth: true, description: 'Assistant IA Gemini contextuel avec tool calling et validation humaine' },
    ],
  });
});

apiRouter.get('/auth/verify', requireAuth, (req: AuthRequest, res) => {
  res.json({
    authenticated: true,
    uid: req.user?.uid,
    email: req.user?.email ?? null,
    emailVerified: req.user?.email_verified ?? false,
  });
});

apiRouter.post('/validate/product', requireAuth, (req: AuthRequest, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation produit échouée',
      issues: parsed.error.issues,
    });
  }

  const data = parsed.data;
  const marginAmount = Number((data.salePrice - data.purchasePrice).toFixed(2));
  const marginPercent = data.salePrice > 0
    ? Number((((data.salePrice - data.purchasePrice) / data.salePrice) * 100).toFixed(2))
    : 0;
  const salePriceInclVat = Number((data.salePrice * (1 + data.vatRate / 100)).toFixed(2));

  return res.json({
    valid: true,
    product: data,
    computed: {
      marginAmount,
      marginPercent,
      salePriceInclVat,
    },
  });
});

apiRouter.post('/validate/movement', requireAuth, (req: AuthRequest, res) => {
  const parsed = stockMovementSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Validation mouvement échouée',
      issues: parsed.error.issues,
    });
  }

  return res.json({
    valid: true,
    movement: parsed.data,
  });
});
