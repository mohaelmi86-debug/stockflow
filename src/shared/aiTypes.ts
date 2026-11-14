import type { CurrencyCode, MovementType, OrgRole } from './types.ts';

export interface AiProductSnapshot {
  id: string;
  sku: string;
  name: string;
  categoryName: string;
  unit: string;
  purchasePrice: number;
  salePrice: number;
  minStock: number;
  maxStock: number;
  status: string;
}

export interface AiWarehouseSnapshot {
  id: string;
  code: string;
  name: string;
  city: string;
  status: string;
}

export interface AiLocationSnapshot {
  id: string;
  warehouseId: string;
  code: string;
  zoneType: string;
  capacity: number;
}

export interface AiBalanceSnapshot {
  productId: string;
  warehouseId: string;
  locationId: string;
  locationCode: string;
  physicalQty: number;
  reservedQty: number;
  availableQty: number;
  unitCost: number;
}

export interface AiSupplierSnapshot {
  id: string;
  code: string;
  name: string;
  leadTimeDays: number;
  rating: number;
  onTimeRate: number;
  status: string;
}

export interface AiPurchaseOrderSnapshot {
  reference: string;
  supplierName: string;
  status: string;
  totalTtc: number;
  expectedDate?: string;
}

export interface AiSalesOrderSnapshot {
  reference: string;
  customerName: string;
  status: string;
  totalTtc: number;
  expectedDeliveryDate?: string;
}

export interface AiUnpaidInvoiceSnapshot {
  invoiceNumber: string;
  customerName: string;
  dueDate: string;
  totalTtc: number;
  paidAmount: number;
  remainingTtc: number;
  status: string;
}

export interface AiMovementSnapshot {
  reference: string;
  movementType: MovementType;
  productSku: string;
  warehouseName: string;
  quantity: number;
  reason: string;
}

export interface AiOrgContext {
  orgId: string;
  orgName: string;
  currency: CurrencyCode;
  userRole: OrgRole;
  products: AiProductSnapshot[];
  warehouses: AiWarehouseSnapshot[];
  locations: AiLocationSnapshot[];
  balances: AiBalanceSnapshot[];
  suppliers: AiSupplierSnapshot[];
  openPurchaseOrders: AiPurchaseOrderSnapshot[];
  openSalesOrders: AiSalesOrderSnapshot[];
  unpaidSalesInvoices: AiUnpaidInvoiceSnapshot[];
  recentMovements: AiMovementSnapshot[];
}

export interface AiPurchaseProposalLine {
  productId: string;
  productSku: string;
  productName: string;
  unit: string;
  quantity: number;
  estimatedUnitCost: number;
}

export interface AiPurchaseRequestProposal {
  id: string;
  kind: 'purchase_request';
  status: 'pending' | 'executed' | 'rejected';
  title: string;
  priority: 'normal' | 'urgent';
  warehouseId: string;
  warehouseName: string;
  notes: string;
  lines: AiPurchaseProposalLine[];
  totalEstimatedCost: number;
  executedRef?: string;
}

export interface AiStockMovementProposal {
  id: string;
  kind: 'stock_movement';
  status: 'pending' | 'executed' | 'rejected';
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
  executedRef?: string;
}

export type AiActionProposal = AiPurchaseRequestProposal | AiStockMovementProposal;

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  toolTrace?: string[];
  proposals?: AiActionProposal[];
}

export interface AiChatRequest {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  orgContext: AiOrgContext;
}

export interface AiChatResponse {
  reply: string;
  toolTrace: string[];
  proposals: AiActionProposal[];
  model: string;
}
