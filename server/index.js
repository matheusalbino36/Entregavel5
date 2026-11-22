import { createApp } from './app.js';
import { createDatabase } from './db.js';

const jwtSecret = process.env.JWT_SECRET
  || (process.env.NODE_ENV === 'production' ? '' : 'local-development-secret-change-before-deploy');
const db = createDatabase();
const app = createApp({ db, jwtSecret });
const port = Number(process.env.PORT || 3001);

if (!jwtSecret) {
  throw new Error('Configure JWT_SECRET no ambiente de produção.');
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Memória em Duelo disponível na porta ${port}.`);
});
