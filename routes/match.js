const router = require('express').Router();
const db     = require('../db/connection');
const auth   = require('../middleware/auth');

const COMPLEMENT = {
  'ADC':['SUPPORT'],'SUPPORT':['ADC'],'JUNGLE':['TOP','MID','ADC','SUPPORT'],
  'TOP':['JUNGLE'],'MID':['JUNGLE'],
};
const ELO_GROUP = {
  'IRON':0,'BRONZE':0,'SILVER':1,'GOLD':1,'PLATINUM':2,'EMERALD':2,
  'DIAMOND':3,'MASTER':4,'GRANDMASTER':4,'CHALLENGER':4,
};

function eloGroup(tier){ return ELO_GROUP[tier?.toUpperCase()] ?? -1; }

function calcScore(me, other, myRoles, otherRoles) {
  let score = 0;
  const laneMatch = myRoles.some(r => COMPLEMENT[r]?.some(cr => otherRoles.includes(cr)));
  const sameLane  = myRoles.some(r => otherRoles.includes(r));
  if (laneMatch) score += 40; else if (sameLane) score += 15;
  const diff = Math.abs(eloGroup(me.solo_tier) - eloGroup(other.solo_tier));
  if (diff===0) score+=30; else if (diff===1) score+=18; else if (diff===2) score+=8;
  if (other.online_status==='online') score+=20; else if (other.online_status==='away') score+=8;
  const myWr    = (me.solo_wins||0)+( me.solo_losses||0) > 0 ? (me.solo_wins||0)/((me.solo_wins||0)+(me.solo_losses||0)) : 0.5;
  const otherWr = (other.solo_wins||0)+(other.solo_losses||0) > 0 ? (other.solo_wins||0)/((other.solo_wins||0)+(other.solo_losses||0)) : 0.5;
  const sd = Math.abs(myWr - otherWr);
  if (sd<0.1) score+=10; else if (sd<0.2) score+=5;
  return score;
}

// GET /api/match/suggestions
router.get('/suggestions', auth, async (req, res) => {
  try {
    const [meRows] = await db.execute(
      `SELECT u.*, GROUP_CONCAT(r.role ORDER BY r.priority SEPARATOR ',') AS roles
       FROM users u LEFT JOIN user_roles r ON r.user_id = u.id
       WHERE u.id=? GROUP BY u.id`, [req.user.id]
    );
    if (!meRows.length) return res.json([]);
    const me = meRows[0];
    const myRoles = (me.roles||'').split(',').filter(Boolean);
    const [swipedRows] = await db.execute(
      'SELECT target_id FROM duo_swipes WHERE user_id=? AND DATE(created_at)=CURDATE()',
      [req.user.id]
    );
    const swipedIds = [...swipedRows.map(r=>r.target_id), req.user.id];
    const placeholders = swipedIds.map(()=>'?').join(',');
    const [candidates] = await db.execute(
      `SELECT u.id,u.username,u.display_name,u.avatar_url,u.lol_game_name,u.lol_tag_line,
              u.solo_tier,u.solo_rank,u.solo_lp,u.solo_wins,u.solo_losses,
              u.flex_tier,u.flex_rank,u.flex_lp,u.online_status,u.bio,u.has_mic,u.main_champions,
              GROUP_CONCAT(r.role ORDER BY r.priority SEPARATOR ',') AS roles
       FROM users u LEFT JOIN user_roles r ON r.user_id=u.id
       WHERE u.id NOT IN (${placeholders})
         AND (u.last_seen_at>=DATE_SUB(NOW(),INTERVAL 7 DAY) OR u.online_status='online')
         AND u.lol_game_name IS NOT NULL
       GROUP BY u.id LIMIT 100`,
      swipedIds
    );
    const scored = candidates.map(c => ({
      ...c,
      score: calcScore(me, c, myRoles, (c.roles||'').split(',').filter(Boolean)),
      roles: (c.roles||'').split(',').filter(Boolean)
    })).sort((a,b)=>b.score-a.score);
    res.json(scored.slice(0, 20));
  } catch(err){ console.error(err); res.status(500).json({error:'Erro interno'}); }
});

