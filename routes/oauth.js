const router   = require('express').Router();
const passport = require('passport');
const GoogleStrategy   = require('passport-google-oauth20').Strategy;
const db  = require('../db/connection');
const jwt = require('jsonwebtoken');

const JWT_SECRET  = process.env.JWT_SECRET  || 'duoq_secret';
const APP_URL     = process.env.APP_URL     || 'http://localhost:3000';

// ── Helpers ────────────────────────────────────
function makeUsername(name, provider) {
  // Gerar username único a partir do nome
  const base = (name || provider + 'user')
    .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'user';
  return base + Math.floor(Math.random() * 9000 + 1000);
}

async function findOrCreateOAuthUser(profile, provider) {
  const idField  = provider === 'google' ? 'google_id' : 'facebook_id';
  const oauthId  = profile.id;
  const email    = profile.emails?.[0]?.value || null;
  const name     = profile.displayName || profile.name?.givenName || provider + 'user';
  const avatar   = profile.photos?.[0]?.value || null;

  // 1. Buscar por OAuth ID
  let [rows] = await db.execute(`SELECT * FROM users WHERE ${idField}=?`, [oauthId]);
  if (rows.length) return rows[0];

  // 2. Buscar por e-mail (já tem conta normal)
  if (email) {
    [rows] = await db.execute('SELECT * FROM users WHERE email=?', [email]);
    if (rows.length) {
      // Vincular OAuth ao usuário existente
      await db.execute(`UPDATE users SET ${idField}=?, oauth_provider=? WHERE id=?`,
        [oauthId, provider, rows[0].id]);
      return rows[0];
    }
  }

  // 3. Criar novo usuário
  const username     = makeUsername(name, provider);
  const display_name = name.slice(0, 60);
  const safeEmail    = email || `${username}@${provider}.oauth`;

  const [result] = await db.execute(
    `INSERT INTO users (username, display_name, email, password_hash, ${idField}, oauth_provider, avatar_url)
     VALUES (?,?,?,?,?,?,?)`,
    [username, display_name, safeEmail, 'OAUTH_NO_PASSWORD', oauthId, provider, avatar]
  );

  const [newUser] = await db.execute('SELECT * FROM users WHERE id=?', [result.insertId]);
  return newUser[0];
}

function issueToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '90d' });
}

// ── Google Strategy ────────────────────────────
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  `${APP_URL}/auth/google/callback`,
    scope: ['profile', 'email']
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await findOrCreateOAuthUser(profile, 'google');
      done(null, user);
    } catch(err) {
      done(err);
    }
  }));
} else {
  console.warn('[OAuth] GOOGLE_CLIENT_ID/SECRET não configurados — login com Google desabilitado');
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const [rows] = await db.execute('SELECT * FROM users WHERE id=?', [id]);
    done(null, rows[0] || null);
  } catch(e) { done(e); }
});

// ── Rotas Google ───────────────────────────────
router.get('/google',
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID)
      return res.redirect(`${APP_URL}/#oauth_error=google_not_configured`);
    next();
  },
  passport.authenticate('google', { session: false, scope: ['profile', 'email'] })
);

router.get('/google/callback',
  (req, res, next) => {
    passport.authenticate('google', { session: false }, (err, user) => {
      if (err || !user) return res.redirect(`${APP_URL}/#oauth_error=google_failed`);
      const token    = issueToken(user);
      const userData = JSON.stringify({
        id: user.id, username: user.username, display_name: user.display_name,
        avatar_url: user.avatar_url, admin_role: user.admin_role,
        lol_game_name: user.lol_game_name, lol_tag_line: user.lol_tag_line
      });
      // Redirecionar de volta ao SPA com token na hash
      res.redirect(`${APP_URL}/#oauth_token=${encodeURIComponent(token)}&oauth_user=${encodeURIComponent(userData)}`);
    })(req, res, next);
  }
);

module.exports = router;
module.exports.passport = passport;