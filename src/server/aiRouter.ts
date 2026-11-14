import { Router } from 'express';
import {
  GoogleGenAI,
  Type,
  type Content,
  type FunctionDeclaration,
} from '@google/genai';
import { z } from 'zod';
import { requireAuth, type AuthRequest } from './authMiddleware.ts';
import type {
  AiActionProposal,
  AiChatResponse,
  AiOrgContext,
  AiPurchaseProposalLine,
} from '../shared/aiTypes.ts';
import type { MovementType } from '../shared/types.ts';

export const aiRouter = Router();

const AI_MODEL = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Clé API Gemini manquante sur le serveur. Vérifiez la configuration dans Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const aiRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(8000),
      })
    )
    .max(20)
    .default([]),
  orgContext: z.object({
    orgId: z.string().min(1).max(128),
    orgName: z.string().min(1).max(160),
    currency: z.enum(['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'MAD', 'XOF']),
    userRole: z.enum(['owner', 'admin', 'manager', 'operator', 'viewer']),
    products: z.array(z.any()).max(400),
    warehouses: z.array(z.any()).max(100),
    locations: z.array(z.any()).max(500),
    balances: z.array(z.any()).max(800),
    suppliers: z.array(z.any()).max(200),
    openPurchaseOrders: z.array(z.any()).max(100),
    openSalesOrders: z.array(z.any()).max(100),
    unpaidSalesInvoices: z.array(z.any()).max(150),
    recentMovements: z.array(z.any()).max(100),
  }),
});

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'analyze_stock_risks',
    description:
      'Analyse les niveaux de stock réels de l’organisation : ruptures (dispo <= 0), produits sous seuil minimum, surstocks et quantités suggérées de réapprovisionnement.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        warehouseFilter: {
          type: Type.STRING,
          description: 'Code ou ID d’entrepôt optionnel pour filtrer l’analyse.',
        },
      },
    },
  },
  {
    name: 'analyze_commercial_and_cashflow',
    description:
      'Analyse les factures clients impayées ou en retard, les commandes clients/fournisseurs en cours et les marges unitaires des produits.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        focus: {
          type: Type.STRING,
          description: 'Cible optionnelle : invoices, orders, margins ou all.',
        },
      },
    },
  },
  {
    name: 'propose_purchase_request',
    description:
      'Prépare une proposition structurée de Demande d’Achat (DA) pour réapprovisionner un ou plusieurs produits. N’écrit rien en base : l’utilisateur devra confirmer manuellement.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'Titre court et clair de la demande d’achat.',
        },
        warehouseIdOrCode: {
          type: Type.STRING,
          description: 'ID ou code de l’entrepôt de destination (ex. WH-PAR).',
        },
        priority: {
          type: Type.STRING,
          description: 'Priorité : normal ou urgent.',
        },
        notes: {
          type: Type.STRING,
          description: 'Justification opérationnelle de la demande.',
        },
        lines: {
          type: Type.ARRAY,
          description: 'Lignes de produits à réapprovisionner.',
          items: {
            type: Type.OBJECT,
            properties: {
              productIdOrSku: {
                type: Type.STRING,
                description: 'ID ou code SKU exact du produit.',
              },
              quantity: {
                type: Type.NUMBER,
                description: 'Quantité entière positive à commander.',
              },
            },
            required: ['productIdOrSku', 'quantity'],
          },
        },
      },
      required: ['title', 'lines'],
    },
  },
  {
    name: 'propose_stock_movement',
    description:
      'Prépare une proposition de mouvement de stock traçable (IN, OUT, TRANSFER, ADJUSTMENT) qui devra être confirmée manuellement par l’utilisateur.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        movementType: {
          type: Type.STRING,
          description: 'Type : IN, OUT, TRANSFER ou ADJUSTMENT.',
        },
        productIdOrSku: {
          type: Type.STRING,
          description: 'ID ou code SKU exact du produit.',
        },
        warehouseIdOrCode: {
          type: Type.STRING,
          description: 'ID ou code de l’entrepôt source.',
        },
        locationIdOrCode: {
          type: Type.STRING,
          description: 'ID ou code de l’emplacement source (optionnel).',
        },
        targetWarehouseIdOrCode: {
          type: Type.STRING,
          description: 'ID ou code de l’entrepôt destination (requis pour TRANSFER).',
        },
        targetLocationIdOrCode: {
          type: Type.STRING,
          description: 'ID ou code de l’emplacement destination (optionnel pour TRANSFER).',
        },
        quantity: {
          type: Type.NUMBER,
          description: 'Quantité concernée par le mouvement.',
        },
        reason: {
          type: Type.STRING,
          description: 'Motif métier explicite du mouvement.',
        },
      },
      required: ['movementType', 'productIdOrSku', 'quantity', 'reason'],
    },
  },
];

