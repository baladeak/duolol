if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express  = require('express');
const passport = require('passport');
// Carregar estratégias OAuth
require('./routes/oauth');
const http    = require('http');
const { Server } = require('socket.io');
const cors    = require('cors');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Migração automática — adiciona colunas novas sem quebrar o banco existente
const db = require('./db/connection');
const migrations = [
  `ALTER TABLE users MODIFY COLUMN avatar_url MEDIUMTEXT NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(60) NULL AFTER username`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role ENUM('user','vip','admin') NOT NULL DEFAULT 'user' AFTER display_name`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS post_restricted_until DATETIME NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_muted TINYINT(1) NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS main_champions JSON NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_banner VARCHAR(120) NULL`,
  `UPDATE friend_requests SET status='PENDING' WHERE status IS NULL OR status=''`,
  `ALTER TABLE posts MODIFY COLUMN queue_type ENUM('SOLO','FLEX','BOTH','ARAM','ARENA') NOT NULL DEFAULT 'SOLO'`,
  `CREATE TABLE IF NOT EXISTS queue_chat_messages (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    content    TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_created (created_at DESC)
  )`,
  `CREATE TABLE IF NOT EXISTS duo_swipes (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    target_id  INT NOT NULL,
    action     ENUM('like','skip') NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_swipe (user_id, target_id),
    INDEX idx_user_date (user_id, created_at)
  )`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS has_mic TINYINT(1) NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_status VARCHAR(100) NULL`,
  `CREATE TABLE IF NOT EXISTS \`groups\` (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(60)  NOT NULL,
    tag         VARCHAR(8)   NOT NULL,
    description TEXT         NULL,
    owner_id    INT          NOT NULL,
    is_public   TINYINT(1)   NOT NULL DEFAULT 1,
    avatar_url  MEDIUMTEXT   NULL,
    banner_url  MEDIUMTEXT   NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_group_tag (tag),
    INDEX idx_owner (owner_id)
  )`,
  `CREATE TABLE IF NOT EXISTS group_members (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    group_id   INT NOT NULL,
    user_id    INT NOT NULL,
    role       ENUM('owner','admin','member') NOT NULL DEFAULT 'member',
    joined_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_member (group_id, user_id),
    INDEX idx_user (user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS group_requests (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    group_id   INT NOT NULL,
    user_id    INT NOT NULL,
    message    VARCHAR(300) NULL,
    status     ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_request (group_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS group_posts (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    group_id   INT NOT NULL,
    user_id    INT NOT NULL,
    content    TEXT NOT NULL,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_group_posts (group_id, is_deleted, created_at DESC)
  )`,
  `CREATE TABLE IF NOT EXISTS group_post_likes (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    post_id    INT NOT NULL,
    user_id    INT NOT NULL,
    UNIQUE KEY uq_like (post_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS group_messages (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    group_id   INT NOT NULL,
    user_id    INT NOT NULL,
    content    TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_group_msgs (group_id, created_at DESC)
  )`,
  `CREATE TABLE IF NOT EXISTS queue_entries (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL UNIQUE,
    queue_type ENUM('SOLO','FLEX','ARAM','ARENA') NOT NULL DEFAULT 'SOLO',
    joined_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    INDEX idx_queue_type (queue_type),
    INDEX idx_expires (expires_at)
  )`,
  `CREATE TABLE IF NOT EXISTS profile_playlists (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(120) NOT NULL,
    genre VARCHAR(60) NULL,
    platform ENUM('youtube','spotify') NOT NULL DEFAULT 'youtube',
    url VARCHAR(500) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS profile_gameplays (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(120) NOT NULL,
    url VARCHAR(500) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS profile_screenshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    image MEDIUMTEXT NOT NULL,
    caption VARCHAR(200) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS profile_socials (
    user_id INT PRIMARY KEY,
    instagram VARCHAR(120) NULL,
    tiktok VARCHAR(120) NULL,
    youtube VARCHAR(200) NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS user_blocks (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    blocker_id INT NOT NULL,
    blocked_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_block (blocker_id, blocked_id)
  )`,
  `CREATE TABLE IF NOT EXISTS post_reports (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    post_id     INT NOT NULL,
    reporter_id INT NOT NULL,
    reason      VARCHAR(100) NOT NULL,
    details     VARCHAR(500) NULL,
    status      ENUM('pending','reviewed','dismissed') NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_report (post_id, reporter_id)
  )`,
];
// Garantir colunas novas antes de qualquer rota
db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_status VARCHAR(100) NULL").catch(()=>{});
db.execute(`CREATE TABLE IF NOT EXISTS stories (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  image_data MEDIUMTEXT NOT NULL,
  caption    VARCHAR(300) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL DEFAULT (DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 24 HOUR)),
  INDEX idx_user (user_id),
  INDEX idx_expires (expires_at)
)`).catch(()=>{});
db.execute(`CREATE TABLE IF NOT EXISTS story_views (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  story_id   INT NOT NULL,
  viewer_id  INT NOT NULL,
  viewed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_view (story_id, viewer_id)
)`).catch(()=>{});
db.execute(`CREATE TABLE IF NOT EXISTS post_reactions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  post_id     INT NOT NULL,
  user_id     INT NOT NULL,
  reaction    VARCHAR(20) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reaction (post_id, user_id)
)`).catch(()=>{});
db.execute(`CREATE TABLE IF NOT EXISTS user_achievements (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  badge_key  VARCHAR(50) NOT NULL,
  earned_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_badge (user_id, badge_key),
  INDEX idx_user (user_id)
)`).catch(()=>{});
db.execute("ALTER TABLE friendships ADD COLUMN IF NOT EXISTS created_at DATETIME DEFAULT CURRENT_TIMESTAMP").catch(()=>{});
db.execute("ALTER TABLE friendships ADD COLUMN IF NOT EXISTS is_favorite_a TINYINT(1) NOT NULL DEFAULT 0").catch(()=>{});
db.execute("ALTER TABLE friendships ADD COLUMN IF NOT EXISTS is_favorite_b TINYINT(1) NOT NULL DEFAULT 0").catch(()=>{});
db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(30) NOT NULL DEFAULT 'default'").catch(()=>{});
db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(64) NULL").catch(()=>{});
db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires DATETIME NULL").catch(()=>{});
db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(120) NULL").catch(()=>{});
db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id VARCHAR(120) NULL").catch(()=>{});
db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(20) NULL").catch(()=>{});
db.execute("ALTER TABLE users MODIFY COLUMN admin_role ENUM('user','vip','admin') NOT NULL DEFAULT 'user'").catch(()=>{});
db.execute("CREATE TABLE IF NOT EXISTS queue_chat_messages (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, content TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_created (created_at DESC))").catch(()=>{});
migrations.forEach(sql => db.execute(sql).catch(() => {}));

