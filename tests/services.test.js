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

describe('serviços do jogo da memória', () => {
  beforeEach(() => {
    db = createDatabase(':memory:');
    app = createApp({ db, jwtSecret });
  });

  afterEach(() => db.close());

  it('cadastra, autentica e retorna os dados do usuário sem expor a senha', async () => {
    const created = await register('Ana Silva', 'ANA@example.com');
    assert.equal(created.user.email, 'ana@example.com');
    assert.equal(Object.hasOwn(created.user, 'password_hash'), false);
    assert.equal(Object.hasOwn(created.user, 'password'), false);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@example.com', password: 'senha-segura-123' });
    assert.equal(login.status, 200);

    const profile = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${login.body.token}`);
    assert.equal(profile.status, 200);
    assert.equal(profile.body.user.name, 'Ana Silva');
  });

  it('valida cadastro, senha e autenticação obrigatória', async () => {
    const invalid = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'invalido', password: '123' });
    assert.equal(invalid.status, 400);

    await register('Ana Silva', 'ana@example.com');
    const duplicate = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ana', email: 'ANA@example.com', password: 'senha-segura-123' });
    assert.equal(duplicate.status, 409);

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@example.com', password: 'senha-errada' });
    assert.equal(wrongPassword.status, 401);

    const privateHistory = await request(app).get('/api/games/history');
    assert.equal(privateHistory.status, 401);
  });

  it('registra uma partida concluída e calcula pontuação, histórico e ranking', async () => {
    const { token, user } = await register('Bia Costa', 'bia@example.com');
    const started = await request(app)
      .post('/api/games')
      .set('Authorization', `Bearer ${token}`)
      .send({ difficulty: 'medio' });
    assert.equal(started.status, 201);
    assert.equal(started.body.game.pairs, 8);

    const impossibleResult = await request(app)
      .post(`/api/games/${started.body.game.id}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ moves: 7, elapsedSeconds: 75 });
    assert.equal(impossibleResult.status, 400);

    const completed = await request(app)
      .post(`/api/games/${started.body.game.id}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ moves: 20, elapsedSeconds: 75 });
    assert.equal(completed.status, 200);
    assert.deepEqual(completed.body.result, {
      gameId: started.body.game.id,
      moves: 20,
      elapsedSeconds: 75,
      score: 525,
    });

    const history = await request(app)
      .get('/api/games/history')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(history.body.games.length, 1);
    assert.equal(history.body.games[0].score, 525);

    const ranking = await request(app)
      .get('/api/leaderboard')
      .set('Authorization', `Bearer ${token}`);
    assert.deepEqual(ranking.body.players[0], {
      name: user.name,
      score: 525,
      difficulty: 'medio',
    });

    const duplicateCompletion = await request(app)
      .post(`/api/games/${started.body.game.id}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ moves: 20, elapsedSeconds: 75 });
    assert.equal(duplicateCompletion.status, 409);
  });

  it('impede que uma pessoa conclua ou consulte partidas de outra', async () => {
    const owner = await register('Caio Lima', 'caio@example.com');
    const other = await register('Duda Reis', 'duda@example.com');
    const started = await request(app)
      .post('/api/games')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ difficulty: 'facil' });

    const forbidden = await request(app)
      .post(`/api/games/${started.body.game.id}/complete`)
      .set('Authorization', `Bearer ${other.token}`)
      .send({ moves: 12, elapsedSeconds: 60 });
    assert.equal(forbidden.status, 403);

    const otherHistory = await request(app)
      .get('/api/games/history')
      .set('Authorization', `Bearer ${other.token}`);
    assert.deepEqual(otherHistory.body.games, []);
  });
});
