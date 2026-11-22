import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'O corpo da requisição deve ser um objeto JSON.');
  }
  return body;
}

function parseProduct(body) {
  requireObject(body);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const unit = typeof body.unit === 'string' ? body.unit.trim() : '';
  const priceCents = body.priceCents;
  const stock = body.stock;

  if (name.length < 2 || name.length > 80) {
    throw new HttpError(400, 'O nome do produto deve ter entre 2 e 80 caracteres.');
  }
  if (unit.length < 1 || unit.length > 20) {
    throw new HttpError(400, 'Informe uma unidade válida, como un, kg ou litro.');
  }
  if (!Number.isSafeInteger(priceCents) || priceCents < 1) {
    throw new HttpError(400, 'O preço deve ser informado em centavos e maior que zero.');
  }
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000) {
    throw new HttpError(400, 'O estoque deve ser um número inteiro entre 0 e 1.000.000.');
  }
  return { name, unit, priceCents, stock };
}

function parseClient(body) {
  requireObject(body);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (name.length < 2 || name.length > 100) {
    throw new HttpError(400, 'O nome do cliente deve ter entre 2 e 100 caracteres.');
  }
  if (phone.length > 30) throw new HttpError(400, 'O telefone é muito longo.');
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) {
    throw new HttpError(400, 'Informe um e-mail válido.');
  }
  return { name, phone: phone || null, email: email || null };
}

function parseDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `Informe uma data válida para ${label} (AAAA-MM-DD).`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `Informe uma data válida para ${label} (AAAA-MM-DD).`);
  }
  return value;
}

