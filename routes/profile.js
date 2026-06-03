const router = require('express').Router();
const db     = require('../db/connection');
const auth   = require('../middleware/auth');

// ── GET perfil completo (playlists, gameplays, screenshots, sociais) ──
router.get('/:userId', auth, async (req, res) => {
  const uid = parseInt(req.params.userId);
  const [playlists]    = await db.execute('SELECT * FROM profile_playlists    WHERE user_id=? ORDER BY created_at DESC', [uid]);
  const [gameplays]    = await db.execute('SELECT * FROM profile_gameplays    WHERE user_id=? ORDER BY created_at DESC', [uid]);
  const [screenshots]  = await db.execute('SELECT * FROM profile_screenshots  WHERE user_id=? ORDER BY created_at DESC', [uid]);
  const [socialsRows]  = await db.execute('SELECT * FROM profile_socials      WHERE user_id=? LIMIT 1', [uid]);
  res.json({ playlists, gameplays, screenshots, socials: socialsRows[0] || null });
});

// ── PLAYLISTS ──────────────────────────────────
router.post('/me/playlist', auth, async (req, res) => {
  const { title, genre, platform, url } = req.body;
  if (!title || !url) return res.status(400).json({ error: 'Título e link obrigatórios' });
  const [r] = await db.execute(
    'INSERT INTO profile_playlists (user_id,title,genre,platform,url) VALUES (?,?,?,?,?)',
    [req.user.id, title.trim(), genre?.trim()||null, platform||'youtube', url.trim()]
  );
  res.json({ id: r.insertId, user_id: req.user.id, title, genre, platform: platform||'youtube', url });
});

router.delete('/me/playlist/:id', auth, async (req, res) => {
  await db.execute('DELETE FROM profile_playlists WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ── GAMEPLAYS ──────────────────────────────────
router.post('/me/gameplay', auth, async (req, res) => {
  const { title, url } = req.body;
  if (!title || !url) return res.status(400).json({ error: 'Título e link obrigatórios' });
  const [r] = await db.execute(
    'INSERT INTO profile_gameplays (user_id,title,url) VALUES (?,?,?)',
    [req.user.id, title.trim(), url.trim()]
  );
  res.json({ id: r.insertId, user_id: req.user.id, title, url });
});

router.delete('/me/gameplay/:id', auth, async (req, res) => {
  await db.execute('DELETE FROM profile_gameplays WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ── SCREENSHOTS ────────────────────────────────
router.post('/me/screenshot', auth, async (req, res) => {
  const { image, caption } = req.body;
  if (!image || !image.startsWith('data:image/')) return res.status(400).json({ error: 'Imagem inválida' });
  if (image.length > 10 * 1024 * 1024) return res.status(400).json({ error: 'Imagem muito grande. Máximo 10MB.' });
  // Máximo 12 screenshots por usuário
  const [count] = await db.execute('SELECT COUNT(*) AS n FROM profile_screenshots WHERE user_id=?', [req.user.id]);
  if (count[0].n >= 12) return res.status(400).json({ error: 'Máximo 12 screenshots por perfil' });
  const [r] = await db.execute(
    'INSERT INTO profile_screenshots (user_id,image,caption) VALUES (?,?,?)',
    [req.user.id, image, caption?.trim()||null]
  );
  res.json({ id: r.insertId, user_id: req.user.id, caption, image });
});

router.delete('/me/screenshot/:id', auth, async (req, res) => {
  await db.execute('DELETE FROM profile_screenshots WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ── REDES SOCIAIS ──────────────────────────────
router.put('/me/socials', auth, async (req, res) => {
  const { instagram, tiktok, youtube } = req.body;
  await db.execute(
    `INSERT INTO profile_socials (user_id,instagram,tiktok,youtube)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE instagram=VALUES(instagram), tiktok=VALUES(tiktok), youtube=VALUES(youtube)`,
    [req.user.id, instagram?.trim()||null, tiktok?.trim()||null, youtube?.trim()||null]
  );
  res.json({ ok: true });
});

module.exports = router;
