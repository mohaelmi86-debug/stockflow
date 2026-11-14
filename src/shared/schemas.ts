import { z } from 'zod';

export const currencySchema = z.enum(['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'MAD', 'XOF']);
export const planSchema = z.enum(['starter', 'pro', 'business', 'enterprise']);

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Le nom doit contenir au moins 2 caractères').max(120),
  currency: currencySchema.default('EUR'),
  country: z.string().trim().max(80).default('France'),
  siret: z.string().trim().max(32).optional().default(''),
  vatNumber: z.string().trim().max(32).optional().default(''),
  seedDemo: z.boolean().default(true),
});

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2, 'Le nom doit contenir au moins 2 caractères').max(120),
  currency: currencySchema,
  country: z.string().trim().max(80).optional().default(''),
  siret: z.string().trim().max(32).optional().default(''),
  vatNumber: z.string().trim().max(32).optional().default(''),
});

export const categorySchema = z.object({
  code: z.string().trim().min(1, 'Code requis').max(24).regex(/^[A-Za-z0-9_-]+$/, 'Lettres, chiffres, - ou _ uniquement'),
  name: z.string().trim().min(1, 'Nom requis').max(80),
  description: z.string().trim().max(300).optional().default(''),
});

export const productSchema = z.object({
  sku: z.string().trim().min(1, 'SKU requis').max(64),
  barcode: z.string().trim().max(64).optional().default(''),
  name: z.string().trim().min(1, 'Nom du produit requis').max(160),
  description: z.string().trim().max(1000).optional().default(''),
  categoryId: z.string().trim().max(128).optional().default(''),
  brand: z.string().trim().max(80).optional().default(''),
  unit: z.string().trim().min(1, 'Unité requise').max(24).default('unité'),
  purchasePrice: z.coerce.number().min(0, 'Le prix d\'achat doit être positif'),
  salePrice: z.coerce.number().min(0, 'Le prix de vente doit être positif'),
  vatRate: z.coerce.number().min(0).max(100).default(20),
  minStock: z.coerce.number().min(0).default(5),
  maxStock: z.coerce.number().min(0).default(100),
  status: z.enum(['active', 'draft', 'archived']).default('active'),
  trackBatches: z.boolean().default(false),
  trackSerials: z.boolean().default(false),
  trackExpiry: z.boolean().default(false),
});

export const warehouseSchema = z.object({
  code: z.string().trim().min(1, 'Code requis').max(24),
  name: z.string().trim().min(1, 'Nom requis').max(120),
  address: z.string().trim().max(240).optional().default(''),
  city: z.string().trim().max(80).optional().default(''),
  country: z.string().trim().max(80).optional().default('France'),
  capacityUnits: z.coerce.number().min(0).default(10000),
  isDefault: z.boolean().default(false),
  status: z.enum(['active', 'inactive']).default('active'),
});

export const locationSchema = z.object({
  warehouseId: z.string().trim().min(1, 'Entrepôt requis'),
  code: z.string().trim().min(1, 'Code emplacement requis').max(32),
  zoneType: z.enum(['storage', 'receiving', 'shipping', 'picking']).default('storage'),
  aisle: z.string().trim().max(24).optional().default(''),
  rack: z.string().trim().max(24).optional().default(''),
  level: z.string().trim().max(24).optional().default(''),
  capacity: z.coerce.number().min(0).default(500),
  status: z.enum(['active', 'blocked']).default('active'),
});

