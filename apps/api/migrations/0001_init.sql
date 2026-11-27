-- Pedidos de mayoreo. Dinero en centavos enteros; fechas-instante en ISO UTC;
-- slot_date / slot_time en hora local del negocio (America/Monterrey).

CREATE TABLE orders (
  code TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  slot_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  fulfillment_type TEXT NOT NULL,
  delivery_address TEXT NOT NULL DEFAULT '',
  delivery_references TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL,
  payment_plan TEXT NOT NULL,
  -- Cotización completa del servidor (core.quote) al momento de pedir.
  quote_json TEXT NOT NULL,
  drinks INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  due_now_cents INTEGER NOT NULL,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  -- Comisión real del proveedor de pago: 0 en transferencias, NULL si aún no se sabe.
  provider_fee_cents INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  mp_checkout_url TEXT,
  mp_payment_id TEXT
);

CREATE INDEX orders_slot ON orders (slot_date, slot_time, status);
CREATE INDEX orders_status_expires ON orders (status, expires_at);

-- Copia del nombre y precio de cada línea al momento de pedir (el menú puede cambiar después).
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders (code),
  item_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  variant_label TEXT NOT NULL,
  options_label TEXT NOT NULL,
  options_json TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL
);

CREATE INDEX order_items_order ON order_items (order_code);

-- Auditoría: todo cambio de estado, pago, aviso fallido, etc.
CREATE TABLE order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL REFERENCES orders (code),
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE INDEX order_events_order ON order_events (order_code, id);
