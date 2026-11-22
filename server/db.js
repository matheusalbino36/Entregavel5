import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createDatabase(path = process.env.DB_PATH || 'data/vendas-cantina.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operador' CHECK (role IN ('admin', 'operador')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents > 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('avista', 'prazo')),
      payment_status TEXT NOT NULL CHECK (payment_status IN ('paga', 'pendente')),
      total_cents INTEGER NOT NULL CHECK (total_cents > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
      subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents > 0)
    );

    CREATE INDEX IF NOT EXISTS sales_created_at ON sales(created_at DESC);
    CREATE INDEX IF NOT EXISTS sales_client_id ON sales(client_id);
    CREATE INDEX IF NOT EXISTS sale_items_sale_id ON sale_items(sale_id);
  `);
  return db;
}
