export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'CHF' | 'CAD' | 'MAD' | 'XOF';
export type PlanCode = 'starter' | 'pro' | 'business' | 'enterprise';
export type OrgRole = 'owner' | 'admin' | 'manager' | 'operator' | 'viewer';
export type MemberStatus = 'active' | 'invited' | 'suspended';
export type ProductStatus = 'active' | 'draft' | 'archived';
export type WarehouseStatus = 'active' | 'inactive';
export type LocationZoneType = 'storage' | 'receiving' | 'shipping' | 'picking';
export type LocationStatus = 'active' | 'blocked';
export type MovementType = 'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT';
export type NotificationSeverity = 'info' | 'warning' | 'error' | 'success';

export interface PlanQuota {
  code: PlanCode;
  name: string;
  priceMonthlyEur: number;
  maxUsers: number;
  maxWarehouses: number;
  maxProducts: number;
  aiCreditsMonthly: number;
  targetAudience: string;
}

export const PLAN_QUOTAS: Record<PlanCode, PlanQuota> = {
  starter: {
    code: 'starter',
    name: 'Starter',
    priceMonthlyEur: 0,
    maxUsers: 3,
    maxWarehouses: 1,
    maxProducts: 250,
    aiCreditsMonthly: 50,
    targetAudience: 'Pour les petites équipes et associations',
  },
  pro: {
    code: 'pro',
    name: 'Pro',
    priceMonthlyEur: 49,
    maxUsers: 15,
    maxWarehouses: 3,
    maxProducts: 2500,
    aiCreditsMonthly: 500,
    targetAudience: 'Pour les PME en croissance',
  },
  business: {
    code: 'business',
    name: 'Business',
    priceMonthlyEur: 149,
    maxUsers: 50,
    maxWarehouses: 15,
    maxProducts: 25000,
    aiCreditsMonthly: 2500,
    targetAudience: 'Pour les opérations multi-entrepôts',
  },
  enterprise: {
    code: 'enterprise',
    name: 'Enterprise',
    priceMonthlyEur: 399,
    maxUsers: 50,
    maxWarehouses: 100,
    maxProducts: 100000,
    aiCreditsMonthly: 10000,
    targetAudience: 'Pour les groupes industriels & distributeurs',
  },
};

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  activeOrgId?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface UserMembership {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: OrgRole;
  plan: PlanCode;
  currency: CurrencyCode;
  joinedAt: unknown;
}

export type BillingCycle = 'monthly' | 'annual';
export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  currency: CurrencyCode;
  country?: string;
  siret?: string;
  vatNumber?: string;
  plan: PlanCode;
  billingCycle?: BillingCycle;
  subscriptionStatus?: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  planUpdatedAt?: unknown;
  ownerId: string;
  memberUids: string[];
  isDemoSeeded?: boolean;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface OrganizationMember {
  uid: string;
  orgId: string;
  orgOwnerId: string;
  email: string;
  displayName: string;
  role: OrgRole;
  status: MemberStatus;
  memberUids: string[];
  joinedAt: unknown;
}

export interface ProductCategory {
  id: string;
  orgId: string;
  name: string;
  code: string;
  description?: string;
  memberUids: string[];
  createdAt: unknown;
}