export const stockMovementSchema = z.object({
  movementType: z.enum(['IN', 'OUT', 'TRANSFER', 'ADJUSTMENT']),
  productId: z.string().trim().min(1, 'Produit requis'),
  warehouseId: z.string().trim().min(1, 'Entrepôt source requis'),
  locationId: z.string().trim().min(1, 'Emplacement source requis'),
  targetWarehouseId: z.string().trim().optional().default(''),
  targetLocationId: z.string().trim().optional().default(''),
  quantity: z.coerce.number().refine((v) => v !== 0, 'La quantité ne peut pas être 0'),
  unitCost: z.coerce.number().min(0, 'Coût unitaire invalide').default(0),
  reason: z.string().trim().min(2, 'Motif obligatoire (min. 2 caractères)').max(300),
  sourceDocumentType: z.string().trim().max(48).optional().default('Opération manuelle'),
  sourceDocumentRef: z.string().trim().max(64).optional().default(''),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type CategoryInput = z.infer<typeof categorySchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type WarehouseInput = z.infer<typeof warehouseSchema>;
export type LocationInput = z.infer<typeof locationSchema>;
export type StockMovementInput = z.infer<typeof stockMovementSchema>;

// ---------------------------------------------------------------------------
// Phase 3 — Fournisseurs & Achats
// ---------------------------------------------------------------------------
export const supplierSchema = z.object({
  code: z.string().trim().min(1, 'Code fournisseur requis').max(24),
  name: z.string().trim().min(2, 'Raison sociale requise').max(140),
  contactName: z.string().trim().max(120).optional().default(''),
  email: z.string().trim().max(254).optional().default(''),
  phone: z.string().trim().max(32).optional().default(''),
  address: z.string().trim().max(240).optional().default(''),
  city: z.string().trim().max(80).optional().default(''),
  country: z.string().trim().max(80).default('France'),
  siret: z.string().trim().max(32).optional().default(''),
  vatNumber: z.string().trim().max(32).optional().default(''),
  paymentTerms: z.string().trim().min(1).max(64).default('30 jours fin de mois'),
  leadTimeDays: z.coerce.number().min(0).max(365).default(5),
  rating: z.coerce.number().min(0).max(5).default(4.5),
  onTimeRate: z.coerce.number().min(0).max(100).default(95),
  status: z.enum(['active', 'inactive']).default('active'),
  notes: z.string().trim().max(600).optional().default(''),
});

export const purchaseRequestLineSchema = z.object({
  productId: z.string().min(1, 'Produit requis'),
  quantity: z.coerce.number().positive('Quantité > 0 requise'),
  estimatedUnitCost: z.coerce.number().min(0).default(0),
});

export const purchaseRequestSchema = z.object({
  title: z.string().trim().min(2, 'Objet requis').max(160),
  warehouseId: z.string().min(1, 'Entrepôt requis'),
  priority: z.enum(['normal', 'urgent']).default('normal'),
  notes: z.string().trim().max(500).optional().default(''),
  lines: z.array(purchaseRequestLineSchema).min(1, 'Au moins une ligne requise').max(100),
});

export const purchaseOrderLineSchema = z.object({
  productId: z.string().min(1, 'Produit requis'),
  quantity: z.coerce.number().positive('Quantité > 0 requise'),
  unitPrice: z.coerce.number().min(0),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  vatRate: z.coerce.number().min(0).max(100).default(20),
});

export const purchaseOrderSchema = z.object({
  supplierId: z.string().min(1, 'Fournisseur requis'),
  warehouseId: z.string().min(1, 'Entrepôt de livraison requis'),
  expectedDate: z.string().trim().max(32).optional().default(''),
  paymentTerms: z.string().trim().max(64).optional().default('30 jours fin de mois'),
  shippingCost: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(600).optional().default(''),
  lines: z.array(purchaseOrderLineSchema).min(1, 'Au moins une ligne requise').max(100),
});

export const supplierInvoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(2, 'N° facture requis').max(64),
  purchaseOrderId: z.string().min(1, 'Commande requise'),
  issueDate: z.string().min(4, 'Date émission requise').max(32),
  dueDate: z.string().min(4, 'Date échéance requise').max(32),
  totalHt: z.coerce.number().min(0),
  totalVat: z.coerce.number().min(0),
  totalTtc: z.coerce.number().min(0),
  notes: z.string().trim().max(400).optional().default(''),
});

export type SupplierInput = z.infer<typeof supplierSchema>;
export type PurchaseRequestInput = z.infer<typeof purchaseRequestSchema>;
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export type SupplierInvoiceInput = z.infer<typeof supplierInvoiceSchema>;

// ---------------------------------------------------------------------------
// Phase 4 — Clients (CRM), Ventes, Facturation & Paiements
// ---------------------------------------------------------------------------
export const customerSchema = z.object({
  code: z.string().trim().min(1, 'Code client requis').max(24),
  type: z.enum(['B2B', 'B2C']).default('B2B'),
  name: z.string().trim().min(2, 'Nom / Raison sociale requis').max(140),
  contactName: z.string().trim().max(120).optional().default(''),
  email: z.string().trim().max(254).optional().default(''),
  phone: z.string().trim().max(32).optional().default(''),
  billingAddress: z.string().trim().max(240).optional().default(''),
  shippingAddress: z.string().trim().max(240).optional().default(''),
  city: z.string().trim().max(80).optional().default(''),
  country: z.string().trim().max(80).default('France'),
  siret: z.string().trim().max(32).optional().default(''),
  vatNumber: z.string().trim().max(32).optional().default(''),
  paymentTerms: z.string().trim().min(1).max(64).default('30 jours fin de mois'),
  creditLimit: z.coerce.number().min(0).default(10000),
  status: z.enum(['active', 'inactive']).default('active'),
  notes: z.string().trim().max(600).optional().default(''),
});

