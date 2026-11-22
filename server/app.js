import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const difficulties = {
  facil: { pairs: 6, baseScore: 600 },
  medio: { pairs: 8, baseScore: 800 },
  dificil: { pairs: 12, baseScore: 1200 },
};

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

export function createApp({ db, jwtSecret }) {
  if (!db) throw new Error('A conexão com o banco de dados é obrigatória.');
  if (!jwtSecret) throw new Error('A chave JWT é obrigatória.');

  const app = express();
  app.use(express.json({ limit: '20kb' }));

  const authenticate = (req, res, next) => {
    const authorization = req.get('authorization') || '';
    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Autenticação necessária.' });
    }

    try {
      req.user = jwt.verify(token, jwtSecret);
      return next();
    } catch {
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }
  };

  app.post('/api/auth/register', async (req, res, next) => {
    try {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body.password === 'string' ? req.body.password : '';

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
      const result = db.prepare(
        'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      ).run(name, email, passwordHash);
      const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(result.lastInsertRowid);
      const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' });
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
      const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }

      const token = jwt.sign({ id: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' });
      return res.json({ token, user: publicUser(user) });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/me', authenticate, (req, res) => {
    const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });
    return res.json({ user });
  });

  app.post('/api/games', authenticate, (req, res) => {
    const difficulty = req.body.difficulty;
    if (!Object.hasOwn(difficulties, difficulty)) {
      return res.status(400).json({ error: 'Escolha uma dificuldade válida.' });
    }

    const result = db.prepare(
      'INSERT INTO games (user_id, difficulty) VALUES (?, ?)',
    ).run(req.user.id, difficulty);
    return res.status(201).json({
      game: {
        id: result.lastInsertRowid,
        difficulty,
        pairs: difficulties[difficulty].pairs,
        status: 'em_andamento',
      },
    });
  });

  app.post('/api/games/:id/complete', authenticate, (req, res) => {
    const gameId = Number(req.params.id);
    const moves = req.body.moves;
    const elapsedSeconds = req.body.elapsedSeconds;
    if (!Number.isSafeInteger(gameId) || gameId < 1) {
      return res.status(400).json({ error: 'Partida inválida.' });
    }
    if (!Number.isSafeInteger(moves) || moves < 1 || moves > 10000
      || !Number.isSafeInteger(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > 86400) {
      return res.status(400).json({ error: 'Informe tentativas e tempo válidos.' });
    }

    const game = db.prepare(
      'SELECT id, user_id, difficulty, status FROM games WHERE id = ?',
    ).get(gameId);
    if (!game) return res.status(404).json({ error: 'Partida não encontrada.' });
    if (game.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Você não pode alterar esta partida.' });
    }
    if (game.status !== 'em_andamento') {
      return res.status(409).json({ error: 'Esta partida já foi concluída.' });
    }
    if (moves < difficulties[game.difficulty].pairs) {
      return res.status(400).json({ error: 'O número de tentativas é menor que o mínimo possível.' });
    }

    const score = Math.max(
      0,
      difficulties[game.difficulty].baseScore - moves * 10 - elapsedSeconds,
    );
    const update = db.prepare(`
      UPDATE games
      SET moves = ?, elapsed_seconds = ?, score = ?, status = 'concluida',
          completed_at = datetime('now')
      WHERE id = ? AND user_id = ? AND status = 'em_andamento'
    `).run(moves, elapsedSeconds, score, gameId, req.user.id);
    if (update.changes !== 1) {
      return res.status(409).json({ error: 'Esta partida já foi concluída.' });
    }

    return res.json({ result: { gameId, moves, elapsedSeconds, score } });
  });

  app.get('/api/games/history', authenticate, (req, res) => {
    const games = db.prepare(`
      SELECT id, difficulty, moves, elapsed_seconds AS elapsedSeconds, score, completed_at AS completedAt
      FROM games
      WHERE user_id = ? AND status = 'concluida'
      ORDER BY completed_at DESC, id DESC
      LIMIT 50
    `).all(req.user.id);
    return res.json({ games });
  });

  app.get('/api/leaderboard', authenticate, (_req, res) => {
    const players = db.prepare(`
      SELECT users.name, MAX(games.score) AS score, games.difficulty
      FROM games
      JOIN users ON users.id = games.user_id
      WHERE games.status = 'concluida'
      GROUP BY users.id
      ORDER BY score DESC, users.name COLLATE NOCASE ASC
      LIMIT 10
    `).all();
    return res.json({ players });
  });

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(currentDir, '../dist');
  app.use(express.static(clientDist));
  app.get(/.*/, (_req, res, next) => {
    if (!reqAcceptsHtml(_req)) return next();
    return res.sendFile(path.join(clientDist, 'index.html'), (error) => {
      if (error) next();
    });
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    return res.status(500).json({ error: 'Ocorreu um erro interno.' });
  });
  return app;
}

function reqAcceptsHtml(req) {
  return req.accepts('html') !== false;
}