export interface Product {
  id: string;
  orgId: string;
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  categoryId?: string;
  categoryName?: string;
  brand?: string;
  unit: string;
  purchasePrice: number;
  salePrice: number;
  vatRate: number;
  minStock: number;
  maxStock: number;
  status: ProductStatus;
  trackBatches?: boolean;
  trackSerials?: boolean;
  trackExpiry?: boolean;
  isDemo?: boolean;
  memberUids: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Warehouse {
  id: string;
  orgId: string;
  code: string;
  name: string;
  address?: string;
  city?: string;
  country?: string;
  capacityUnits: number;
  isDefault: boolean;
  status: WarehouseStatus;
  isDemo?: boolean;
  memberUids: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface WarehouseLocation {
  id: string;
  orgId: string;
  warehouseId: string;
  code: string;
  zoneType: LocationZoneType;
  aisle?: string;
  rack?: string;
  level?: string;
  capacity: number;
  status: LocationStatus;
  memberUids: string[];
  createdAt: unknown;
}

export interface StockBalance {
  id: string;
  orgId: string;
  productId: string;
  productSku: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  locationId: string;
  locationCode: string;
  physicalQty: number;
  reservedQty: number;
  onOrderQty: number;
  inTransitQty: number;
  availableQty: number;
  unitCost: number;
  memberUids: string[];
  updatedAt: unknown;
}

export interface StockMovement {
  id: string;
  orgId: string;
  reference: string;
  movementType: MovementType;
  productId: string;
  productSku: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  locationId: string;
  locationCode: string;
  targetWarehouseId?: string;
  targetWarehouseName?: string;
  targetLocationId?: string;
  targetLocationCode?: string;
  quantity: number;
  unitCost: number;
  reason: string;
  sourceDocumentType?: string;
  sourceDocumentRef?: string;
  performedByUid: string;
  performedByName: string;
  isDemo?: boolean;
  memberUids: string[];
  createdAt: unknown;
}

export interface AuditLog {
  id: string;
  orgId: string;
  actorUid: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  memberUids: string[];
  createdAt: unknown;
}

export interface AppNotification {
  id: string;
  orgId: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  isRead: boolean;
  link?: string;
  memberUids: string[];
  createdAt: unknown;
}

// ---------------------------------------------------------------------------
// Phase 3 — Fournisseurs & Achats
// ---------------------------------------------------------------------------
export type SupplierStatus = 'active' | 'inactive';
export type PurchaseRequestStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rfq_sent'
  | 'converted'
  | 'rejected';
export type PurchaseOrderStatus =
  | 'draft'
  | 'confirmed'
  | 'partially_received'
  | 'received'
  | 'invoiced'
  | 'closed'
  | 'canceled';
export type InspectionStatus = 'passed' | 'partial_issue' | 'rejected';
export type SupplierInvoiceStatus = 'pending' | 'partially_paid' | 'paid';

export interface Supplier {
  id: string;
  orgId: string;
  code: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  siret?: string;
  vatNumber?: string;
  paymentTerms: string;
  leadTimeDays: number;
  rating: number;
  onTimeRate: number;
  status: SupplierStatus;
  notes?: string;
  isDemo?: boolean;
  memberUids: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PurchaseRequestLine {
  productId: string;
  productSku: string;
  productName: string;
  unit: string;
  quantity: number;
  estimatedUnitCost: number;
}

export interface RfqSupplierOffer {
  supplierId: string;
  supplierName: string;
  totalHt: number;
  leadTimeDays: number;
  validUntil: string;
  notes?: string;
  selected?: boolean;
}

export interface PurchaseRequest {
  id: string;
  orgId: string;
  reference: string;
  title: string;
  warehouseId: string;
  warehouseName: string;
  priority: 'normal' | 'urgent';
  status: PurchaseRequestStatus;
  lines: PurchaseRequestLine[];
  rfqOffers?: RfqSupplierOffer[];
  notes?: string;
  requestedByUid: string;
  requestedByName: string;
  convertedOrderId?: string;
  isDemo?: boolean;
  memberUids: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PurchaseOrderLine {
  productId: string;
  productSku: string;
  productName: string;
  unit: string;
  quantity: number;
  receivedQty: number;
  unitPrice: number;
  discountPct: number;
  vatRate: number;
}

export interface PurchaseOrder {
  id: string;
  orgId: string;
  reference: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  status: PurchaseOrderStatus;
  expectedDate?: string;
  paymentTerms?: string;
  shippingCost: number;
  subtotalHt: number;
  vatTotal: number;
  totalTtc: number;
  lines: PurchaseOrderLine[];
  notes?: string;
  createdByUid: string;
  createdByName: string;
  isDemo?: boolean;
  memberUids: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface GoodsReceiptLine {
  productId: string;
  productSku: string;
  productName: string;
  locationId: string;
  locationCode: string;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  unitCost: number;
}

export interface GoodsReceipt {
  id: string;
  orgId: string;
  reference: string;
  purchaseOrderId: string;
  purchaseOrderRef: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  inspectionStatus: InspectionStatus;
  deliveryNoteRef?: string;
  notes?: string;
  lines: GoodsReceiptLine[];
  receivedByUid: string;
  receivedByName: string;
  memberUids: string[];
  createdAt: unknown;
}

export interface SupplierInvoice {
  id: string;
  orgId: string;
  invoiceNumber: string;
  purchaseOrderId: string;
  purchaseOrderRef: string;
  supplierId: string;
  supplierName: string;
  issueDate: string;
  dueDate: string;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  paidAmount: number;
  status: SupplierInvoiceStatus;
  notes?: string;
  createdByUid: string;
  memberUids: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

// ---------------------------------------------------------------------------
// Phase 4 — Clients (CRM), Ventes, Facturation & Paiements
// ---------------------------------------------------------------------------
export type CustomerType = 'B2B' | 'B2C';
export type CustomerStatus = 'active' | 'inactive';
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted';
export type SalesOrderStatus =
  | 'draft'
  | 'confirmed'
  | 'preparing'
  | 'partially_delivered'
  | 'delivered'
  | 'invoiced'
  | 'closed'
  | 'canceled';
export type SalesInvoiceType = 'invoice' | 'deposit' | 'credit_note';
export type SalesInvoiceStatus = 'issued' | 'partially_paid' | 'paid';
export type PaymentDirection = 'incoming' | 'outgoing';
export type PaymentMethod = 'transfer' | 'card' | 'check' | 'cash' | 'direct_debit';

export interface Customer {
  id: string;
  orgId: string;
  code: string;
  type: CustomerType;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  billingAddress?: string;
  shippingAddress?: string;
  city?: string;
  country?: string;
  siret?: string;
  vatNumber?: string;
  paymentTerms: string;
  creditLimit: number;
  status: CustomerStatus;
  notes?: string;
  isDemo?: boolean;
  memberUids: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface SalesLine {
  productId: string;
  productSku: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  vatRate: number;
}

export interface StockReservationAllocation {
  warehouseId: string;
  locationId: string;
  quantity: number;
}

export interface SalesOrderLine extends SalesLine {
  reservedQty: number;
  deliveredQty: number;
  reservationAllocations?: StockReservationAllocation[];
}

export interface Quote {
  id: string;
  orgId: string;
  reference: string;
  customerId: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  status: QuoteStatus;
  validUntil: string;
  paymentTerms?: string;
  shippingCost: number;
  subtotalHt: number;
  vatTotal: number;
  totalTtc: number;
  lines: SalesLine[];
  notes?: string;
  convertedOrderId?: string;
  createdByUid: string;
  createdByName: string;
  isDemo?: boolean;
  memberUids: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface SalesOrder {
  id: string;
  orgId: string;
  reference: string;
  quoteId?: string;
  customerId: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  status: SalesOrderStatus;
  stockReserved: boolean;
  expectedDeliveryDate?: string;
  paymentTerms?: string;
  shippingCost: number;
  subtotalHt: number;
  vatTotal: number;
  totalTtc: number;
  lines: SalesOrderLine[];
  notes?: string;
  createdByUid: string;
  createdByName: string;
  isDemo?: boolean;
  memberUids: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface DeliveryNoteLine {
  productId: string;
  productSku: string;
  productName: string;
  locationId: string;
  locationCode: string;
  deliveredQty: number;
  unitCost: number;
}

export interface DeliveryNote {
  id: string;
  orgId: string;
  reference: string;
  salesOrderId: string;
  salesOrderRef: string;
  customerId: string;
  customerName: string;
  warehouseId: string;
  warehouseName: string;
  carrier?: string;
  trackingNumber?: string;
  notes?: string;
  lines: DeliveryNoteLine[];
  deliveredByUid: string;
  deliveredByName: string;
  memberUids: string[];
  createdAt: unknown;
}

export interface SalesInvoice {
  id: string;
  orgId: string;
  invoiceNumber: string;
  invoiceType: SalesInvoiceType;
  sequenceNumber: number;
  salesOrderId?: string;
  salesOrderRef?: string;
  customerId: string;
  customerName: string;
  customerSiret?: string;
  customerVatNumber?: string;
  customerAddress?: string;
  issueDate: string;
  dueDate: string;
  shippingCost: number;
  totalHt: number;
  totalVat: number;
  totalTtc: number;
  paidAmount: number;
  status: SalesInvoiceStatus;
  lines: SalesLine[];
  relatedInvoiceId?: string;
  notes?: string;
  createdByUid: string;
  createdByName: string;
  isDemo?: boolean;
  memberUids: string[];
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Payment {
  id: string;
  orgId: string;
  reference: string;
  direction: PaymentDirection;
  invoiceId: string;
  invoiceNumber: string;
  partyId: string;
  partyName: string;
  amount: number;
  method: PaymentMethod;
  paymentDate: string;
  notes?: string;
  recordedByUid: string;
  recordedByName: string;
  memberUids: string[];
  createdAt: unknown;
}

