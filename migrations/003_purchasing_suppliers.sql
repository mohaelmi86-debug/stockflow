-- ============================================================================
-- StockFlow ERP — Migration 003 : Fournisseurs & Cycle d'Achat Complet
-- ============================================================================

-- 1. Fournisseurs
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(24) NOT NULL,
  name VARCHAR(140) NOT NULL,
  contact_name VARCHAR(120),
  email VARCHAR(254),
  phone VARCHAR(32),
  address VARCHAR(240),
  city VARCHAR(80),
  country VARCHAR(80) DEFAULT 'France',
  siret VARCHAR(32),
  vat_number VARCHAR(32),
  payment_terms VARCHAR(64) NOT NULL DEFAULT '30 jours fin de mois',
  lead_time_days INTEGER NOT NULL DEFAULT 5 CHECK (lead_time_days >= 0),
  rating NUMERIC(3, 2) NOT NULL DEFAULT 4.5 CHECK (rating >= 0 AND rating <= 5),
  on_time_rate NUMERIC(5, 2) NOT NULL DEFAULT 95.0 CHECK (on_time_rate >= 0 AND on_time_rate <= 100),
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

-- 2. Demandes d'achat & consultations fournisseurs
CREATE TABLE IF NOT EXISTS purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference VARCHAR(64) NOT NULL,
  title VARCHAR(160) NOT NULL,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  priority VARCHAR(16) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  status VARCHAR(32) NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rfq_sent', 'converted', 'rejected')),
  requested_by_uid UUID NOT NULL,
  converted_order_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, reference)
);

-- 3. Commandes fournisseurs
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference VARCHAR(64) NOT NULL,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'partially_received', 'received', 'invoiced', 'closed', 'canceled')),
  expected_date DATE,
  payment_terms VARCHAR(64),
  shipping_cost NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  subtotal_ht NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal_ht >= 0),
  vat_total NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (vat_total >= 0),
  total_ttc NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_ttc >= 0),
  notes TEXT,
  created_by_uid UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, reference)
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  received_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  unit_price NUMERIC(14, 4) NOT NULL CHECK (unit_price >= 0),
  discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 20 CHECK (vat_rate >= 0 AND vat_rate <= 100)
);

-- 4. Réceptions marchandises (liées aux mouvements de stock)
CREATE TABLE IF NOT EXISTS goods_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference VARCHAR(64) NOT NULL,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  inspection_status VARCHAR(24) NOT NULL CHECK (inspection_status IN ('passed', 'partial_issue', 'rejected')),
  delivery_note_ref VARCHAR(64),
  notes TEXT,
  received_by_uid UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, reference)
);

CREATE TABLE IF NOT EXISTS goods_receipt_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_receipt_id UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES warehouse_locations(id) ON DELETE RESTRICT,
  received_qty NUMERIC(14, 3) NOT NULL CHECK (received_qty >= 0),
  accepted_qty NUMERIC(14, 3) NOT NULL CHECK (accepted_qty >= 0),
  rejected_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0)
);

-- 5. Factures fournisseurs
CREATE TABLE IF NOT EXISTS supplier_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_number VARCHAR(64) NOT NULL,
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  total_ht NUMERIC(14, 2) NOT NULL CHECK (total_ht >= 0),
  total_vat NUMERIC(14, 2) NOT NULL CHECK (total_vat >= 0),
  total_ttc NUMERIC(14, 2) NOT NULL CHECK (total_ttc >= 0),
  paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partially_paid', 'paid')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, invoice_number)
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_suppliers ON suppliers FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_purchase_requests ON purchase_requests FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_purchase_orders ON purchase_orders FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_po_lines ON purchase_order_lines FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_goods_receipts ON goods_receipts FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_supplier_invoices ON supplier_invoices FOR ALL USING (is_org_member(organization_id));
