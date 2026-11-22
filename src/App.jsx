import { useEffect, useMemo, useState } from 'react';

const TOKEN_KEY = 'vendas-cantina-token';
const SECTIONS = [
  { id: 'inicio', label: 'Visão geral', icon: '⌂' },
  { id: 'venda', label: 'Nova venda', icon: '+' },
  { id: 'produtos', label: 'Produtos e estoque', icon: '▦' },
  { id: 'clientes', label: 'Clientes', icon: '♙' },
  { id: 'historico', label: 'Vendas', icon: '↗' },
  { id: 'relatorios', label: 'Relatórios', icon: '▤' },
];

async function request(path, { token, ...options } = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`/api${path}`, { ...options, headers });
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir a operação.');
  return payload;
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function firstDayOfMonth() {
  return `${todayString().slice(0, 7)}-01`;
}

function money(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function displayDate(value) {
  if (!value) return '—';
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('register');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { token, user } = await request(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(mode === 'register'
          ? form
          : { email: form.email, password: form.password }),
      });
      onAuthenticated(token, user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-card">
        <div className="brand-mark" aria-hidden="true">C</div>
        <p className="eyebrow">GESTÃO DE CANTINA</p>
        <h1>Caixa<span>Fácil</span></h1>
        <p className="muted">Vendas, estoque e clientes em um só lugar.</p>
        <div className="auth-tabs" role="tablist" aria-label="Acesso">
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Criar conta</button>
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Entrar</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && (
            <label>Nome
              <input required minLength="2" maxLength="60" autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
          )}
          <label>E-mail
            <input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </label>
          <label>Senha
            <input required type="password" minLength="8" maxLength="72" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          </label>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="primary-button full-width" type="submit" disabled={busy}>
            {busy ? 'Aguarde...' : mode === 'register' ? 'Criar conta da cantina' : 'Entrar no sistema'}
          </button>
        </form>
        <p className="auth-note">A primeira conta cadastrada será administradora.</p>
      </section>
    </main>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState(null);
  const [section, setSection] = useState('inicio');
  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [sales, setSales] = useState([]);
  const [report, setReport] = useState(null);
  const [reportFrom, setReportFrom] = useState(firstDayOfMonth);
  const [reportTo, setReportTo] = useState(todayString);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function refreshData(activeToken = token) {
    const [productData, clientData, saleData] = await Promise.all([
      request('/products', { token: activeToken }),
      request('/clients', { token: activeToken }),
      request('/sales', { token: activeToken }),
    ]);
    setProducts(productData.products);
    setClients(clientData.clients);
    setSales(saleData.sales);
  }

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    Promise.all([
      request('/me', { token }),
      request('/products', { token }),
      request('/clients', { token }),
      request('/sales', { token }),
    ]).then(([profile, productData, clientData, saleData]) => {
      if (!active) return;
      setUser(profile.user);
      setProducts(productData.products);
      setClients(clientData.clients);
      setSales(saleData.sales);
    }).catch((loadError) => {
      if (!active) return;
      localStorage.removeItem(TOKEN_KEY);
      setToken('');
      setUser(null);
      setError(loadError.message);
    });
    return () => { active = false; };
  }, [token]);

  const todaySales = useMemo(
    () => sales.filter((sale) => sale.createdAt.slice(0, 10) === todayString()),
    [sales],
  );
  const todayRevenue = todaySales.reduce(
    (total, sale) => total + (sale.paymentStatus === 'paga' ? sale.totalCents : 0),
    0,
  );
  const lowStock = products.filter((product) => product.stock <= 5).length;

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setUser(null);
    setReport(null);
    setError('');
    setNotice('');
  }

  function authenticate(nextToken, nextUser) {
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setUser(nextUser);
    setError('');
    setNotice('');
  }

  if (!user) return <AuthScreen onAuthenticated={authenticate} />;

  async function runAction(action, successMessage) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (successMessage) setNotice(successMessage);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadReport() {
    await runAction(async () => {
      const query = new URLSearchParams({ from: reportFrom, to: reportTo });
      setReport(await request(`/reports/sales?${query}`, { token }));
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="wordmark" href="/" aria-label="CaixaFácil - início">
          <span className="brand-icon">C</span><span>CaixaFácil<small>GESTÃO DE CANTINA</small></span>
        </a>
        <p className="nav-caption">MENU PRINCIPAL</p>
        <nav className="side-nav" aria-label="Menu principal">
          {SECTIONS.map((item) => (
            <button key={item.id} type="button" className={section === item.id ? 'selected' : ''} onClick={() => { setSection(item.id); setError(''); setNotice(''); }}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
              {item.id === 'produtos' && lowStock > 0 && <span className="nav-badge">{lowStock}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-card">
            <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
            <span className="profile-copy"><strong>{user.name}</strong><small>{user.role === 'admin' ? 'Administrador' : 'Operador'}</small></span>
            <button type="button" className="signout-button" onClick={signOut} aria-label="Sair">↪</button>
          </div>
          <p>CaixaFácil <span>·</span> versão acadêmica</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div><p className="eyebrow">PAINEL DE CONTROLE</p><h1>{SECTIONS.find((item) => item.id === section)?.label}</h1></div>
          <div className="topbar-actions"><span className="today-label">{new Date().toLocaleDateString('pt-BR', { dateStyle: 'full' })}</span><button type="button" className="icon-button" onClick={() => runAction(() => refreshData(), 'Dados atualizados.')} aria-label="Atualizar dados">⟳</button></div>
        </header>

        {error && <p className="message error-message" role="alert">{error}</p>}
        {notice && <p className="message success-message" role="status">{notice}</p>}

        {section === 'inicio' && (
          <section className="page-section">
            <div className="welcome-banner">
              <div><p className="eyebrow">RESUMO DO DIA</p><h2>Olá, {user.name.split(' ')[0]}!</h2><p>Acompanhe as vendas e o estoque da cantina.</p></div>
              <button type="button" className="primary-button" onClick={() => setSection('venda')}>Registrar venda <span>→</span></button>
            </div>
            <div className="stat-grid">
              <article className="stat-card"><span className="stat-icon pink">R$</span><div><small>VENDAS PAGAS HOJE</small><strong>{money(todayRevenue)}</strong><p>Valores recebidos</p></div></article>
              <article className="stat-card"><span className="stat-icon purple">↗</span><div><small>VENDAS DE HOJE</small><strong>{todaySales.length}</strong><p>À vista e a prazo</p></div></article>
              <article className="stat-card"><span className="stat-icon green">▦</span><div><small>PRODUTOS CADASTRADOS</small><strong>{products.length}</strong><p>{lowStock} com estoque baixo</p></div></article>
              <article className="stat-card"><span className="stat-icon gold">♙</span><div><small>CLIENTES</small><strong>{clients.length}</strong><p>Na base da cantina</p></div></article>
            </div>
            <div className="panel">
              <div className="panel-heading"><div><p className="eyebrow">ATIVIDADE RECENTE</p><h2>Últimas vendas</h2></div><button type="button" className="text-button" onClick={() => setSection('historico')}>Ver todas <span>→</span></button></div>
              <SalesTable sales={sales.slice(0, 5)} onSettle={(id) => runAction(async () => { await request(`/sales/${id}/settle`, { token, method: 'POST' }); await refreshData(); }, 'Pagamento baixado.')} busy={busy} />
            </div>
          </section>
        )}

        {section === 'produtos' && (
          <ProductsSection products={products} token={token} isAdmin={user.role === 'admin'} busy={busy} runAction={runAction} refreshData={refreshData} />
        )}

        {section === 'clientes' && (
          <ClientsSection clients={clients} token={token} isAdmin={user.role === 'admin'} busy={busy} runAction={runAction} refreshData={refreshData} />
        )}

        {section === 'venda' && (
          <SaleSection products={products} clients={clients} token={token} busy={busy} runAction={runAction} refreshData={refreshData} />
        )}

        {section === 'historico' && (
          <section className="page-section">
            <div className="panel"><div className="panel-heading"><div><p className="eyebrow">MOVIMENTAÇÕES</p><h2>Histórico de vendas</h2></div><span className="record-count">{sales.length} últimas</span></div>
              <SalesTable sales={sales} onSettle={(id) => runAction(async () => { await request(`/sales/${id}/settle`, { token, method: 'POST' }); await refreshData(); }, 'Pagamento baixado.')} busy={busy} />
            </div>
          </section>
        )}

        {section === 'relatorios' && (
          <ReportsSection
            from={reportFrom}
            to={reportTo}
            setFrom={setReportFrom}
            setTo={setReportTo}
            report={report}
            onSearch={loadReport}
            busy={busy}
          />
        )}
      </main>
    </div>
  );
}

function ProductsSection({ products, token, isAdmin, busy, runAction, refreshData }) {
  const emptyForm = { name: '', unit: 'un', price: '', stock: '' };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);

  function edit(product) {
    setEditingId(product.id);
    setForm({
      name: product.name,
      unit: product.unit,
      price: (product.priceCents / 100).toFixed(2),
      stock: String(product.stock),
    });
  }

  async function submit(event) {
    event.preventDefault();
    const body = {
      name: form.name,
      unit: form.unit,
      priceCents: Math.round(Number(form.price.replace(',', '.')) * 100),
      stock: Number(form.stock),
    };
    await runAction(async () => {
      await request(editingId ? `/products/${editingId}` : '/products', {
        token,
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      setForm(emptyForm);
      setEditingId(null);
      await refreshData();
    }, editingId ? 'Produto atualizado.' : 'Produto cadastrado.');
  }

  return (
    <section className="page-section">
      {isAdmin && <div className="panel"><div className="panel-heading"><div><p className="eyebrow">{editingId ? 'EDITAR ITEM' : 'NOVO ITEM'}</p><h2>{editingId ? 'Atualizar produto' : 'Cadastrar produto'}</h2></div></div>
        <form className="form-grid product-form" onSubmit={submit}>
          <label>Nome do produto<input required minLength="2" maxLength="80" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Suco de laranja" /></label>
          <label>Unidade<input required maxLength="20" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} placeholder="un, kg, litro" /></label>
          <label>Preço (R$)<input required type="number" min="0.01" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="0,00" /></label>
          <label>Estoque inicial<input required type="number" min="0" step="1" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} placeholder="0" /></label>
          <div className="form-actions"><button className="primary-button" disabled={busy}>{editingId ? 'Salvar alterações' : 'Adicionar produto'}</button>{editingId && <button type="button" className="secondary-button" onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancelar</button>}</div>
        </form>
      </div>}
      <div className="panel"><div className="panel-heading"><div><p className="eyebrow">CATÁLOGO</p><h2>Produtos e estoque</h2></div><span className="record-count">{products.length} produtos</span></div>
        {products.length === 0 ? <EmptyState text="Ainda não há produtos. Cadastre o primeiro item da cantina." /> : (
          <div className="table-wrap"><table><thead><tr><th>Produto</th><th>Unidade</th><th>Preço</th><th>Estoque</th>{isAdmin && <th>Ações</th>}</tr></thead>
            <tbody>{products.map((product) => <tr key={product.id}><td className="table-primary">{product.name}</td><td>{product.unit}</td><td>{money(product.priceCents)}</td><td><span className={`stock-pill ${product.stock <= 5 ? 'low' : ''}`}>{product.stock}</span></td>{isAdmin && <td className="row-actions"><button type="button" className="table-action" onClick={() => edit(product)}>Editar</button><button type="button" className="table-action danger" onClick={() => runAction(async () => { await request(`/products/${product.id}`, { token, method: 'DELETE' }); await refreshData(); }, 'Produto removido.')}>Remover</button></td>}</tr>)}</tbody>
          </table></div>
        )}
      </div>
    </section>
  );
}

function ClientsSection({ clients, token, isAdmin, busy, runAction, refreshData }) {
  const emptyForm = { name: '', phone: '', email: '' };
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);

  function edit(client) {
    setEditingId(client.id);
    setForm({ name: client.name, phone: client.phone || '', email: client.email || '' });
  }

  async function submit(event) {
    event.preventDefault();
    await runAction(async () => {
      await request(editingId ? `/clients/${editingId}` : '/clients', {
        token,
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(form),
      });
      setForm(emptyForm);
      setEditingId(null);
      await refreshData();
    }, editingId ? 'Cliente atualizado.' : 'Cliente cadastrado.');
  }

  return (
    <section className="page-section">
      {isAdmin && <div className="panel"><div className="panel-heading"><div><p className="eyebrow">{editingId ? 'EDITAR CLIENTE' : 'NOVO CLIENTE'}</p><h2>{editingId ? 'Atualizar cadastro' : 'Cadastrar cliente'}</h2></div></div>
        <form className="form-grid client-form" onSubmit={submit}>
          <label>Nome<input required minLength="2" maxLength="100" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nome do cliente" /></label>
          <label>Telefone<input maxLength="30" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="(00) 00000-0000" /></label>
          <label>E-mail<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="cliente@exemplo.com" /></label>
          <div className="form-actions"><button className="primary-button" disabled={busy}>{editingId ? 'Salvar alterações' : 'Adicionar cliente'}</button>{editingId && <button type="button" className="secondary-button" onClick={() => { setEditingId(null); setForm(emptyForm); }}>Cancelar</button>}</div>
        </form>
      </div>}
      <div className="panel"><div className="panel-heading"><div><p className="eyebrow">RELACIONAMENTO</p><h2>Clientes</h2></div><span className="record-count">{clients.length} clientes</span></div>
        {clients.length === 0 ? <EmptyState text="Nenhum cliente cadastrado ainda." /> : (
          <div className="table-wrap"><table><thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th>{isAdmin && <th>Ações</th>}</tr></thead>
            <tbody>{clients.map((client) => <tr key={client.id}><td className="table-primary">{client.name}</td><td>{client.phone || '—'}</td><td>{client.email || '—'}</td>{isAdmin && <td><button type="button" className="table-action" onClick={() => edit(client)}>Editar</button></td>}</tr>)}</tbody>
          </table></div>
        )}
      </div>
    </section>
  );
}

function SaleSection({ products, clients, token, busy, runAction, refreshData }) {
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [clientId, setClientId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('avista');
  const [cart, setCart] = useState([]);
  const [lastSale, setLastSale] = useState(null);
  const selectedProduct = products.find((product) => product.id === Number(productId));
  const totalCents = cart.reduce((total, item) => total + item.priceCents * item.quantity, 0);

  function addItem(event) {
    event.preventDefault();
    if (!selectedProduct || !Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1) return;
    const amount = Number(quantity);
    const existing = cart.find((item) => item.productId === selectedProduct.id);
    const nextAmount = amount + (existing?.quantity || 0);
    if (nextAmount > selectedProduct.stock) {
      return runAction(async () => { throw new Error(`Estoque disponível: ${selectedProduct.stock} ${selectedProduct.unit}.`); });
    }
    setCart(existing
      ? cart.map((item) => item.productId === selectedProduct.id ? { ...item, quantity: nextAmount } : item)
      : [...cart, { productId: selectedProduct.id, name: selectedProduct.name, unit: selectedProduct.unit, priceCents: selectedProduct.priceCents, quantity: amount }]);
    setQuantity('1');
  }

  async function submitSale() {
    await runAction(async () => {
      const response = await request('/sales', {
        token,
        method: 'POST',
        body: JSON.stringify({
          clientId: clientId ? Number(clientId) : null,
          paymentMethod,
          items: cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        }),
      });
      setLastSale(response.sale);
      setCart([]);
      setClientId('');
      await refreshData();
    }, 'Venda registrada e estoque atualizado.');
  }

  return (
    <section className="page-section sale-layout">
      <div className="panel">
        <div className="panel-heading"><div><p className="eyebrow">PONTO DE VENDA</p><h2>Adicionar produtos</h2></div><span className="panel-icon">＋</span></div>
        {products.filter((product) => product.stock > 0).length === 0 ? <EmptyState text="Cadastre produtos com estoque disponível antes de registrar uma venda." /> : (
          <form className="add-item-form" onSubmit={addItem}>
            <label>Produto<select required value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">Selecione um produto</option>{products.filter((product) => product.stock > 0).map((product) => <option key={product.id} value={product.id}>{product.name} — {money(product.priceCents)} (estoque: {product.stock})</option>)}</select></label>
            <div className="quantity-row"><label>Quantidade<input type="number" min="1" step="1" max={selectedProduct?.stock || 10000} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><button type="submit" className="secondary-button">Adicionar</button></div>
          </form>
        )}
      </div>
      <div className="panel checkout-panel">
        <div className="panel-heading"><div><p className="eyebrow">RESUMO</p><h2>Finalizar venda</h2></div><span className="record-count">{cart.length} itens</span></div>
        {cart.length === 0 ? <EmptyState text="Adicione produtos para começar a venda." /> : (
          <ul className="cart-list">{cart.map((item) => <li key={item.productId}><span><strong>{item.name}</strong><small>{item.quantity} {item.unit} × {money(item.priceCents)}</small></span><strong>{money(item.quantity * item.priceCents)}</strong><button type="button" className="remove-item" onClick={() => setCart(cart.filter((line) => line.productId !== item.productId))} aria-label={`Remover ${item.name}`}>×</button></li>)}</ul>
        )}
        <div className="checkout-fields">
          <label>Cliente (opcional)<select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Consumidor final</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          <label>Forma de pagamento<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="avista">À vista</option><option value="prazo">A prazo (pendente)</option></select></label>
        </div>
        <div className="checkout-total"><span>Total</span><strong>{money(totalCents)}</strong></div>
        <button type="button" className="primary-button full-width" disabled={busy || cart.length === 0} onClick={submitSale}>Registrar venda</button>
        {lastSale && <p className="last-sale-note">Venda #{lastSale.id} registrada · {lastSale.paymentStatus === 'paga' ? 'paga' : 'pagamento pendente'}</p>}
      </div>
    </section>
  );
}

function SalesTable({ sales, onSettle, busy }) {
  if (sales.length === 0) return <EmptyState text="As vendas registradas aparecerão aqui." />;
  return (
    <div className="table-wrap"><table><thead><tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Vendedor</th><th>Pagamento</th><th>Status</th><th>Total</th></tr></thead>
      <tbody>{sales.map((sale) => <tr key={sale.id}><td>#{sale.id}</td><td>{displayDate(sale.createdAt)}</td><td className="table-primary">{sale.clientName}</td><td>{sale.sellerName}</td><td>{sale.paymentMethod === 'avista' ? 'À vista' : 'A prazo'}</td><td><span className={`status-pill ${sale.paymentStatus}`}>{sale.paymentStatus === 'paga' ? 'Paga' : 'Pendente'}</span>{sale.paymentStatus === 'pendente' && <button type="button" disabled={busy} className="table-action settle-action" onClick={() => onSettle(sale.id)}>Baixar</button>}</td><td className="table-primary">{money(sale.totalCents)}</td></tr>)}</tbody>
    </table></div>
  );
}

function ReportsSection({ from, to, setFrom, setTo, report, onSearch, busy }) {
  return (
    <section className="page-section">
      <div className="panel">
        <div className="panel-heading"><div><p className="eyebrow">ANÁLISE DE VENDAS</p><h2>Relatório por período</h2></div></div>
        <div className="report-filters"><label>Data inicial<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Data final<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button type="button" className="primary-button" disabled={busy} onClick={onSearch}>Gerar relatório</button></div>
      </div>
      {report && <>
        <div className="stat-grid report-stats">
          <article className="stat-card"><span className="stat-icon pink">R$</span><div><small>TOTAL VENDIDO</small><strong>{money(report.summary.totalCents)}</strong><p>{report.summary.saleCount} vendas no período</p></div></article>
          <article className="stat-card"><span className="stat-icon gold">◷</span><div><small>A RECEBER</small><strong>{money(report.summary.pendingCents)}</strong><p>Vendas a prazo pendentes</p></div></article>
        </div>
        <div className="panel"><div className="panel-heading"><div><p className="eyebrow">CLIENTES</p><h2>Vendas agrupadas por cliente</h2></div></div>
          {report.byClient.length === 0 ? <EmptyState text="Nenhuma venda no período selecionado." /> : (
            <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Quantidade de vendas</th><th>Total</th></tr></thead><tbody>{report.byClient.map((item) => <tr key={item.clientName}><td className="table-primary">{item.clientName}</td><td>{item.saleCount}</td><td className="table-primary">{money(item.totalCents)}</td></tr>)}</tbody></table></div>
          )}
        </div>
      </>}
    </section>
  );
}

function EmptyState({ text }) {
  return <p className="empty-state">{text}</p>;
}
