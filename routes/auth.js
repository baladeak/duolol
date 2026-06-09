const router  = require('express').Router();
const crypto  = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db/connection');

router.post('/register', async (req, res) => {
  const { username, email, password, lol_game_name, lol_tag_line, display_name } = req.body;
  if (!username || !email || !password || !lol_game_name || !lol_tag_line)
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const dn = (display_name || '').trim() || null;
    const [r] = await db.execute(
      'INSERT INTO users (username,display_name,email,password_hash,lol_game_name,lol_tag_line) VALUES (?,?,?,?,?,?)',
      [username.trim(), dn, email.trim().toLowerCase(), hash, lol_game_name.trim(), lol_tag_line.trim()]
    );
    const token = jwt.sign({ id: r.insertId, username }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: r.insertId, username, display_name: dn, lol_game_name, lol_tag_line } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Usuário ou email já cadastrado' });
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body; // "email" agora aceita username ou email
  if (!email || !password) return res.status(400).json({ error: 'Usuário/email e senha obrigatórios' });
  try {
    const val = email.trim();
    const [rows] = await db.execute(
      'SELECT * FROM users WHERE (email=? OR username=?) AND is_banned=0 LIMIT 1',
      [val.toLowerCase(), val]
    );
    if (!rows.length) return res.status(401).json({ error: 'Credenciais inválidas' });
    const u = rows[0];
    if (!await bcrypt.compare(password, u.password_hash))
      return res.status(401).json({ error: 'Credenciais inválidas' });
    await db.execute('UPDATE users SET online_status=?,last_seen_at=NOW() WHERE id=?', ['online', u.id]);
    const token = jwt.sign({ id: u.id, username: u.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: {
      id: u.id, username: u.username, display_name: u.display_name,
      lol_game_name: u.lol_game_name, lol_tag_line: u.lol_tag_line,
      solo_tier: u.solo_tier, solo_rank: u.solo_rank, solo_lp: u.solo_lp,
      flex_tier: u.flex_tier, flex_rank: u.flex_rank, flex_lp: u.flex_lp,
      avatar_url: u.avatar_url, bio: u.bio, admin_role: u.admin_role,
      chat_muted: u.chat_muted, profile_banner: u.profile_banner,
      theme: u.theme || 'default'
    }});
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro interno' }); }
});

router.post('/logout', require('../middleware/auth'), async (req, res) => {
  await db.execute('UPDATE users SET online_status=?,last_seen_at=NOW() WHERE id=?', ['offline', req.user.id]);
  res.json({ ok: true });
});


// POST /auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });

  try {
    const [rows] = await db.execute('SELECT id, email, display_name, username FROM users WHERE email=?', [email.toLowerCase()]);
    // Resposta sempre igual para não revelar se e-mail existe
    if (!rows.length) return res.json({ ok: true });

    const u     = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const exp   = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await db.execute('UPDATE users SET reset_token=?, reset_token_expires=? WHERE id=?', [token, exp, u.id]);

    const APP_URL  = process.env.APP_URL || 'http://localhost:3000';
    const resetUrl = `${APP_URL}/#reset-password/${token}`;
    const name     = u.display_name || u.username;

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const transporter = createTransport();
      await transporter.sendMail({
        from:    `"DUOQ.GG" <${process.env.SMTP_USER}>`,
        to:      u.email,
        subject: '🔑 Recuperação de senha — DUOQ.GG',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0E0E12;color:#EAE0CC;padding:32px;border-radius:12px">
            <h2 style="color:#f0ae07;font-size:22px;margin-bottom:8px">⚔️ DUOQ.GG</h2>
            <p>Olá <strong>${name}</strong>,</p>
            <p>Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo:</p>
            <div style="text-align:center;margin:28px 0">
              <a href="${resetUrl}" style="background:#f0ae07;color:#0E0E12;padding:13px 28px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px">
                Redefinir minha senha
              </a>
            </div>
            <p style="color:#8A8070;font-size:12px">Este link expira em 1 hora. Se você não solicitou isso, ignore este e-mail.</p>
          </div>`
      });
    } else {
      console.warn('[Auth] SMTP não configurado — token de reset:', resetUrl);
    }

    res.json({ ok: true });
  } catch(err) {
    console.error('forgot-password:', err);
    res.status(500).json({ error: 'Erro ao enviar e-mail' });
  }
});

// POST /auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Dados obrigatórios' });
  if (password.length < 6)  return res.status(400).json({ error: 'Senha muito curta (mínimo 6 caracteres)' });

  try {
    const [rows] = await db.execute(
      'SELECT id FROM users WHERE reset_token=? AND reset_token_expires > NOW()',
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: 'Link inválido ou expirado. Solicite um novo.' });

    const hash = await bcrypt.hash(password, 10);
    await db.execute('UPDATE users SET password_hash=?, reset_token=NULL, reset_token_expires=NULL WHERE id=?', [hash, rows[0].id]);

    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

module.exports = router;