-- ============================================================================
-- StockFlow ERP — Migration 004 : CRM Clients, Ventes, Facturation & Paiements
-- ============================================================================

-- 1. Clients (CRM B2B / B2C)
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(24) NOT NULL,
  type VARCHAR(8) NOT NULL DEFAULT 'B2B' CHECK (type IN ('B2B', 'B2C')),
  name VARCHAR(140) NOT NULL,
  contact_name VARCHAR(120),
  email VARCHAR(254),
  phone VARCHAR(32),
  billing_address VARCHAR(240),
  shipping_address VARCHAR(240),
  city VARCHAR(80),
  country VARCHAR(80) DEFAULT 'France',
  siret VARCHAR(32),
  vat_number VARCHAR(32),
  payment_terms VARCHAR(64) NOT NULL DEFAULT '30 jours fin de mois',
  credit_limit NUMERIC(14, 2) NOT NULL DEFAULT 10000 CHECK (credit_limit >= 0),
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  notes TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

-- 2. Devis clients
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference VARCHAR(64) NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted')),
  valid_until DATE NOT NULL,
  payment_terms VARCHAR(64),
  shipping_cost NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  subtotal_ht NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal_ht >= 0),
  vat_total NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (vat_total >= 0),
  total_ttc NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_ttc >= 0),
  converted_order_id UUID,
  notes TEXT,
  created_by_uid UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, reference)
);

-- 3. Commandes clients
CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference VARCHAR(64) NOT NULL,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'preparing', 'partially_delivered', 'delivered', 'invoiced', 'closed', 'canceled')),
  stock_reserved BOOLEAN NOT NULL DEFAULT FALSE,
  expected_delivery_date DATE,
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

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  reserved_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  delivered_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (delivered_qty >= 0),
  unit_price NUMERIC(14, 4) NOT NULL CHECK (unit_price >= 0),
  discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 20 CHECK (vat_rate >= 0 AND vat_rate <= 100)
);

-- 4. Bons de livraison (liés aux sorties de stock OUT)
CREATE TABLE IF NOT EXISTS delivery_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference VARCHAR(64) NOT NULL,
  sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  carrier VARCHAR(80),
  tracking_number VARCHAR(64),
  notes TEXT,
  delivered_by_uid UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, reference)
);

-- 5. Factures clients & Avoirs (numérotation chronologique continue)
CREATE TABLE IF NOT EXISTS sales_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_number VARCHAR(64) NOT NULL,
  invoice_type VARCHAR(24) NOT NULL DEFAULT 'invoice' CHECK (invoice_type IN ('invoice', 'deposit', 'credit_note')),
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  sales_order_id UUID REFERENCES sales_orders(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  shipping_cost NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  total_ht NUMERIC(14, 2) NOT NULL CHECK (total_ht >= 0),
  total_vat NUMERIC(14, 2) NOT NULL CHECK (total_vat >= 0),
  total_ttc NUMERIC(14, 2) NOT NULL CHECK (total_ttc >= 0),
  paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status VARCHAR(24) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'partially_paid', 'paid')),
  related_invoice_id UUID REFERENCES sales_invoices(id) ON DELETE SET NULL,
  notes TEXT,
  created_by_uid UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, invoice_number)
);

-- 6. Paiements & Trésorerie (encaissements & décaissements)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference VARCHAR(64) NOT NULL,
  direction VARCHAR(16) NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  invoice_id UUID NOT NULL,
  invoice_number VARCHAR(64) NOT NULL,
  party_id UUID NOT NULL,
  party_name VARCHAR(140) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  method VARCHAR(24) NOT NULL CHECK (method IN ('transfer', 'card', 'check', 'cash', 'direct_debit')),
  payment_date DATE NOT NULL,
  notes TEXT,
  recorded_by_uid UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, reference)
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_customers ON customers FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_quotes ON quotes FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_sales_orders ON sales_orders FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_so_lines ON sales_order_lines FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_delivery_notes ON delivery_notes FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_sales_invoices ON sales_invoices FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_payments ON payments FOR ALL USING (is_org_member(organization_id));