// GET /api/match/profile/:id — perfil completo para preview
router.get('/profile/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.id,u.username,u.display_name,u.avatar_url,u.lol_game_name,u.lol_tag_line,
              u.solo_tier,u.solo_rank,u.solo_lp,u.solo_wins,u.solo_losses,
              u.flex_tier,u.flex_rank,u.flex_lp,u.online_status,u.bio,u.has_mic,u.main_champions,
              GROUP_CONCAT(r.role ORDER BY r.priority SEPARATOR ',') AS roles
       FROM users u LEFT JOIN user_roles r ON r.user_id=u.id
       WHERE u.id=? GROUP BY u.id`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({error:'Não encontrado'});
    const p = rows[0];
    p.roles = (p.roles||'').split(',').filter(Boolean);
    res.json(p);
  } catch(err){ res.status(500).json({error:'Erro'}); }
});

// POST /api/match/swipe
router.post('/swipe', auth, async (req, res) => {
  const { target_id, action } = req.body;
  if (!target_id || !['like','skip'].includes(action))
    return res.status(400).json({error:'Dados inválidos'});
  try {
    await db.execute(
      'INSERT IGNORE INTO duo_swipes (user_id, target_id, action) VALUES (?,?,?)',
      [req.user.id, target_id, action]
    );
    if (action === 'like') {
      // Verificar match mútuo (o outro já deu like em mim?)
      const [mutual] = await db.execute(
        "SELECT id FROM duo_swipes WHERE user_id=? AND target_id=? AND action='like'",
        [target_id, req.user.id]
      );
      if (mutual.length) {
        // MATCH MÚTUO! Notificar ambos com DUO_MATCH
        await db.execute(
          'INSERT INTO notifications (user_id,actor_id,type) VALUES (?,?,?)',
          [target_id, req.user.id, 'DUO_MATCH']
        );
        await db.execute(
          'INSERT INTO notifications (user_id,actor_id,type) VALUES (?,?,?)',
          [req.user.id, target_id, 'DUO_MATCH']
        );
        // Criar amizade pendente automaticamente
        await db.execute(
          'INSERT IGNORE INTO friend_requests (from_id,to_id,status) VALUES (?,?,?)',
          [req.user.id, target_id, 'PENDING']
        );
        if (global._io) {
          global._io.to(`user_${target_id}`).emit('notification', {type:'DUO_MATCH'});
          global._io.to(`user_${req.user.id}`).emit('notification', {type:'DUO_MATCH'});
        }
        return res.json({ok:true, match: true});
      }
      // Só like — notificar o alvo com DUO_LIKE (preview, sem virar amigo ainda)
      await db.execute(
        'INSERT INTO notifications (user_id,actor_id,type) VALUES (?,?,?)',
        [target_id, req.user.id, 'DUO_LIKE']
      );
      if (global._io) {
        global._io.to(`user_${target_id}`).emit('notification', {type:'DUO_LIKE'});
      }
    }
    res.json({ok:true, match: false});
  } catch(err){ console.error(err); res.status(500).json({error:'Erro interno'}); }
});

// POST /api/match/heart-back/:actorId — coração de volta (match mútuo)
router.post('/heart-back/:actorId', auth, async (req, res) => {
  const actorId = parseInt(req.params.actorId);
  try {
    // Registrar like de volta
    await db.execute(
      'INSERT IGNORE INTO duo_swipes (user_id,target_id,action) VALUES (?,?,?)',
      [req.user.id, actorId, 'like']
    );
    // Notificar o outro com DUO_MATCH
    await db.execute(
      'INSERT INTO notifications (user_id,actor_id,type) VALUES (?,?,?)',
      [actorId, req.user.id, 'DUO_MATCH']
    );
    await db.execute(
      'INSERT INTO notifications (user_id,actor_id,type) VALUES (?,?,?)',
      [req.user.id, actorId, 'DUO_MATCH']
    );
    // Criar solicitação de amizade
    await db.execute(
      'INSERT IGNORE INTO friend_requests (from_id,to_id,status) VALUES (?,?,?)',
      [req.user.id, actorId, 'PENDING']
    );
    if (global._io) {
      global._io.to(`user_${actorId}`).emit('notification', {type:'DUO_MATCH'});
    }
    res.json({ok:true});
  } catch(err){ res.status(500).json({error:'Erro'}); }
});

module.exports = router;