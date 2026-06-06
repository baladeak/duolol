const router = require('express').Router();
const db     = require('../db/connection');
const auth   = require('../middleware/auth');

// ── Definição de todas as conquistas ──────────
const BADGES = [
  // Posts
  { key:'primeiro_post',  name:'Primeiro Post',    desc:'Criou o primeiro post',             icon:'✍️',  color:'#C8963E', category:'posts'    },
  { key:'escritor',       name:'Escritor',          desc:'10 posts publicados',               icon:'📝',  color:'#F59E0B', category:'posts'    },
  { key:'prolífico',      name:'Prolífico',         desc:'50 posts publicados',               icon:'🗞️',  color:'#EF4444', category:'posts'    },
  { key:'rei_aram',       name:'Rei do ARAM',       desc:'10 posts de ARAM',                  icon:'🎮',  color:'#8B5CF6', category:'posts'    },
  { key:'rei_ranked',     name:'Grindador',         desc:'20 posts de Ranked',                icon:'🏆',  color:'#F59E0B', category:'posts'    },
  // Social
  { key:'primeiro_amigo', name:'Primeiro Duo',      desc:'Adicionou o primeiro amigo',        icon:'🤝',  color:'#4ADE80', category:'social'   },
  { key:'social',         name:'Social',            desc:'10 amigos adicionados',             icon:'👥',  color:'#34D399', category:'social'   },
  { key:'influente',      name:'Influente',         desc:'30 amigos adicionados',             icon:'🌟',  color:'#F59E0B', category:'social'   },
  { key:'duo_fiel',       name:'Duo Fiel',          desc:'20+ mensagens trocadas com um amigo',icon:'💙', color:'#60A5FA', category:'social'   },
  { key:'primeiro_match', name:'Primeiro Match!',   desc:'Primeiro match mútuo no Match Duo', icon:'💞',  color:'#F43F5E', category:'social'   },
  // Engajamento
  { key:'popular',        name:'Popular',           desc:'Recebeu 20 curtidas nos posts',     icon:'❤️',  color:'#F43F5E', category:'engage'   },
  { key:'viral',          name:'Viral',             desc:'Post com 10+ reações/curtidas',     icon:'🔥',  color:'#F97316', category:'engage'   },
  { key:'comentarista',   name:'Comentarista',      desc:'20 comentários feitos',             icon:'💬',  color:'#06B6D4', category:'engage'   },
  // Stories
  { key:'story_star',     name:'Story Star',        desc:'5 stories publicados',              icon:'📸',  color:'#EC4899', category:'stories'  },
  // Conta
  { key:'invocador_ativo',name:'Invocador Ativo',   desc:'Sincronizou o elo com a Riot',      icon:'⚡',  color:'#FBBF24', category:'account'  },
  { key:'veterano_30',    name:'Veterano',          desc:'Conta com mais de 30 dias',         icon:'🎖️',  color:'#A78BFA', category:'account'  },
  { key:'veterano_180',   name:'Lendário',          desc:'Conta com mais de 6 meses',         icon:'👑',  color:'#F59E0B', category:'account'  },
  // Ranking
  { key:'perfil_semana',  name:'Perfil da Semana',  desc:'Foi o Perfil da Semana',            icon:'⭐',  color:'#F59E0B', category:'ranking'  },
  { key:'top3_ranking',   name:'Top 3',             desc:'Entrou no Top 3 do ranking semanal',icon:'🥉',  color:'#CD7F32', category:'ranking'  },
];

// Exportar badges para uso no frontend
router.get('/badges', auth, (req, res) => res.json(BADGES));

