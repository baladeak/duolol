const jwt = require('jsonwebtoken');
const db  = require('../db/connection');

const online = new Map();

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
        // Inclui display_name do sender para o painel lateral atualizar o nome corretamente
        const [senderRows] = await db.execute('SELECT username, display_name FROM users WHERE id=?', [uid]);
        const sender = senderRows[0] || {};
        const msg = {
          id: r.insertId, conversation_id, sender_id: uid, content: content.trim(), created_at: new Date(),
          sender_username: sender.username, sender_display_name: sender.display_name
        };
        // Emite para os dois lados — o frontend NÃO adiciona otimisticamente
        socket.emit('new_message', msg);
        const rs = online.get(receiverId);
        if (rs) io.to(rs).emit('new_message', msg);
        io.to(`user_${receiverId}`).emit('notification', { type: 'NEW_MESSAGE' });
      } catch (err) { console.error(err); }
    });

    socket.on('join_conversation', id => socket.join(`conv_${id}`));
    socket.on('typing', ({ conversation_id }) =>
      socket.to(`conv_${conversation_id}`).emit('typing', { user_id: uid }));

    // Eventos da fila
    socket.on('queue_join', async ({ queue_type }) => {
      // Broadcast para todos os conectados
      const [rows] = await db.execute(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.lol_game_name, u.lol_tag_line,
                u.solo_tier, u.solo_rank, u.solo_lp, u.flex_tier, u.flex_rank, u.flex_lp,
                u.online_status, u.has_mic,
                GROUP_CONCAT(r.role ORDER BY r.priority) AS roles
         FROM users u
         LEFT JOIN user_roles r ON r.user_id = u.id
         WHERE u.id = ?
         GROUP BY u.id`, [uid]
      );
      if (rows.length) {
        const userData = { ...rows[0], queue_type, joined_at: new Date() };
        io.emit('queue_update', { action: 'join', user: userData });
      }
    });

    socket.on('queue_leave', () => {
      io.emit('queue_update', { action: 'leave', user_id: uid });
    });

    socket.on('disconnect', async () => {
      online.delete(uid);
      await db.execute('UPDATE users SET online_status=?,last_seen_at=NOW() WHERE id=?', ['offline', uid]);
      // Remove da fila ao desconectar
      await db.execute('DELETE FROM queue_entries WHERE user_id=?', [uid]);
      io.emit('queue_update', { action: 'leave', user_id: uid });
      friends.forEach(({ fid }) => {
        const s = online.get(fid);
        if (s) io.to(s).emit('friend_online', { user_id: uid, status: 'offline' });
      });
    });
  });
};