function computeStockRisks(ctx: AiOrgContext, warehouseFilter?: string) {
  const whMatch = warehouseFilter
    ? ctx.warehouses.find(
        (w) =>
          w.id === warehouseFilter ||
          w.code.toLowerCase() === warehouseFilter.toLowerCase() ||
          w.name.toLowerCase().includes(warehouseFilter.toLowerCase())
      )
    : undefined;

  const filteredBalances = whMatch
    ? ctx.balances.filter((b) => b.warehouseId === whMatch.id)
    : ctx.balances;

  const qtyByProd = new Map<string, { physical: number; reserved: number; available: number; value: number }>();
  for (const b of filteredBalances) {
    const prev = qtyByProd.get(b.productId) ?? { physical: 0, reserved: 0, available: 0, value: 0 };
    qtyByProd.set(b.productId, {
      physical: prev.physical + b.physicalQty,
      reserved: prev.reserved + b.reservedQty,
      available: prev.available + b.availableQty,
      value: prev.value + b.physicalQty * b.unitCost,
    });
  }

  const activeProducts = ctx.products.filter((p) => p.status === 'active');
  const outOfStock = [];
  const lowStock = [];
  const overStock = [];
  let totalStockValue = 0;

  for (const p of activeProducts) {
    const agg = qtyByProd.get(p.id) ?? { physical: 0, reserved: 0, available: 0, value: 0 };
    totalStockValue += agg.value;
    const suggestedQty = Math.max(1, (p.maxStock > p.minStock ? p.maxStock : p.minStock * 2) - agg.available);
    if (agg.available <= 0) {
      outOfStock.push({
        id: p.id,
        sku: p.sku,
        name: p.name,
        availableQty: agg.available,
        minStock: p.minStock,
        suggestedReorderQty: suggestedQty,
        unitCost: p.purchasePrice,
      });
    } else if (agg.available <= p.minStock) {
      lowStock.push({
        id: p.id,
        sku: p.sku,
        name: p.name,
        availableQty: agg.available,
        minStock: p.minStock,
        suggestedReorderQty: suggestedQty,
        unitCost: p.purchasePrice,
      });
    } else if (p.maxStock > 0 && agg.physical > p.maxStock) {
      overStock.push({
        id: p.id,
        sku: p.sku,
        name: p.name,
        physicalQty: agg.physical,
        maxStock: p.maxStock,
        excessQty: agg.physical - p.maxStock,
      });
    }
  }

  return {
    scope: whMatch ? `${whMatch.code} — ${whMatch.name}` : 'Tous les entrepôts',
    currency: ctx.currency,
    totalStockValue: Number(totalStockValue.toFixed(2)),
    activeProductsCount: activeProducts.length,
    outOfStockCount: outOfStock.length,
    lowStockCount: lowStock.length,
    overStockCount: overStock.length,
    outOfStock: outOfStock.slice(0, 20),
    lowStock: lowStock.slice(0, 20),
    overStock: overStock.slice(0, 15),
  };
}