// GET /api/achievements/:userId — badges do usuário
router.get('/:userId', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT badge_key, earned_at FROM user_achievements WHERE user_id=? ORDER BY earned_at ASC',
      [req.params.userId]
    );
    const earned = rows.map(r => r.badge_key);
    const result = BADGES.map(b => ({
      ...b,
      earned: earned.includes(b.key),
      earned_at: rows.find(r => r.badge_key === b.key)?.earned_at || null
    }));
    res.json(result);
  } catch(err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /api/achievements/check — verificar e conceder novas conquistas
router.post('/check', auth, async (req, res) => {
  const uid = req.user.id;
  const newBadges = [];

  try {
    // Badges já conquistados
    const [existing] = await db.execute('SELECT badge_key FROM user_achievements WHERE user_id=?', [uid]);
    const has = new Set(existing.map(r => r.badge_key));

    const grant = async (key) => {
      if (has.has(key)) return;
      await db.execute('INSERT IGNORE INTO user_achievements (user_id, badge_key) VALUES (?,?)', [uid, key]);
      has.add(key);
      const badge = BADGES.find(b => b.key === key);
      if (badge) newBadges.push(badge);
    };

    // Verificar cada badge
    const [[u]]    = await db.execute('SELECT lol_puuid, created_at FROM users WHERE id=?', [uid]);
    const [[stats]] = await db.execute(`
      SELECT
        (SELECT COUNT(*) FROM posts WHERE user_id=? AND is_deleted=0) AS posts,
        (SELECT COUNT(*) FROM posts WHERE user_id=? AND is_deleted=0 AND queue_type='ARAM') AS aram_posts,
        (SELECT COUNT(*) FROM posts WHERE user_id=? AND is_deleted=0 AND queue_type IN ('SOLO','BOTH')) AS ranked_posts,
        (SELECT COUNT(*) FROM friendships WHERE user_a_id=? OR user_b_id=?) AS friends,
        (SELECT COUNT(*) FROM post_likes pl JOIN posts p ON p.id=pl.post_id WHERE p.user_id=?) AS likes_recv,
        (SELECT COUNT(*) FROM post_comments WHERE user_id=? AND is_deleted=0) AS comments,
        (SELECT COUNT(*) FROM stories WHERE user_id=?) AS stories_count,
        (SELECT COUNT(*) FROM duo_swipes ds1 JOIN duo_swipes ds2 ON ds2.user_id=ds1.target_id AND ds2.target_id=ds1.user_id WHERE ds1.user_id=? AND ds1.action='like') AS matches,
        (SELECT MAX(cnt) FROM (SELECT COUNT(*) as cnt FROM messages WHERE sender_id=? GROUP BY conversation_id) sub) AS max_conv_msgs,
        (SELECT MAX(cnt2) FROM (SELECT COUNT(*) as cnt2 FROM post_likes pl2 WHERE pl2.post_id IN (SELECT id FROM posts WHERE user_id=?) GROUP BY pl2.post_id) sub2) AS max_post_likes
    `, [uid,uid,uid,uid,uid,uid,uid,uid,uid,uid,uid]);

    const daysSince = u?.created_at
      ? Math.floor((Date.now() - new Date(u.created_at)) / 86400000)
      : 0;

    // Posts
    if (stats.posts >= 1)  await grant('primeiro_post');
    if (stats.posts >= 10) await grant('escritor');
    if (stats.posts >= 50) await grant('prolífico');
    if (stats.aram_posts >= 10)   await grant('rei_aram');
    if (stats.ranked_posts >= 20) await grant('rei_ranked');
    // Social
    if (stats.friends >= 1)  await grant('primeiro_amigo');
    if (stats.friends >= 10) await grant('social');
    if (stats.friends >= 30) await grant('influente');
    if (stats.matches >= 1)  await grant('primeiro_match');
    if ((stats.max_conv_msgs || 0) >= 20) await grant('duo_fiel');
    // Engajamento
    if (stats.likes_recv >= 20) await grant('popular');
    if ((stats.max_post_likes || 0) >= 10) await grant('viral');
    if (stats.comments >= 20) await grant('comentarista');
    // Stories
    if (stats.stories_count >= 5) await grant('story_star');
    // Conta
    if (u?.lol_puuid)     await grant('invocador_ativo');
    if (daysSince >= 30)  await grant('veterano_30');
    if (daysSince >= 180) await grant('veterano_180');

    res.json({ new_badges: newBadges });
  } catch(err) {
    console.error('Achievements check:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;
module.exports.BADGES = BADGES;