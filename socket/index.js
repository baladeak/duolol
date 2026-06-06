const jwt = require('jsonwebtoken');
const db  = require('../db/connection');

const online = new Map();

// Chat da fila em memória — últimas 50 mensagens
const queueChatMessages = [];
const QUEUE_CHAT_MAX = 50;

module.exports = (io) => {
  io.use((socket, next) => {
    try {
      socket.user = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
      next();
    } catch { next(new Error('Token inválido')); }
  });

  io.on('connection', async (socket) => {
    const uid = socket.user.id;
    online.set(uid, socket.id);
    socket.join(`user_${uid}`);
    await db.execute('UPDATE users SET online_status=?,last_seen_at=NOW() WHERE id=?', ['online', uid]);

    const [friends] = await db.execute(
      'SELECT IF(f.user_a_id=?,f.user_b_id,f.user_a_id) AS fid FROM friendships f WHERE f.user_a_id=? OR f.user_b_id=?',
      [uid, uid, uid]
    );
    friends.forEach(({ fid }) => {
      const s = online.get(fid);
      if (s) io.to(s).emit('friend_online', { user_id: uid, status: 'online' });
    });

    // ── Chat privado ──────────────────────────────
    socket.on('send_message', async ({ conversation_id, content }) => {
      if (!content?.trim()) return;
      try {
        const [conv] = await db.execute(
          'SELECT id,user_a_id,user_b_id FROM conversations WHERE id=? AND (user_a_id=? OR user_b_id=?)',
          [conversation_id, uid, uid]
        );
        if (!conv.length) return;
        const [r] = await db.execute('INSERT INTO messages (conversation_id,sender_id,content) VALUES (?,?,?)',
          [conversation_id, uid, content.trim()]);
        await db.execute('UPDATE conversations SET last_msg_at=NOW() WHERE id=?', [conversation_id]);
        const receiverId = conv[0].user_a_id === uid ? conv[0].user_b_id : conv[0].user_a_id;
        const [senderRows] = await db.execute('SELECT username, display_name FROM users WHERE id=?', [uid]);
        const sender = senderRows[0] || {};
        const msg = {
          id: r.insertId, conversation_id, sender_id: uid, content: content.trim(), created_at: new Date(),
          sender_username: sender.username, sender_display_name: sender.display_name
        };
        socket.emit('new_message', msg);
        const rs = online.get(receiverId);
        if (rs) io.to(rs).emit('new_message', msg);
        io.to(`user_${receiverId}`).emit('notification', { type: 'NEW_MESSAGE' });
      } catch (err) { console.error(err); }
    });

    socket.on('join_conversation', id => socket.join(`conv_${id}`));
    socket.on('join_group_room',   id => socket.join(`group_${id}`));
    socket.on('leave_group_room',  id => socket.leave(`group_${id}`));
    socket.on('typing', ({ conversation_id }) =>
      socket.to(`conv_${conversation_id}`).emit('typing', { user_id: uid }));

    // ── Chat da fila ──────────────────────────────
    socket.on('queue_chat', async ({ content }) => {
      if (!content?.trim() || content.length > 300) return;
      try {
        // Não bloqueia por queue_entries — confiar no estado do cliente
        // (a verificação de queue causava descarte silencioso)
        const [userRows] = await db.execute(
          'SELECT username, display_name, avatar_url FROM users WHERE id=?', [uid]
        );
        const user = userRows[0] || {};
        const msg = {
          id:           Date.now(),
          sender_id:    uid,
          sender_name:  user.display_name || user.username,
          avatar_url:   user.avatar_url || null,
          content:      content.trim(),
          created_at:   new Date()
        };

        // Guardar em memória
        queueChatMessages.push(msg);
        if (queueChatMessages.length > QUEUE_CHAT_MAX)
          queueChatMessages.shift();

        // Broadcast para todos
        io.emit('queue_chat_msg', msg);
      } catch (err) { console.error('queue_chat:', err); }
    });

    // Retornar histórico do chat da fila ao pedir
    socket.on('queue_chat_history', () => {
      socket.emit('queue_chat_history', queueChatMessages.slice(-30));
    });

    // ── Disconnect — NÃO remove da fila ──────────
    // A fila tem expiração própria (30 min). Remover na reconexão
    // causava o bug onde o jogador sumia da fila após poucos segundos.
    socket.on('disconnect', async () => {
      online.delete(uid);
      await db.execute('UPDATE users SET online_status=?,last_seen_at=NOW() WHERE id=?', ['offline', uid]);
      // NÃO remove da fila aqui — a fila tem expiração automática
      // e o usuário pode ter apenas reconectado o socket
      friends.forEach(({ fid }) => {
        const s = online.get(fid);
        if (s) io.to(s).emit('friend_online', { user_id: uid, status: 'offline' });
      });
    });
  });

  module.exports.io = io;
};