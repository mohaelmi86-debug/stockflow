-- ============================================================================
-- StockFlow ERP — Migration 002 : Produits, Entrepôts & Moteur de Stock
-- Règle fondamentale : aucune modification directe de stock_balances sans
-- insertion traçable dans stock_movements au sein d'une transaction ACID.
-- ============================================================================

-- 1. Catégories de produits
CREATE TABLE IF NOT EXISTS product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(24) NOT NULL,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

-- 2. Produits & Catalogue
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  sku VARCHAR(64) NOT NULL,
  barcode VARCHAR(64),
  name VARCHAR(160) NOT NULL,
  description TEXT,
  brand VARCHAR(80),
  unit VARCHAR(24) NOT NULL DEFAULT 'unité',
  purchase_price NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  sale_price NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 20.00 CHECK (vat_rate >= 0 AND vat_rate <= 100),
  min_stock NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  max_stock NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (max_stock >= 0),
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  track_batches BOOLEAN NOT NULL DEFAULT FALSE,
  track_serials BOOLEAN NOT NULL DEFAULT FALSE,
  track_expiry BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (organization_id, sku)
);

CREATE INDEX idx_products_org_status ON products(organization_id, status);
CREATE INDEX idx_products_org_barcode ON products(organization_id, barcode);

-- 3. Entrepôts
CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(24) NOT NULL,
  name VARCHAR(120) NOT NULL,
  address VARCHAR(240),
  city VARCHAR(80),
  country VARCHAR(80),
  capacity_units NUMERIC(14, 2) NOT NULL DEFAULT 10000 CHECK (capacity_units >= 0),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

-- 4. Emplacements / Rayonnages (Préparation visualisation 3D)
CREATE TABLE IF NOT EXISTS warehouse_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  zone_type VARCHAR(24) NOT NULL CHECK (zone_type IN ('storage', 'receiving', 'shipping', 'picking')),
  aisle VARCHAR(24),
  rack VARCHAR(24),
  level VARCHAR(24),
  capacity NUMERIC(14, 2) NOT NULL DEFAULT 500 CHECK (capacity >= 0),
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, warehouse_id, code)
);

-- 5. Soldes de stock (maintenus transactionnellement par les mouvements)
CREATE TABLE IF NOT EXISTS stock_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES warehouse_locations(id) ON DELETE CASCADE,
  physical_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (physical_qty >= 0),
  reserved_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  on_order_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (on_order_qty >= 0),
  in_transit_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (in_transit_qty >= 0),
  available_qty NUMERIC(14, 3) GENERATED ALWAYS AS (physical_qty - reserved_qty) STORED,
  unit_cost NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, product_id, warehouse_id, location_id)
);

-- 6. Journal immuable des mouvements de stock
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference VARCHAR(64) NOT NULL,
  movement_type VARCHAR(24) NOT NULL CHECK (movement_type IN ('IN', 'OUT', 'TRANSFER', 'ADJUSTMENT')),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES warehouse_locations(id) ON DELETE RESTRICT,
  target_warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT,
  target_location_id UUID REFERENCES warehouse_locations(id) ON DELETE RESTRICT,
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity <> 0),
  unit_cost NUMERIC(14, 4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  reason VARCHAR(300) NOT NULL,
  source_document_type VARCHAR(48),
  source_document_ref VARCHAR(64),
  performed_by_uid UUID NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, reference)
);

CREATE INDEX idx_stock_movements_org_created ON stock_movements(organization_id, created_at DESC);
CREATE INDEX idx_stock_movements_product ON stock_movements(organization_id, product_id);

-- RLS sur toutes les tables métiers
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_categories ON product_categories FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_products ON products FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_warehouses ON warehouses FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_locations ON warehouse_locations FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_stock_balances ON stock_balances FOR ALL USING (is_org_member(organization_id));
CREATE POLICY tenant_stock_movements ON stock_movements FOR SELECT USING (is_org_member(organization_id));