export const salesLineSchema = z.object({
  productId: z.string().min(1, 'Produit requis'),
  quantity: z.coerce.number().positive('Quantité > 0 requise'),
  unitPrice: z.coerce.number().min(0, 'Prix unitaire positif requis'),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  vatRate: z.coerce.number().min(0).max(100).default(20),
});

export const quoteSchema = z.object({
  customerId: z.string().min(1, 'Client requis'),
  warehouseId: z.string().min(1, 'Entrepôt requis'),
  validUntil: z.string().min(4, 'Date de validité requise').max(32),
  paymentTerms: z.string().trim().max(64).optional().default('30 jours fin de mois'),
  shippingCost: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(600).optional().default(''),
  lines: z.array(salesLineSchema).min(1, 'Au moins une ligne requise').max(100),
});

export const salesOrderSchema = z.object({
  customerId: z.string().min(1, 'Client requis'),
  warehouseId: z.string().min(1, 'Entrepôt d’expédition requis'),
  expectedDeliveryDate: z.string().trim().max(32).optional().default(''),
  paymentTerms: z.string().trim().max(64).optional().default('30 jours fin de mois'),
  shippingCost: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(600).optional().default(''),
  lines: z.array(salesLineSchema).min(1, 'Au moins une ligne requise').max(100),
});

export const salesInvoiceSchema = z.object({
  invoiceType: z.enum(['invoice', 'deposit', 'credit_note']).default('invoice'),
  customerId: z.string().min(1, 'Client requis'),
  salesOrderId: z.string().optional().default(''),
  issueDate: z.string().min(4, 'Date émission requise').max(32),
  dueDate: z.string().min(4, 'Date échéance requise').max(32),
  shippingCost: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(400).optional().default(''),
  lines: z.array(salesLineSchema).min(1, 'Au moins une ligne requise').max(100),
});

export const paymentSchema = z.object({
  direction: z.enum(['incoming', 'outgoing']),
  invoiceId: z.string().min(1, 'Facture requise'),
  amount: z.coerce.number().positive('Montant > 0 requis'),
  method: z.enum(['transfer', 'card', 'check', 'cash', 'direct_debit']).default('transfer'),
  paymentDate: z.string().min(4, 'Date requise').max(32),
  notes: z.string().trim().max(300).optional().default(''),
});

export type CustomerInput = z.infer<typeof customerSchema>;
export type QuoteInput = z.infer<typeof quoteSchema>;
export type SalesOrderInput = z.infer<typeof salesOrderSchema>;
export type SalesInvoiceInput = z.infer<typeof salesInvoiceSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;

// ---------------------------------------------------------------------------
// Phase 7 — Abonnements Stripe & Gouvernance Multi-Tenant RBAC
// ---------------------------------------------------------------------------
export const assignableRoleSchema = z.enum(['admin', 'manager', 'operator', 'viewer']);
export const billingCycleSchema = z.enum(['monthly', 'annual']);

export const addOrganizationMemberSchema = z.object({
  uid: z
    .string()
    .trim()
    .min(6, 'UID Firebase invalide (min. 6 caractères)')
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Format UID Firebase invalide'),
  email: z.string().trim().email('Adresse e-mail invalide').max(254),
  displayName: z.string().trim().min(2, 'Nom requis').max(120),
  role: assignableRoleSchema.default('operator'),
});

export const billingCheckoutSchema = z.object({
  orgId: z.string().trim().min(3).max(128),
  orgName: z.string().trim().min(2).max(120),
  planCode: planSchema,
  billingCycle: billingCycleSchema.default('monthly'),
  customerEmail: z.string().trim().email().optional(),
});

export type AddOrganizationMemberInput = z.infer<typeof addOrganizationMemberSchema>;
export type BillingCheckoutInput = z.infer<typeof billingCheckoutSchema>;


