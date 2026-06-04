const router = require('express').Router();
const db     = require('../db/connection');
const auth   = require('../middleware/auth');

// Tabela duo_swipes é criada via migration no server.js

// Pares de lanes complementares (ADC procura Support, etc.)
const COMPLEMENT = {
  'ADC':     ['SUPPORT'],
  'SUPPORT': ['ADC'],
  'JUNGLE':  ['TOP', 'MID', 'ADC', 'SUPPORT'],
  'TOP':     ['JUNGLE'],
  'MID':     ['JUNGLE'],
};

// Grupos de elo para compatibilidade
const ELO_GROUP = {
  'IRON': 0, 'BRONZE': 0, 'SILVER': 1,
  'GOLD': 1, 'PLATINUM': 2, 'EMERALD': 2,
  'DIAMOND': 3, 'MASTER': 4, 'GRANDMASTER': 4, 'CHALLENGER': 4,
};

function eloGroup(tier) {
  return ELO_GROUP[tier?.toUpperCase()] ?? -1;
}

// Calcular score de compatibilidade (0-100)
function calcScore(me, other, myRoles, otherRoles) {
  let score = 0;

  // 1. Compatibilidade de Lane (40 pts)
  const laneMatch = myRoles.some(r =>
    COMPLEMENT[r]?.some(cr => otherRoles.includes(cr))
  );
  const sameLane = myRoles.some(r => otherRoles.includes(r));
  if (laneMatch)     score += 40;
  else if (sameLane) score += 15; // mesma lane mas não ideal, ainda pontua

  // 2. Proximidade de Elo (30 pts)
  const myElo    = eloGroup(me.solo_tier);
  const otherElo = eloGroup(other.solo_tier);
  if (myElo >= 0 && otherElo >= 0) {
    const diff = Math.abs(myElo - otherElo);
    if (diff === 0)      score += 30;
    else if (diff === 1) score += 18;
    else if (diff === 2) score += 8;
  }

  // 3. Status online (20 pts)
  if (other.online_status === 'online') score += 20;
  else if (other.online_status === 'away') score += 8;

  // 4. Estilo de jogo compatível via KDA (10 pts)
  // agressivo (KDA >3) combina com agressivo, passivo com passivo
  const myKda    = me.solo_losses > 0 ? (me.solo_wins / (me.solo_wins + me.solo_losses)) : 0.5;
  const otherKda = other.solo_losses > 0 ? (other.solo_wins / (other.solo_wins + other.solo_losses)) : 0.5;
  const styleDiff = Math.abs(myKda - otherKda);
  if (styleDiff < 0.1)      score += 10;
  else if (styleDiff < 0.2) score += 5;

  return score;
}

// GET /api/match/suggestions
router.get('/suggestions', auth, async (req, res) => {
  try {
    // Dados do usuário logado
    const [meRows] = await db.execute(
      `SELECT u.*, GROUP_CONCAT(r.role ORDER BY r.priority SEPARATOR ',') AS roles
       FROM users u LEFT JOIN user_roles r ON r.user_id = u.id
       WHERE u.id = ? GROUP BY u.id`, [req.user.id]
    );
    if (!meRows.length) return res.json([]);
    const me = meRows[0];
    const myRoles = (me.roles || '').split(',').filter(Boolean);

    // IDs já vistos (swipe) hoje
    const [swipedRows] = await db.execute(
      `SELECT target_id FROM duo_swipes WHERE user_id = ? AND DATE(created_at) = CURDATE()`,
      [req.user.id]
    );
    const swipedIds = swipedRows.map(r => r.target_id);
    swipedIds.push(req.user.id); // excluir o próprio usuário

    const excludeList = swipedIds.length
      ? swipedIds.map(() => '?').join(',')
      : '0';

    // Buscar candidatos (ativos nos últimos 7 dias)
    const [candidates] = await db.execute(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, u.lol_game_name, u.lol_tag_line,
              u.solo_tier, u.solo_rank, u.solo_lp, u.solo_wins, u.solo_losses,
              u.flex_tier, u.flex_rank, u.flex_lp,
              u.online_status, u.bio, u.has_mic, u.main_champions,
              GROUP_CONCAT(r.role ORDER BY r.priority SEPARATOR ',') AS roles
       FROM users u
       LEFT JOIN user_roles r ON r.user_id = u.id
       WHERE u.id NOT IN (${excludeList})
         AND (u.last_seen_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) OR u.online_status = 'online')
         AND u.lol_game_name IS NOT NULL
       GROUP BY u.id
       LIMIT 100`,
      swipedIds
    );

    // Calcular score para cada candidato
    const scored = candidates.map(c => {
      const otherRoles = (c.roles || '').split(',').filter(Boolean);
      const score = calcScore(me, c, myRoles, otherRoles);
      return { ...c, score, roles: otherRoles };
    });

    // Ordenar por score e retornar top 20
    scored.sort((a, b) => b.score - a.score);
    res.json(scored.slice(0, 20));
  } catch (err) {
    console.error('Match suggestions:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/match/swipe — registrar swipe
router.post('/swipe', auth, async (req, res) => {
  const { target_id, action } = req.body; // action: 'like' | 'skip'
  if (!target_id || !['like','skip'].includes(action))
    return res.status(400).json({ error: 'Dados inválidos' });
  try {
    await db.execute(
      'INSERT IGNORE INTO duo_swipes (user_id, target_id, action) VALUES (?,?,?)',
      [req.user.id, target_id, action]
    );
    // Se curtiu, criar amizade pendente + notificação
    if (action === 'like') {
      const [existing] = await db.execute(
        'SELECT id FROM friend_requests WHERE from_id=? AND to_id=? AND status="PENDING"',
        [req.user.id, target_id]
      );
      if (!existing.length) {
        await db.execute(
          'INSERT IGNORE INTO friend_requests (from_id, to_id, status) VALUES (?,?,?)',
          [req.user.id, target_id, 'PENDING']
        );
        await db.execute(
          'INSERT INTO notifications (user_id, actor_id, type) VALUES (?,?,?)',
          [target_id, req.user.id, 'FRIEND_REQUEST']
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Swipe:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;