if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
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
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role ENUM('user','admin') NOT NULL DEFAULT 'user' AFTER display_name`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS post_restricted_until DATETIME NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_muted TINYINT(1) NOT NULL DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS main_champions JSON NULL`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_banner VARCHAR(120) NULL`,
  `UPDATE friend_requests SET status='PENDING' WHERE status IS NULL OR status=''`,
  `ALTER TABLE posts MODIFY COLUMN queue_type ENUM('SOLO','FLEX','BOTH','ARAM','ARENA') NOT NULL DEFAULT 'SOLO'`,
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
migrations.forEach(sql => db.execute(sql).catch(() => {}));

// Health check ANTES de tudo — EasyPanel usa isso para saber se o app está vivo
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date() }));

// API
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/posts',         require('./routes/posts'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/messages',      require('./routes/messages'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/profile',       require('./routes/profile'));

// Frontend estático
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Socket.io
require('./socket')(io);

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