function computeCommercialAndCashflow(ctx: AiOrgContext) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const unpaidTotal = ctx.unpaidSalesInvoices.reduce((s, inv) => s + inv.remainingTtc, 0);
  const overdueInvoices = ctx.unpaidSalesInvoices.filter((inv) => inv.dueDate && inv.dueDate < todayIso);
  const overdueTotal = overdueInvoices.reduce((s, inv) => s + inv.remainingTtc, 0);

  const productMargins = ctx.products
    .filter((p) => p.status === 'active' && p.salePrice > 0)
    .map((p) => ({
      sku: p.sku,
      name: p.name,
      purchasePrice: p.purchasePrice,
      salePrice: p.salePrice,
      marginUnit: Number((p.salePrice - p.purchasePrice).toFixed(2)),
      marginPct: Number((((p.salePrice - p.purchasePrice) / p.salePrice) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.marginPct - a.marginPct);

  return {
    currency: ctx.currency,
    unpaidInvoicesCount: ctx.unpaidSalesInvoices.length,
    unpaidTotalTtc: Number(unpaidTotal.toFixed(2)),
    overdueInvoicesCount: overdueInvoices.length,
    overdueTotalTtc: Number(overdueTotal.toFixed(2)),
    unpaidInvoices: ctx.unpaidSalesInvoices.slice(0, 15),
    openSalesOrdersCount: ctx.openSalesOrders.length,
    openSalesOrders: ctx.openSalesOrders.slice(0, 10),
    openPurchaseOrdersCount: ctx.openPurchaseOrders.length,
    openPurchaseOrders: ctx.openPurchaseOrders.slice(0, 10),
    topMarginProducts: productMargins.slice(0, 8),
    lowestMarginProducts: productMargins.slice(-5).reverse(),
  };
}

function findProduct(ctx: AiOrgContext, idOrSku: string) {
  const key = idOrSku.trim().toLowerCase();
  return (
    ctx.products.find((p) => p.id.toLowerCase() === key) ??
    ctx.products.find((p) => p.sku.toLowerCase() === key) ??
    ctx.products.find((p) => p.name.toLowerCase().includes(key))
  );
}

function findWarehouse(ctx: AiOrgContext, idOrCode?: string) {
  if (!idOrCode) {
    return ctx.warehouses.find((w) => w.status === 'active') ?? ctx.warehouses[0];
  }
  const key = idOrCode.trim().toLowerCase();
  return (
    ctx.warehouses.find((w) => w.id.toLowerCase() === key) ??
    ctx.warehouses.find((w) => w.code.toLowerCase() === key) ??
    ctx.warehouses.find((w) => w.name.toLowerCase().includes(key)) ??
    ctx.warehouses.find((w) => w.status === 'active') ??
    ctx.warehouses[0]
  );
}

function findLocation(ctx: AiOrgContext, warehouseId: string, idOrCode?: string) {
  const whLocs = ctx.locations.filter((l) => l.warehouseId === warehouseId);
  if (whLocs.length === 0) return undefined;
  if (!idOrCode) {
    return whLocs.find((l) => l.zoneType === 'storage') ?? whLocs[0];
  }
  const key = idOrCode.trim().toLowerCase();
  return (
    whLocs.find((l) => l.id.toLowerCase() === key) ??
    whLocs.find((l) => l.code.toLowerCase() === key) ??
    whLocs[0]
  );
}

aiRouter.post('/chat', requireAuth, async (req: AuthRequest, res) => {
  const parsed = aiRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Requête assistant IA invalide.',
      issues: parsed.error.issues,
    });
  }

  let ai: GoogleGenAI;
  try {
    ai = getGeminiClient();
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Client Gemini indisponible.',
    });
  }

  const { message, history, orgContext } = parsed.data;
  const ctx = orgContext as AiOrgContext;

  const compactContextSummary = {
    organisation: ctx.orgName,
    devise: ctx.currency,
    roleUtilisateur: ctx.userRole,
    compteurs: {
      produits: ctx.products.length,
      entrepots: ctx.warehouses.length,
      emplacements: ctx.locations.length,
      soldesStock: ctx.balances.length,
      fournisseurs: ctx.suppliers.length,
      commandesAchatOuvertes: ctx.openPurchaseOrders.length,
      commandesVenteOuvertes: ctx.openSalesOrders.length,
      facturesImpayees: ctx.unpaidSalesInvoices.length,
    },
    entrepots: ctx.warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name })),
    emplacementsParEntrepot: ctx.locations.slice(0, 60).map((l) => ({
      id: l.id,
      warehouseId: l.warehouseId,
      code: l.code,
      zoneType: l.zoneType,
    })),
    produitsCatalogue: ctx.products.slice(0, 80).map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      minStock: p.minStock,
      maxStock: p.maxStock,
      purchasePrice: p.purchasePrice,
      salePrice: p.salePrice,
    })),
    mouvementsRecents: ctx.recentMovements.slice(0, 12),
  };

  const systemInstruction = [
    'Tu es l’assistant IA opérationnel de StockFlow ERP, expert en gestion des stocks, achats, ventes et trésorerie.',
    'Réponds toujours en français professionnel, de façon concise, structurée et exploitable.',
    'Appuie-toi exclusivement sur les données réelles de l’organisation fournies dans le contexte et via les outils. N’invente jamais de SKU, quantité, facture ou entrepôt.',
    'Pour analyser les ruptures, seuils bas, surstocks, factures impayées ou marges, appelle les outils d’analyse appropriés.',
    'Lorsque l’utilisateur demande de préparer un réapprovisionnement, une demande d’achat, une entrée, une sortie, un transfert ou un ajustement de stock, appelle propose_purchase_request ou propose_stock_movement.',
    'RÈGLE CRITIQUE : Tu ne modifies jamais directement la base de données. Indique explicitement à l’utilisateur qu’une proposition d’action a été préparée ci-dessous et qu’elle requiert sa confirmation manuelle avant exécution.',
    `Contexte actif de l’organisation (${ctx.orgName}) : ${JSON.stringify(compactContextSummary)}`,
  ].join('\n');

  const contents: Content[] = [
    ...history.map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.text }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ];

  const toolTrace: string[] = [];
  const proposals: AiActionProposal[] = [];

  try {
    let finalText = '';

    for (let turn = 0; turn < 4; turn++) {
      const response = await ai.models.generateContent({
        model: AI_MODEL,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: toolDeclarations }],
        },
      });

      const functionCalls = response.functionCalls;
      const modelContent = response.candidates?.[0]?.content;

      if (!functionCalls || functionCalls.length === 0) {
        finalText = response.text?.trim() || 'Analyse terminée.';
        break;
      }

      if (modelContent) {
        contents.push(modelContent);
      }

      const responseParts = [];
      for (const call of functionCalls) {
        const toolName = call.name || 'unknown_tool';
        if (!toolTrace.includes(toolName)) {
          toolTrace.push(toolName);
        }
        const args = (call.args ?? {}) as Record<string, unknown>;
        let toolOutput: Record<string, unknown> = {};

        if (toolName === 'analyze_stock_risks') {
          toolOutput = computeStockRisks(
            ctx,
            typeof args.warehouseFilter === 'string' ? args.warehouseFilter : undefined
          );
        } else if (toolName === 'analyze_commercial_and_cashflow') {
          toolOutput = computeCommercialAndCashflow(ctx);
        } else if (toolName === 'propose_purchase_request') {
          const wh = findWarehouse(
            ctx,
            typeof args.warehouseIdOrCode === 'string' ? args.warehouseIdOrCode : undefined
          );
          const rawLines = Array.isArray(args.lines) ? args.lines : [];
          const resolvedLines: AiPurchaseProposalLine[] = [];

          for (const raw of rawLines) {
            if (!raw || typeof raw !== 'object') continue;
            const item = raw as Record<string, unknown>;
            const prod = findProduct(ctx, String(item.productIdOrSku ?? ''));
            const qty = Math.max(1, Math.round(Number(item.quantity ?? 1)));
            if (prod) {
              resolvedLines.push({
                productId: prod.id,
                productSku: prod.sku,
                productName: prod.name,
                unit: prod.unit,
                quantity: qty,
                estimatedUnitCost: prod.purchasePrice,
              });
            }
          }

          if (!wh || resolvedLines.length === 0) {
            toolOutput = {
              status: 'error',
              message:
                'Impossible de préparer la demande d’achat : entrepôt ou produits introuvables dans le catalogue.',
            };
          } else {
            const totalEstimatedCost = Number(
              resolvedLines
                .reduce((sum, l) => sum + l.quantity * l.estimatedUnitCost, 0)
                .toFixed(2)
            );
            const proposal: AiActionProposal = {
              id: `prop_pr_${Date.now()}_${proposals.length + 1}`,
              kind: 'purchase_request',
              status: 'pending',
              title: String(args.title || 'Réapprovisionnement recommandé par IA').slice(0, 120),
              priority: args.priority === 'urgent' ? 'urgent' : 'normal',
              warehouseId: wh.id,
              warehouseName: wh.name,
              notes: String(args.notes || 'Proposition générée par l’Assistant IA StockFlow').slice(0, 400),
              lines: resolvedLines,
              totalEstimatedCost,
            };
            proposals.push(proposal);
            toolOutput = {
              status: 'pending_user_confirmation',
              proposalId: proposal.id,
              warehouse: `${wh.code} — ${wh.name}`,
              linesCount: resolvedLines.length,
              totalEstimatedCost,
            };
          }
        } else if (toolName === 'propose_stock_movement') {
          const prod = findProduct(ctx, String(args.productIdOrSku ?? ''));
          const wh = findWarehouse(
            ctx,
            typeof args.warehouseIdOrCode === 'string' ? args.warehouseIdOrCode : undefined
          );
          const loc = wh
            ? findLocation(
                ctx,
                wh.id,
                typeof args.locationIdOrCode === 'string' ? args.locationIdOrCode : undefined
              )
            : undefined;
          const mTypeRaw = String(args.movementType ?? 'IN').toUpperCase();
          const mType: MovementType =
            mTypeRaw === 'OUT' || mTypeRaw === 'TRANSFER' || mTypeRaw === 'ADJUSTMENT'
              ? mTypeRaw
              : 'IN';
          const qty = Number(args.quantity ?? 0);

          let tgtWh = undefined;
          let tgtLoc = undefined;
          if (mType === 'TRANSFER') {
            tgtWh = findWarehouse(
              ctx,
              typeof args.targetWarehouseIdOrCode === 'string'
                ? args.targetWarehouseIdOrCode
                : undefined
            );
            if (tgtWh) {
              tgtLoc = findLocation(
                ctx,
                tgtWh.id,
                typeof args.targetLocationIdOrCode === 'string'
                  ? args.targetLocationIdOrCode
                  : undefined
              );
            }
          }

          if (!prod || !wh || !loc || !Number.isFinite(qty) || qty === 0) {
            toolOutput = {
              status: 'error',
              message:
                'Paramètres incomplets pour le mouvement de stock (produit, entrepôt, emplacement ou quantité).',
            };
          } else if (mType === 'TRANSFER' && (!tgtWh || !tgtLoc)) {
            toolOutput = {
              status: 'error',
              message: 'Entrepôt ou emplacement de destination introuvable pour le transfert.',
            };
          } else {
            const bal = ctx.balances.find(
              (b) => b.productId === prod.id && b.warehouseId === wh.id && b.locationId === loc.id
            );
            const proposal: AiActionProposal = {
              id: `prop_mvt_${Date.now()}_${proposals.length + 1}`,
              kind: 'stock_movement',
              status: 'pending',
              movementType: mType,
              productId: prod.id,
              productSku: prod.sku,
              productName: prod.name,
              warehouseId: wh.id,
              warehouseName: wh.name,
              locationId: loc.id,
              locationCode: loc.code,
              ...(tgtWh ? { targetWarehouseId: tgtWh.id, targetWarehouseName: tgtWh.name } : {}),
              ...(tgtLoc ? { targetLocationId: tgtLoc.id, targetLocationCode: tgtLoc.code } : {}),
              quantity: mType === 'ADJUSTMENT' ? qty : Math.abs(qty),
              unitCost: bal?.unitCost ?? prod.purchasePrice,
              reason: String(args.reason || 'Action proposée par l’Assistant IA').slice(0, 260),
            };
            proposals.push(proposal);
            toolOutput = {
              status: 'pending_user_confirmation',
              proposalId: proposal.id,
              movementType: mType,
              sku: prod.sku,
              quantity: proposal.quantity,
              source: `${wh.code} / ${loc.code}`,
              ...(tgtWh && tgtLoc ? { target: `${tgtWh.code} / ${tgtLoc.code}` } : {}),
            };
          }
        }

        responseParts.push({
          functionResponse: {
            id: call.id,
            name: toolName,
            response: toolOutput,
          },
        });
      }

      contents.push({
        role: 'user',
        parts: responseParts,
      });
    }

    if (!finalText) {
      finalText =
        'L’analyse a été préparée. Vérifiez les propositions d’action ci-dessous avant de confirmer.';
    }

    const payload: AiChatResponse = {
      reply: finalText,
      toolTrace,
      proposals,
      model: AI_MODEL,
    };

    return res.json(payload);
  } catch (err) {
    console.error('Gemini API error:', err);
    const rawMsg = err instanceof Error ? err.message : String(err);
    if (/PERMISSION_DENIED|API_KEY_INVALID|403|400/.test(rawMsg)) {
      return res.status(502).json({
        error:
          'Erreur d’authentification avec l’API Gemini. Vérifiez votre clé API dans le panneau Settings > Secrets.',
      });
    }
    if (/RESOURCE_EXHAUSTED|429/.test(rawMsg)) {
      return res.status(429).json({
        error:
          'Quota Gemini temporairement saturé. Réessayez dans quelques instants ou vérifiez votre clé dans Settings > Secrets.',
      });
    }
    return res.status(502).json({
      error: `Impossible d’obtenir une réponse de l’assistant IA : ${rawMsg}`,
    });
  }
});
