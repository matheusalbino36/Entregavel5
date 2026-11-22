import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/db.js';

const jwtSecret = 'test-secret-with-enough-entropy';
let app;
let db;

async function register(name, email) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ name, email, password: 'senha-segura-123' });
  assert.equal(response.status, 201);
  return response.body;
}

async function createProduct(token, overrides = {}) {
  return request(app)
    .post('/api/products')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Suco natural',
      unit: 'un',
      priceCents: 750,
      stock: 5,
      ...overrides,
    });
}

describe('serviços do sistema de vendas', () => {
  beforeEach(() => {
    db = createDatabase(':memory:');
    app = createApp({ db, jwtSecret });
  });

  afterEach(() => db.close());

  it('cadastra usuário administrador inicial e operadores, com senha protegida', async () => {
    const admin = await register('Ana Silva', 'ANA@example.com');
    const operator = await register('Bia Costa', 'bia@example.com');
    assert.equal(admin.user.role, 'admin');
    assert.equal(operator.user.role, 'operador');
    assert.equal(Object.hasOwn(admin.user, 'password_hash'), false);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@example.com', password: 'senha-segura-123' });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, 'admin');

    const profile = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${login.body.token}`);
    assert.equal(profile.status, 200);
    assert.equal(profile.body.user.name, 'Ana Silva');
  });

  it('exige autenticação e restringe cadastros ao administrador', async () => {
    const unauthorized = await request(app).get('/api/products');
    assert.equal(unauthorized.status, 401);

    const admin = await register('Ana Silva', 'ana@example.com');
    const operator = await register('Bia Costa', 'bia@example.com');
    const forbidden = await createProduct(operator.token);
    assert.equal(forbidden.status, 403);

    const created = await createProduct(admin.token);
    assert.equal(created.status, 201);
    assert.equal(created.body.product.priceCents, 750);
  });

  it('atualiza produtos e clientes e protege itens usados em vendas', async () => {
    const admin = await register('Ana Silva', 'ana@example.com');
    const productResponse = await createProduct(admin.token);
    const productId = productResponse.body.product.id;
    const updatedProduct = await request(app)
      .put(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Suco integral', unit: 'garrafa', priceCents: 900, stock: 7 });
    assert.equal(updatedProduct.status, 200);
    assert.equal(updatedProduct.body.product.name, 'Suco integral');

    const clientResponse = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Carlos Lima' });
    const updatedClient = await request(app)
      .put(`/api/clients/${clientResponse.body.client.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Carlos Lima', phone: '85999999999', email: 'carlos@example.com' });
    assert.equal(updatedClient.status, 200);
    assert.equal(updatedClient.body.client.email, 'carlos@example.com');

    await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ paymentMethod: 'avista', items: [{ productId, quantity: 1 }] })
      .expect(201);
    const protectedDelete = await request(app)
      .delete(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    assert.equal(protectedDelete.status, 409);

    const unusedProduct = await createProduct(admin.token, { name: 'Água mineral' });
    const deleted = await request(app)
      .delete(`/api/products/${unusedProduct.body.product.id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    assert.equal(deleted.status, 204);
  });

  it('registra venda à vista, baixa estoque e produz relatório por cliente', async () => {
    const admin = await register('Ana Silva', 'ana@example.com');
    const productResponse = await createProduct(admin.token);
    const productId = productResponse.body.product.id;
    const clientResponse = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Carlos Lima', phone: '85999999999', email: 'carlos@example.com' });
    assert.equal(clientResponse.status, 201);

    const saleResponse = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        clientId: clientResponse.body.client.id,
        paymentMethod: 'avista',
        items: [{ productId, quantity: 2 }],
      });
    assert.equal(saleResponse.status, 201);
    assert.equal(saleResponse.body.sale.totalCents, 1500);
    assert.equal(saleResponse.body.sale.paymentStatus, 'paga');

    const products = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${admin.token}`);
    assert.equal(products.body.products[0].stock, 3);

    const report = await request(app)
      .get(`/api/reports/sales?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`)
      .set('Authorization', `Bearer ${admin.token}`);
    assert.equal(report.status, 200);
    assert.equal(report.body.summary.totalCents, 1500);
    assert.equal(report.body.byClient[0].clientName, 'Carlos Lima');
  });

  it('registra venda a prazo, permite baixar o pagamento uma vez', async () => {
    const admin = await register('Ana Silva', 'ana@example.com');
    const productResponse = await createProduct(admin.token);
    const saleResponse = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        paymentMethod: 'prazo',
        items: [{ productId: productResponse.body.product.id, quantity: 1 }],
      });
    assert.equal(saleResponse.status, 201);
    assert.equal(saleResponse.body.sale.paymentStatus, 'pendente');

    const settled = await request(app)
      .post(`/api/sales/${saleResponse.body.sale.id}/settle`)
      .set('Authorization', `Bearer ${admin.token}`);
    assert.equal(settled.status, 200);

    const duplicateSettlement = await request(app)
      .post(`/api/sales/${saleResponse.body.sale.id}/settle`)
      .set('Authorization', `Bearer ${admin.token}`);
    assert.equal(duplicateSettlement.status, 409);

    const history = await request(app)
      .get('/api/sales')
      .set('Authorization', `Bearer ${admin.token}`);
    assert.equal(history.body.sales[0].paymentStatus, 'paga');
  });

  it('rejeita estoque insuficiente sem salvar uma venda parcial', async () => {
    const admin = await register('Ana Silva', 'ana@example.com');
    const productResponse = await createProduct(admin.token, { stock: 1 });
    const saleResponse = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        paymentMethod: 'avista',
        items: [{ productId: productResponse.body.product.id, quantity: 2 }],
      });
    assert.equal(saleResponse.status, 409);

    const products = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${admin.token}`);
    assert.equal(products.body.products[0].stock, 1);
    const sales = await request(app)
      .get('/api/sales')
      .set('Authorization', `Bearer ${admin.token}`);
    assert.deepEqual(sales.body.sales, []);
  });
});