export function createApp({ db, jwtSecret, serveFrontend = true }) {
  if (!db) throw new Error('A conexão com o banco de dados é obrigatória.');
  if (!jwtSecret) throw new Error('A chave JWT é obrigatória.');

  const app = express();
  app.use(express.json({ limit: '50kb' }));

  const authenticate = (req, res, next) => {
    const authorization = req.get('authorization') || '';
    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Autenticação necessária.' });
    }

    let claims;
    try {
      claims = jwt.verify(token, jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(claims.id);
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });
    req.user = user;
    return next();
  };

  const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Somente administradores podem gerenciar cadastros.' });
    }
    return next();
  };

  app.post('/api/auth/register', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      if (name.length < 2 || name.length > 60) {
        return res.status(400).json({ error: 'O nome deve ter entre 2 e 60 caracteres.' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return res.status(400).json({ error: 'Informe um e-mail válido.' });
      }
      if (password.length < 8 || password.length > 72) {
        return res.status(400).json({ error: 'A senha deve ter entre 8 e 72 caracteres.' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = db.transaction(() => {
        const role = db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0
          ? 'admin'
          : 'operador';
        const result = db.prepare(
          'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        ).run(name, email, passwordHash, role);
        return db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(result.lastInsertRowid);
      })();
      const token = jwt.sign({ id: user.id }, jwtSecret, { expiresIn: '7d' });
      return res.status(201).json({ token, user });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
      }
      return next(error);
    }
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }

      const token = jwt.sign({ id: user.id }, jwtSecret, { expiresIn: '7d' });
      return res.json({ token, user: publicUser(user) });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

  app.get('/api/products', authenticate, (_req, res) => {
    const products = db.prepare(`
      SELECT id, name, unit, price_cents AS priceCents, stock
      FROM products
      ORDER BY name COLLATE NOCASE
    `).all();
    return res.json({ products });
  });

  app.post('/api/products', authenticate, requireAdmin, (req, res, next) => {
    try {
      const product = parseProduct(req.body);
      const result = db.prepare(`
        INSERT INTO products (name, unit, price_cents, stock)
        VALUES (?, ?, ?, ?)
      `).run(product.name, product.unit, product.priceCents, product.stock);
      return res.status(201).json({
        product: { id: result.lastInsertRowid, ...product },
      });
    } catch (error) {
      return next(error);
    }
  });

  app.put('/api/products/:id', authenticate, requireAdmin, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Produto inválido.');
      const product = parseProduct(req.body);
      const result = db.prepare(`
        UPDATE products
        SET name = ?, unit = ?, price_cents = ?, stock = ?
        WHERE id = ?
      `).run(product.name, product.unit, product.priceCents, product.stock, id);
      if (result.changes !== 1) throw new HttpError(404, 'Produto não encontrado.');
      return res.json({ product: { id, ...product } });
    } catch (error) {
      return next(error);
    }
  });

  app.delete('/api/products/:id', authenticate, requireAdmin, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Produto inválido.');
      const used = db.prepare('SELECT 1 FROM sale_items WHERE product_id = ? LIMIT 1').get(id);
      if (used) throw new HttpError(409, 'Produto com vendas registradas não pode ser removido.');
      const result = db.prepare('DELETE FROM products WHERE id = ?').run(id);
      if (result.changes !== 1) throw new HttpError(404, 'Produto não encontrado.');
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/clients', authenticate, (_req, res) => {
    const clients = db.prepare(`
      SELECT id, name, phone, email
      FROM clients
      ORDER BY name COLLATE NOCASE
    `).all();
    return res.json({ clients });
  });

  app.post('/api/clients', authenticate, requireAdmin, (req, res, next) => {
    try {
      const client = parseClient(req.body);
      const result = db.prepare(`
        INSERT INTO clients (name, phone, email)
        VALUES (?, ?, ?)
      `).run(client.name, client.phone, client.email);
      return res.status(201).json({ client: { id: result.lastInsertRowid, ...client } });
    } catch (error) {
      return next(error);
    }
  });

  app.put('/api/clients/:id', authenticate, requireAdmin, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Cliente inválido.');
      const client = parseClient(req.body);
      const result = db.prepare(`
        UPDATE clients SET name = ?, phone = ?, email = ? WHERE id = ?
      `).run(client.name, client.phone, client.email, id);
      if (result.changes !== 1) throw new HttpError(404, 'Cliente não encontrado.');
      return res.json({ client: { id, ...client } });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/sales', authenticate, (req, res, next) => {
    try {
      const { clientId = null, paymentMethod, items } = requireObject(req.body);
      if (clientId !== null && (!Number.isSafeInteger(clientId) || clientId < 1)) {
        throw new HttpError(400, 'Cliente inválido.');
      }
      if (!['avista', 'prazo'].includes(paymentMethod)) {
        throw new HttpError(400, 'Escolha pagamento à vista ou a prazo.');
      }
      if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
        throw new HttpError(400, 'A venda deve conter de 1 a 30 itens.');
      }

      const quantities = new Map();
      for (const item of items) {
        if (!item || typeof item !== 'object'
          || !Number.isSafeInteger(item.productId) || item.productId < 1
          || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) {
          throw new HttpError(400, 'Produto e quantidade inválidos.');
        }
        quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
      }

      const sale = db.transaction(() => {
        if (clientId !== null && !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(clientId)) {
          throw new HttpError(404, 'Cliente não encontrado.');
        }

        const lineItems = [];
        let totalCents = 0;
        const findProduct = db.prepare(`
          SELECT id, name, price_cents AS priceCents, stock FROM products WHERE id = ?
        `);
        const reduceStock = db.prepare(
          'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
        );

        for (const [productId, quantity] of quantities) {
          const product = findProduct.get(productId);
          if (!product) throw new HttpError(404, `Produto ${productId} não encontrado.`);
          if (product.stock < quantity) {
            throw new HttpError(409, `Estoque insuficiente para ${product.name}.`);
          }
          const subtotalCents = product.priceCents * quantity;
          if (!Number.isSafeInteger(subtotalCents) || !Number.isSafeInteger(totalCents + subtotalCents)) {
            throw new HttpError(400, 'O total da venda excede o limite permitido.');
          }
          totalCents += subtotalCents;
          lineItems.push({ ...product, quantity, subtotalCents });
          if (reduceStock.run(quantity, productId, quantity).changes !== 1) {
            throw new HttpError(409, `Estoque insuficiente para ${product.name}.`);
          }
        }

        const paymentStatus = paymentMethod === 'avista' ? 'paga' : 'pendente';
        const result = db.prepare(`
          INSERT INTO sales (user_id, client_id, payment_method, payment_status, total_cents, paid_at)
          VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 'paga' THEN datetime('now') ELSE NULL END)
        `).run(req.user.id, clientId, paymentMethod, paymentStatus, totalCents, paymentStatus);
        const insertItem = db.prepare(`
          INSERT INTO sale_items
            (sale_id, product_id, product_name, quantity, unit_price_cents, subtotal_cents)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const item of lineItems) {
          insertItem.run(
            result.lastInsertRowid,
            item.id,
            item.name,
            item.quantity,
            item.priceCents,
            item.subtotalCents,
          );
        }
        return {
          id: result.lastInsertRowid,
          totalCents,
          paymentMethod,
          paymentStatus,
          items: lineItems.map((item) => ({
            productId: item.id,
            name: item.name,
            quantity: item.quantity,
            unitPriceCents: item.priceCents,
            subtotalCents: item.subtotalCents,
          })),
        };
      })();

      return res.status(201).json({ sale });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/sales', authenticate, (_req, res) => {
    const sales = db.prepare(`
      SELECT sales.id, sales.payment_method AS paymentMethod,
        sales.payment_status AS paymentStatus, sales.total_cents AS totalCents,
        sales.created_at AS createdAt, sales.paid_at AS paidAt,
        COALESCE(clients.name, 'Consumidor final') AS clientName,
        users.name AS sellerName
      FROM sales
      JOIN users ON users.id = sales.user_id
      LEFT JOIN clients ON clients.id = sales.client_id
      ORDER BY sales.created_at DESC, sales.id DESC
      LIMIT 100
    `).all();
    return res.json({ sales });
  });

  app.post('/api/sales/:id/settle', authenticate, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Venda inválida.');
      const result = db.prepare(`
        UPDATE sales
        SET payment_status = 'paga', paid_at = datetime('now')
        WHERE id = ? AND payment_status = 'pendente'
      `).run(id);
      if (result.changes !== 1) {
        const sale = db.prepare('SELECT id FROM sales WHERE id = ?').get(id);
        if (!sale) throw new HttpError(404, 'Venda não encontrada.');
        throw new HttpError(409, 'Esta venda já foi paga.');
      }
      return res.json({ message: 'Pagamento registrado.' });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/reports/sales', authenticate, (req, res, next) => {
    try {
      const from = parseDate(req.query.from, 'data inicial');
      const to = parseDate(req.query.to, 'data final');
      if (from > to) throw new HttpError(400, 'A data inicial deve ser anterior à data final.');

      const summary = db.prepare(`
        SELECT COUNT(*) AS saleCount,
          COALESCE(SUM(total_cents), 0) AS totalCents,
          COALESCE(SUM(CASE WHEN payment_status = 'pendente' THEN total_cents ELSE 0 END), 0)
            AS pendingCents
        FROM sales
        WHERE date(created_at) BETWEEN ? AND ?
      `).get(from, to);
      const byClient = db.prepare(`
        SELECT COALESCE(clients.name, 'Consumidor final') AS clientName,
          COUNT(sales.id) AS saleCount,
          SUM(sales.total_cents) AS totalCents
        FROM sales
        LEFT JOIN clients ON clients.id = sales.client_id
        WHERE date(sales.created_at) BETWEEN ? AND ?
        GROUP BY COALESCE(clients.id, 0), COALESCE(clients.name, 'Consumidor final')
        ORDER BY totalCents DESC
      `).all(from, to);
      return res.json({ from, to, summary, byClient });
    } catch (error) {
      return next(error);
    }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

  if (serveFrontend) {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const clientDist = path.resolve(currentDir, '../dist');
    app.use(express.static(clientDist));
    app.get(/.*/, (req, res, next) => {
      if (req.accepts('html') === false) return next();
      return res.sendFile(path.join(clientDist, 'index.html'), (error) => {
        if (error) next();
      });
    });
  }

  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return res.status(409).json({ error: 'Este registro está relacionado a outras operações.' });
    }
    console.error(error);
    return res.status(500).json({ error: 'Ocorreu um erro interno.' });
  });
  return app;
}
