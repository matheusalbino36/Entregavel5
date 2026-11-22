# Memória em Duelo

Jogo web da memória com contas de jogador, partidas registradas, histórico individual e ranking.

## Tecnologias

- Frontend: React, HTML, CSS e JavaScript.
- Backend: Node.js e Express, com serviços REST.
- Banco de dados: SQLite.
- Autenticação: JWT; senhas armazenadas com hash bcrypt.
- Testes: `node:test` e Supertest.

## Executar localmente

Requer Node.js 20 ou superior.

```powershell
npm install
npm test
npm run dev
```

O frontend abre no endereço mostrado pelo Vite (normalmente `http://localhost:5173`) e encaminha as chamadas `/api` ao backend na porta 3001. Para verificar a versão de produção:

```powershell
npm run build
$env:JWT_SECRET = "substitua-por-uma-chave-privada"
npm start
```

O servidor fica disponível na porta `3001` (ou na porta definida por `PORT`). O banco é criado em `data/memoria.db`; configure `DB_PATH` para escolher outro caminho. Em produção, sempre configure um `JWT_SECRET` privado.

## Transações e rotas REST

| Transação | Rota | Acesso |
| --- | --- | --- |
| Criar conta | `POST /api/auth/register` | Público |
| Entrar | `POST /api/auth/login` | Público |
| Consultar perfil autenticado | `GET /api/me` | Autenticado |
| Iniciar partida | `POST /api/games` | Autenticado |
| Salvar resultado de partida | `POST /api/games/:id/complete` | Dono da partida |
| Consultar histórico | `GET /api/games/history` | Apenas o próprio usuário |
| Consultar ranking | `GET /api/leaderboard` | Autenticado |

As senhas nunca são retornadas pela API. A conclusão de uma partida calcula a pontuação no serviço e só pode ocorrer uma vez pelo usuário proprietário.

## Testes dos serviços

Execute `npm test`. Os testes cobrem cadastro e login, validação, autenticação, conclusão de partidas, pontuação, histórico, ranking e autorização por proprietário.

## Publicação na AWS (EC2)

O projeto pode ser publicado em uma instância Linux do EC2. A conta AWS e as credenciais ficam sob controle do estudante; não coloque chaves, senhas ou arquivos `.env` no Git.

1. Crie uma instância EC2 Ubuntu e um par de chaves para acesso SSH.
2. No grupo de segurança, permita SSH (`22`) somente a partir do seu IP. Permita TCP `3001` para a demonstração.
3. Envie o projeto para um repositório Git e clone-o na instância (ou transfira os arquivos). Não envie `node_modules`, `.env` nem dados pessoais.
4. Instale Node.js 20 ou superior e as ferramentas de compilação necessárias ao SQLite nativo. Na instância, execute `npm install`, `npm test` e `npm run build`.
5. Crie o diretório persistente e configure o segredo JWT:

   ```bash
   sudo mkdir -p /var/lib/memoria-em-duelo
   sudo chown ubuntu:ubuntu /var/lib/memoria-em-duelo
   sudo install -m 600 /dev/null /etc/memoria-em-duelo.env
   sudo nano /etc/memoria-em-duelo.env
   ```

   No arquivo, defina `JWT_SECRET` com um segredo privado gerado para a aplicação. Não publique esse valor.
6. Copie `deploy/memoria-em-duelo.service` para `/etc/systemd/system/` e inicie o serviço:

   ```bash
   sudo cp deploy/memoria-em-duelo.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now memoria-em-duelo
   sudo systemctl status memoria-em-duelo
   ```

7. Teste `http://IP-PÚBLICO-DA-EC2:3001`, crie uma conta de teste e conclua uma partida. Entregue essa URL ao professor.

O SQLite precisa ficar em armazenamento persistente da instância; não use um diretório temporário. A URL HTTP é apenas para demonstração acadêmica: use somente contas e senhas de teste, nunca reutilize senhas pessoais e não armazene dados reais. Para uma publicação mais completa, configure HTTPS e um domínio/reverse proxy.