// Health check ANTES de tudo — EasyPanel usa isso para saber se o app está vivo
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date() }));

// API
app.use('/api/auth',          require('./routes/auth'));
app.use(passport.initialize());
app.use('/auth',              require('./routes/oauth'));  // OAuth social login
app.use('/api/posts',         require('./routes/posts'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/messages',      require('./routes/messages'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/queue',         require('./routes/queue'));
app.use('/api/groups',        require('./routes/groups'));
app.use('/api/match',         require('./routes/match'));
app.use('/api/stories',       require('./routes/stories'));
app.use('/api/ranking',       require('./routes/ranking'));
app.use('/api/achievements',   require('./routes/achievements'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/profile',       require('./routes/profile'));

// Frontend estático
// Sem cache para HTML — garante que o browser sempre pega versão nova
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Socket.io
const socketModule = require('./socket');
socketModule(io);

// Tornar io acessível globalmente para as rotas
global._io = io;

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DUOQ.GG rodando na porta ${PORT}`);
  console.log(`   DB_HOST: ${process.env.DB_HOST || 'NÃO DEFINIDO'}`);
  console.log(`   DB_NAME: ${process.env.DB_NAME || 'NÃO DEFINIDO'}`);
  console.log(`   JWT_SECRET: ${process.env.JWT_SECRET ? 'OK' : 'NÃO DEFINIDO ⚠️'}`);
});

// Evita que erros não tratados derrubem o processo
process.on('uncaughtException',  err => console.error('uncaughtException:', err.message));
process.on('unhandledRejection', err => console.error('unhandledRejection:', err));