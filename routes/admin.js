// ── Reset Match Duo ──────────────────────────
router.post('/reset-matches', auth, adminMiddleware, async (req, res) => {
  try {
    const [r] = await db.execute('DELETE FROM duo_swipes');
    console.log(`[ADMIN] Reset matches: ${r.affectedRows} swipes removidos por ${req.user.id}`);
    res.json({ ok: true, deleted: r.affectedRows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao resetar matches' });
  }
});

// ── Reset Fila ao vivo ────────────────────────
router.post('/reset-queue', auth, adminMiddleware, async (req, res) => {
  try {
    const [r] = await db.execute('DELETE FROM queue_entries');
    if (global._io) global._io.emit('queue_update', { action: 'reset' });
    res.json({ ok: true, deleted: r.affectedRows });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao limpar fila' });
  }
});