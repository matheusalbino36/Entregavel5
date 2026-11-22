# CaixaFácil — Gestão de Cantina

Aplicação web acadêmica para controlar produtos, clientes, vendas, estoque e pagamentos de uma cantina. O sistema registra vendas à vista e a prazo, baixa pagamentos pendentes e gera relatórios por período e cliente. Não emite nota fiscal oficial.

## Funcionalidades e transações

1. Criar conta e entrar no sistema.
2. Cadastrar e atualizar produtos, preços, unidades e estoque.
3. Cadastrar e atualizar clientes.
4. Registrar venda com um ou mais produtos e atualizar o estoque.
5. Registrar pagamento de uma venda a prazo pendente.
6. Consultar histórico de vendas.
7. Gerar relatório de vendas por período, agrupado por cliente.

A primeira conta cadastrada recebe o perfil `admin`; as seguintes recebem `operador`. Administradores podem gerenciar produtos e clientes. Operadores podem consultar os cadastros e registrar vendas. As rotas privadas exigem JWT.

## Tecnologias

- Frontend: React, HTML, CSS e JavaScript.
- Backend: Node.js e Express, com API REST.
- Banco de dados: SQLite.
- Autenticação: JWT; senhas armazenadas com hash bcrypt.
- Testes formais dos serviços: `node:test` e Supertest.
- Versionamento: Git.

## Banco de dados

- `users`: nome, e-mail, hash de senha e perfil.
- `products`: nome, unidade de medida, preço em centavos e estoque.
- `clients`: nome, telefone e e-mail.
- `sales`: vendedor, cliente opcional, forma/status do pagamento, total e datas.
- `sale_items`: produtos e quantidades da venda, preservando o nome e preço praticado.

Uma venda e a respectiva baixa de estoque são feitas em uma transação SQLite. Se algum item não tiver estoque suficiente, a venda inteira é cancelada. Vendas a prazo começam pendentes; o pagamento pode ser baixado uma vez.

## Serviços REST (entrada e saída)

As rotas, exceto cadastro e login, exigem `Authorization: Bearer <token>`. Valores monetários enviados à API são inteiros em centavos.

| Serviço | Entrada | Saída / acesso |
| --- | --- | --- |
| `POST /api/auth/register` | `{ name, email, password }` | `201 { token, user }`; primeira conta é admin |
| `POST /api/auth/login` | `{ email, password }` | `{ token, user }` |
| `GET /api/me` | — | Perfil autenticado |
| `GET /api/products` | — | Catálogo e estoque |
| `POST /api/products` | `{ name, unit, priceCents, stock }` | Produto criado; admin |
| `PUT /api/products/:id` | `{ name, unit, priceCents, stock }` | Produto atualizado; admin |
| `DELETE /api/products/:id` | — | Remove produto sem vendas; admin |
| `GET /api/clients` | — | Lista de clientes |
| `POST /api/clients` | `{ name, phone?, email? }` | Cliente criado; admin |
| `PUT /api/clients/:id` | `{ name, phone?, email? }` | Cliente atualizado; admin |
| `POST /api/sales` | `{ clientId?, paymentMethod, items: [{ productId, quantity }] }` | Venda, total e itens; autenticação |
| `GET /api/sales` | — | Histórico recente de vendas |
| `POST /api/sales/:id/settle` | — | Baixa de pagamento pendente |
| `GET /api/reports/sales?from=AAAA-MM-DD&to=AAAA-MM-DD` | Período | Totais e vendas agrupadas por cliente |

`paymentMethod` aceita `avista` ou `prazo`. Erros de validação, estoque insuficiente, falta de autenticação ou permissão retornam códigos HTTP apropriados e uma mensagem JSON.

## Executar localmente

Requer Node.js 20 ou superior.

```powershell
npm install
npm test
npm run dev
```

O frontend abre normalmente em `http://localhost:5173` e encaminha `/api` ao servidor na porta 3001. Para executar a versão compilada:

```powershell
npm run build
$env:JWT_SECRET = "configure-um-segredo-local"
npm start
```

O banco local é criado em `data/vendas-cantina.db`. Configure `DB_PATH` para escolher outro caminho. Em produção, sempre configure um `JWT_SECRET` privado.

## Testes dos serviços

Execute `npm test`. Os testes cobrem cadastro e perfis, autenticação/autorização, cadastro de produtos e clientes, vendas à vista e a prazo, baixa de pagamentos, relatórios e rollback em caso de estoque insuficiente.

## Publicação na AWS EC2 (Ubuntu Linux)

1. Crie uma instância EC2 Ubuntu e uma chave para SSH. Verifique os custos estimados na AWS.
2. No grupo de segurança, permita SSH (`22`) somente a partir do seu IP e TCP `3001` para a demonstração.
3. Clone este repositório na instância:

   ```bash
   sudo apt update
   sudo apt install -y curl git build-essential
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs
   node --version
   npm --version
   sudo git clone https://github.com/matheusalbino36/Entregavel5.git /opt/vendas-cantina
   sudo chown -R ubuntu:ubuntu /opt/vendas-cantina
   cd /opt/vendas-cantina
   npm install
   npm test
   npm run build
   ```

4. Crie um diretório persistente para o banco e um arquivo de ambiente privado:

   ```bash
   sudo mkdir -p /var/lib/vendas-cantina
   sudo chown ubuntu:ubuntu /var/lib/vendas-cantina
   sudo install -m 600 /dev/null /etc/vendas-cantina.env
   sudo nano /etc/vendas-cantina.env
   ```

   Defina `JWT_SECRET` com um segredo privado gerado para a aplicação; não o publique nem o envie ao GitHub.
5. Instale e inicie o serviço:

   ```bash
   sudo cp deploy/vendas-cantina.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now vendas-cantina
   sudo systemctl status vendas-cantina
   ```

6. Abra `http://IP-PÚBLICO-DA-EC2:3001`, crie a conta administradora, cadastre produtos e teste uma venda. Entregue a URL pública ao professor.

A URL HTTP é apenas para demonstração acadêmica: use contas de teste, nunca reutilize senhas pessoais e não armazene dados reais. O SQLite fica no volume persistente da instância. Para uso real, configure HTTPS e controles adicionais.
