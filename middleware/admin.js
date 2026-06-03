const db = require('../db/connection');

module.exports = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  const [rows] = await db.execute('SELECT admin_role FROM users WHERE id=?', [req.user.id]);
  if (!rows.length || rows[0].admin_role !== 'admin')
    return res.status(403).json({ error: 'Acesso negado' });
  next();
};
