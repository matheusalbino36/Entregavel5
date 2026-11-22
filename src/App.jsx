import { useEffect, useRef, useState } from 'react';

const TOKEN_KEY = 'memoria-em-duelo-token';
const SYMBOLS = ['🍋', '🍉', '🍇', '🍓', '🍒', '🍍', '🥝', '🍑', '🍊', '🥥', '🍐', '🫐'];
const DIFFICULTIES = [
  { id: 'facil', label: 'Fácil', detail: '6 pares' },
  { id: 'medio', label: 'Médio', detail: '8 pares' },
  { id: 'dificil', label: 'Difícil', detail: '12 pares' },
];

async function request(path, { token, ...options } = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`/api${path}`, { ...options, headers });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir a operação.');
  return payload;
}

function shuffledCards(pairCount) {
  const cards = SYMBOLS.slice(0, pairCount).flatMap((value, pair) => [
    { id: `${pair}-a`, pair, value },
    { id: `${pair}-b`, pair, value },
  ]);
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
  return cards;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('register');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [difficulty, setDifficulty] = useState('facil');
  const [game, setGame] = useState(null);
  const [cards, setCards] = useState([]);
  const [revealed, setRevealed] = useState([]);
  const [matched, setMatched] = useState([]);
  const [moves, setMoves] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lockedRef = useRef(false);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    Promise.all([
      request('/me', { token }),
      request('/games/history', { token }),
      request('/leaderboard', { token }),
    ]).then(([profile, ownHistory, ranks]) => {
      if (!active) return;
      setUser(profile.user);
      setHistory(ownHistory.games);
      setLeaderboard(ranks.players);
    }).catch((loadError) => {
      if (!active) return;
      localStorage.removeItem(TOKEN_KEY);
      setToken('');
      setUser(null);
      setError(loadError.message);
    });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!game || result) return undefined;
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [game, result]);

  async function submitAuth(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const body = authMode === 'register'
        ? form
        : { email: form.email, password: form.password };
      const response = await request(`/auth/${authMode}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      localStorage.setItem(TOKEN_KEY, response.token);
      setUser(response.user);
      setToken(response.token);
      setForm({ name: '', email: '', password: '' });
    } catch (authError) {
      setError(authError.message);
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setUser(null);
    setGame(null);
    setResult(null);
    setError('');
  }

  async function startGame() {
    setError('');
    setBusy(true);
    try {
      const { game: newGame } = await request('/games', {
        token,
        method: 'POST',
        body: JSON.stringify({ difficulty }),
      });
      setGame(newGame);
      setCards(shuffledCards(newGame.pairs));
      setRevealed([]);
      setMatched([]);
      setMoves(0);
      setSeconds(0);
      setResult(null);
      lockedRef.current = false;
      startedAtRef.current = Date.now();
    } catch (gameError) {
      setError(gameError.message);
    } finally {
      setBusy(false);
    }
  }

  async function completeGame(finalMoves, elapsedSeconds) {
    const response = await request(`/games/${game.id}/complete`, {
      token,
      method: 'POST',
      body: JSON.stringify({ moves: finalMoves, elapsedSeconds }),
    });
    setResult(response.result);
    const [ownHistory, ranks] = await Promise.all([
      request('/games/history', { token }),
      request('/leaderboard', { token }),
    ]);
    setHistory(ownHistory.games);
    setLeaderboard(ranks.players);
  }

  function flipCard(card) {
    if (lockedRef.current || matched.includes(card.id) || revealed.includes(card.id)) return;
    if (revealed.length === 0) {
      setRevealed([card.id]);
      return;
    }

    const first = cards.find((item) => item.id === revealed[0]);
    const nextMoves = moves + 1;
    const nextRevealed = [first.id, card.id];
    lockedRef.current = true;
    setMoves(nextMoves);
    setRevealed(nextRevealed);

    window.setTimeout(async () => {
      try {
        if (first.pair === card.pair) {
          const nextMatched = [...matched, first.id, card.id];
          setMatched(nextMatched);
          if (nextMatched.length === cards.length) {
            const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
            await completeGame(nextMoves, elapsed);
          }
        }
        setRevealed([]);
      } catch (finishError) {
        setError(finishError.message);
      } finally {
        lockedRef.current = false;
      }
    }, first.pair === card.pair ? 350 : 850);
  }

  if (!user) {
    return (
      <main className="auth-layout">
        <section className="auth-card">
          <div className="brand-mark" aria-hidden="true">✦</div>
          <p className="eyebrow">JOGO DA MEMÓRIA</p>
          <h1>Memória <span>em Duelo</span></h1>
          <p className="muted">Encontre os pares, marque pontos e acompanhe sua evolução.</p>
          <div className="auth-tabs" role="tablist" aria-label="Acesso">
            <button type="button" className={authMode === 'register' ? 'active' : ''} onClick={() => { setAuthMode('register'); setError(''); }}>Criar conta</button>
            <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setError(''); }}>Entrar</button>
          </div>
          <form onSubmit={submitAuth} className="auth-form">
            {authMode === 'register' && (
              <label>
                Nome
                <input required minLength="2" maxLength="60" autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </label>
            )}
            <label>
              E-mail
              <input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </label>
            <label>
              Senha
              <input required type="password" minLength="8" maxLength="72" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            </label>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="primary-button full-width" type="submit" disabled={busy}>
              {busy ? 'Aguarde...' : authMode === 'register' ? 'Criar minha conta' : 'Entrar no jogo'}
            </button>
          </form>
          <p className="auth-note">Seu histórico fica salvo na sua conta.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Memória em Duelo - início"><span>✦</span> Memória em Duelo</a>
        <div className="user-area">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="user-name">{user.name}</span>
          <button type="button" className="quiet-button" onClick={signOut}>Sair</button>
        </div>
      </header>

      <section className="welcome">
        <div>
          <p className="eyebrow">PRONTO PARA JOGAR?</p>
          <h1>Olá, {user.name.split(' ')[0]} <span aria-hidden="true">✦</span></h1>
          <p className="muted">Escolha uma dificuldade e encontre todos os pares.</p>
        </div>
        <div className="best-score"><span>PARTIDAS CONCLUÍDAS</span><strong>{history.length}</strong></div>
      </section>

      {error && <p className="error-message app-error" role="alert">{error}</p>}

      <section className="game-panel">
        {!game ? (
          <div className="setup-panel">
            <div className="section-heading">
              <div><p className="eyebrow">NOVA PARTIDA</p><h2>Escolha seu desafio</h2></div>
              <span className="decorative-star" aria-hidden="true">✦</span>
            </div>
            <div className="difficulty-list" role="group" aria-label="Dificuldade">
              {DIFFICULTIES.map((option) => (
                <button key={option.id} type="button" className={`difficulty-card ${difficulty === option.id ? 'selected' : ''}`} onClick={() => setDifficulty(option.id)} aria-pressed={difficulty === option.id}>
                  <span className={`difficulty-icon ${option.id}`}>{option.id === 'facil' ? '✿' : option.id === 'medio' ? '✦' : '◆'}</span>
                  <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                  <span className="radio-dot" />
                </button>
              ))}
            </div>
            <button type="button" className="primary-button start-button" onClick={startGame} disabled={busy}>
              {busy ? 'Preparando...' : 'Começar partida'} <span aria-hidden="true">→</span>
            </button>
          </div>
        ) : (
          <div className="play-panel">
            <div className="play-heading">
              <div><p className="eyebrow">PARTIDA {result ? 'CONCLUÍDA' : 'EM ANDAMENTO'}</p><h2>{result ? 'Mandou bem!' : 'Encontre os pares'}</h2></div>
              <button type="button" className="quiet-button" onClick={() => { setGame(null); setResult(null); setError(''); }}>Nova partida</button>
            </div>
            <div className="game-stats">
              <div><span>TEMPO</span><strong>{formatTime(seconds)}</strong></div>
              <div><span>TENTATIVAS</span><strong>{moves}</strong></div>
              <div><span>PARES</span><strong>{matched.length / 2}/{cards.length / 2}</strong></div>
              {result && <div className="score-stat"><span>PONTUAÇÃO</span><strong>{result.score}</strong></div>}
            </div>
            <div className={`card-grid ${cards.length > 16 ? 'large-grid' : ''}`}>
              {cards.map((card) => {
                const isVisible = revealed.includes(card.id) || matched.includes(card.id);
                return (
                  <button
                    key={card.id}
                    type="button"
                    className={`memory-card ${isVisible ? 'visible' : ''} ${matched.includes(card.id) ? 'matched' : ''}`}
                    onClick={() => flipCard(card)}
                    aria-label={isVisible ? `Carta ${card.value}` : 'Revelar carta'}
                    aria-pressed={isVisible}
                    disabled={Boolean(result) || matched.includes(card.id)}
                  >
                    {isVisible ? card.value : <span aria-hidden="true">✦</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="lower-grid">
        <div className="data-panel">
          <div className="section-heading compact"><div><p className="eyebrow">SEUS RESULTADOS</p><h2>Últimas partidas</h2></div><span className="panel-icon">↗</span></div>
          {history.length === 0 ? <p className="empty-state">Sua primeira partida aparecerá aqui.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Dificuldade</th><th>Tentativas</th><th>Tempo</th><th>Pontos</th></tr></thead>
                <tbody>{history.slice(0, 5).map((item) => <tr key={item.id}><td>{DIFFICULTIES.find((level) => level.id === item.difficulty)?.label}</td><td>{item.moves}</td><td>{formatTime(item.elapsedSeconds)}</td><td className="points">{item.score}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
        <div className="data-panel">
          <div className="section-heading compact"><div><p className="eyebrow">MELHORES PONTUAÇÕES</p><h2>Ranking</h2></div><span className="panel-icon">♛</span></div>
          {leaderboard.length === 0 ? <p className="empty-state">Conclua uma partida para entrar no ranking.</p> : (
            <ol className="leaderboard">{leaderboard.map((player, index) => <li key={`${player.name}-${index}`}><span className="rank-number">{String(index + 1).padStart(2, '0')}</span><span className="rank-name">{player.name}{player.name === user.name ? <small> você</small> : null}</span><strong>{player.score}</strong></li>)}</ol>
          )}
        </div>
      </section>
      <footer>Memória em Duelo <span>·</span> Encontre, combine, supere-se.</footer>
    </main>
  );
}
