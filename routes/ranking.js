const router = require('express').Router();
const db     = require('../db/connection');
const auth   = require('../middleware/auth');

// Pontuação semanal:
// Post criado      = +5
// Story postado    = +8
// Comentário feito = +2
// Like recebido    = +3
// Reação recebida  = +2
// Amigo adicionado = +3

router.get('/weekly', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT
        u.id, u.username, u.display_name, u.lol_game_name, u.lol_tag_line,
        u.avatar_url, u.solo_tier, u.solo_rank, u.solo_lp,
        u.flex_tier, u.flex_rank, u.flex_lp, u.admin_role,
        u.custom_status,

        COALESCE((SELECT COUNT(*) FROM posts p
          WHERE p.user_id=u.id AND p.is_deleted=0
            AND p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) AS posts_count,

        COALESCE((SELECT COUNT(*) FROM stories s
          WHERE s.user_id=u.id
            AND s.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) AS stories_count,

        COALESCE((SELECT COUNT(*) FROM post_comments c
          WHERE c.user_id=u.id AND c.is_deleted=0
            AND c.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) AS comments_count,

        COALESCE((SELECT COUNT(*) FROM post_likes pl
          JOIN posts p2 ON p2.id=pl.post_id
          WHERE p2.user_id=u.id
            AND pl.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) AS likes_received,

        COALESCE((SELECT COUNT(*) FROM post_reactions pr
          JOIN posts p3 ON p3.id=pr.post_id
          WHERE p3.user_id=u.id
            AND pr.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) AS reactions_received,

        COALESCE((SELECT COUNT(*) FROM friendships f
          WHERE (f.user_a_id=u.id OR f.user_b_id=u.id)
            AND f.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) AS friends_count,

        -- Score total
        (
          COALESCE((SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id AND p.is_deleted=0 AND p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) * 5 +
          COALESCE((SELECT COUNT(*) FROM stories s WHERE s.user_id=u.id AND s.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) * 8 +
          COALESCE((SELECT COUNT(*) FROM post_comments c WHERE c.user_id=u.id AND c.is_deleted=0 AND c.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) * 2 +
          COALESCE((SELECT COUNT(*) FROM post_likes pl JOIN posts p2 ON p2.id=pl.post_id WHERE p2.user_id=u.id AND pl.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) * 3 +
          COALESCE((SELECT COUNT(*) FROM post_reactions pr JOIN posts p3 ON p3.id=pr.post_id WHERE p3.user_id=u.id AND pr.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) * 2 +
          COALESCE((SELECT COUNT(*) FROM friendships f WHERE (f.user_a_id=u.id OR f.user_b_id=u.id) AND f.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) * 3
        ) AS score

      FROM users u
      WHERE u.is_banned = 0
      ORDER BY score DESC
      LIMIT 50
    `);

    // Só retornar quem tem alguma atividade
    const active = rows.filter(r => r.score > 0);
    res.json(active);
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Perfil da semana = top 1 do ranking
router.get('/profile-of-week', auth, async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT
        u.id, u.username, u.display_name, u.lol_game_name, u.lol_tag_line,
        u.avatar_url, u.bio, u.solo_tier, u.solo_rank, u.solo_lp,
        u.flex_tier, u.flex_rank, u.flex_lp, u.admin_role, u.custom_status,
        u.has_mic, u.main_champions,
        GROUP_CONCAT(r.role ORDER BY r.priority SEPARATOR ',') AS roles,
        (
          COALESCE((SELECT COUNT(*) FROM posts p WHERE p.user_id=u.id AND p.is_deleted=0 AND p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) * 5 +
          COALESCE((SELECT COUNT(*) FROM stories s WHERE s.user_id=u.id AND s.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) * 8 +
          COALESCE((SELECT COUNT(*) FROM post_comments c WHERE c.user_id=u.id AND c.is_deleted=0 AND c.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) * 2 +
          COALESCE((SELECT COUNT(*) FROM post_likes pl JOIN posts p2 ON p2.id=pl.post_id WHERE p2.user_id=u.id AND pl.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) * 3 +
          COALESCE((SELECT COUNT(*) FROM post_reactions pr JOIN posts p3 ON p3.id=pr.post_id WHERE p3.user_id=u.id AND pr.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) * 2 +
          COALESCE((SELECT COUNT(*) FROM friendships f WHERE (f.user_a_id=u.id OR f.user_b_id=u.id) AND f.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)), 0) * 3
        ) AS score
      FROM users u
      LEFT JOIN user_roles r ON r.user_id = u.id
      WHERE u.is_banned = 0
      GROUP BY u.id
      ORDER BY score DESC
      LIMIT 1
    `);

    if (!rows.length || rows[0].score === 0)
      return res.json(null);

    const p = rows[0];
    p.roles = (p.roles || '').split(',').filter(Boolean);
    try { p.main_champions = JSON.parse(p.main_champions || '[]'); } catch { p.main_champions = []; }
    res.json(p);
  } catch(err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

module.exports = router;