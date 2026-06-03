/* DUOQ.GG - Frontend SPA */
const API = '/api';
let token  = localStorage.getItem('duoq_token');
let me     = JSON.parse(localStorage.getItem('duoq_me') || 'null');
let socket = null;
let currentFilter      = 'solo';
let postQueue          = 'SOLO';
let currentConvId      = null;
let currentChatPartner = null;
let notifCount = 0;
let msgCount   = 0;

// ── Helpers ────────────────────────────────────
const $ = id => document.getElementById(id);

// Som de notificação MSN
function playMsnSound() {
  if (me?.chat_muted) return; // respeitando preferência salva
  try {
    const audio = new Audio('/sounds/msn.wav');
    audio.volume = 0.6;
    audio.play().catch(() => {});
  } catch {}
}

async function toggleChatMute() {
  const muted = !me?.chat_muted;
  try {
    await api('/users/me', { method: 'PATCH', body: { chat_muted: muted } });
    me.chat_muted = muted;
    localStorage.setItem('duoq_me', JSON.stringify(me));
    updateMuteBtn();
    toast(muted ? '🔇 Som do chat mutado' : '🔔 Som do chat ativado');
  } catch { toast('Erro ao salvar preferência'); }
}

function updateMuteBtn() {
  const btn = $('rp-mute-btn');
  if (!btn) return;
  const muted = me?.chat_muted;
  btn.innerHTML = muted
    ? '<i class="ti ti-volume-off"></i>'
    : '<i class="ti ti-volume"></i>';
  btn.title   = muted ? 'Som mutado — clique para ativar' : 'Som ativo — clique para mutar';
  btn.classList.toggle('rp-mute-active', !!muted);
}

function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(API + path, {
    headers,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw data;
    return data;
  });
}

function eloClass(tier) {
  if (!tier) return 'elo-unranked';
  return 'elo-' + tier.toLowerCase();
}

function eloLabel(tier, rank, lp) {
  if (!tier) return 'Sem Rank';
  if (['MASTER','GRANDMASTER','CHALLENGER'].includes(tier))
    return `${tier} ${lp || 0}LP`;
  return `${tier} ${rank || ''} ${lp || 0}LP`.trim();
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60)    return 'agora';
  if (diff < 3600)  return Math.floor(diff / 60) + 'min';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h';
  return Math.floor(diff / 86400) + 'd';
}

function avatarColor(name) {
  const colors = ['#C8963E','#3B82F6','#A78BFA','#22C55E','#F59E0B','#EC4899','#14B8A6','#EF4444'];
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % colors.length;
  return colors[Math.abs(h)];
}

// Tamanhos explícitos para garantir que nunca somam quando o CSS recarrega
const AV_SIZES = { 'av-sm':32, 'av-md':52, 'av-lg':150, 'av-xl':150, 'av-2xl':150 };

function avatarHTML(user, size = 'av-md') {
  const col    = avatarColor(user.username || user.lol_game_name || 'U');
  const letter = (user.display_name || user.username || user.lol_game_name || 'U')[0].toUpperCase();
  const status = user.online_status || 'offline';
  const dotCls = status === 'online' ? 'dot-online' : status === 'away' ? 'dot-away' : 'dot-offline';
  const px     = AV_SIZES[size] || 52;

  if (user.avatar_url) {
    return `<img src="${user.avatar_url}" class="av ${size}"
      style="width:${px}px;height:${px}px;border-radius:50%;object-fit:cover;flex-shrink:0;display:block" alt="">`;
  }
  return `<div class="av ${size}" style="width:${px}px;height:${px}px;background:${col};color:#0A0E1A;flex-shrink:0">${letter}<div class="status-dot ${dotCls}"></div></div>`;
}

// Nome público: display_name se existir, fallback para username
function dName(user) {
  return (user.display_name || user.username || '').trim();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, duration = 2800) {
  const t = $('toast');
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._t);
  t._t = setTimeout(() => t.style.opacity = '0', duration);
}

// ── Auth tabs ──────────────────────────────────
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $('register-form').style.display = tab.dataset.tab === 'register' ? '' : 'none';
    $('login-form').style.display    = tab.dataset.tab === 'login'    ? '' : 'none';
    $('auth-error').style.display    = 'none';
  };
});

// ── Register ───────────────────────────────────
async function register(e) {
  e.preventDefault();
  const btn = $('btn-register');
  btn.disabled = true; btn.textContent = 'AGUARDE...';
  $('auth-error').style.display = 'none';
  try {
    const res = await api('/auth/register', {
      method: 'POST',
      body: {
        username:      $('reg-username').value.trim(),
        display_name:  $('reg-display-name').value.trim(),
        email:         $('reg-email').value.trim(),
        password:      $('reg-password').value,
        lol_game_name: $('reg-lol-name').value.trim(),
        lol_tag_line:  $('reg-lol-tag').value.trim()
      }
    });
    saveSession(res);
  } catch (err) {
    showAuthError(err.error || 'Erro ao cadastrar. Tente novamente.');
  } finally {
    btn.disabled = false; btn.textContent = 'CRIAR CONTA';
  }
}

// ── Login ──────────────────────────────────────
async function login(e) {
  e.preventDefault();
  const btn = $('btn-login');
  btn.disabled = true; btn.textContent = 'AGUARDE...';
  $('auth-error').style.display = 'none';
  try {
    const res = await api('/auth/login', {
      method: 'POST',
      body: {
        email:    $('login-email').value.trim(),
        password: $('login-password').value
      }
    });
    saveSession(res);
  } catch (err) {
    showAuthError(err.error || 'Email ou senha inválidos.');
  } finally {
    btn.disabled = false; btn.textContent = 'ENTRAR';
  }
}

function showAuthError(msg) {
  const el = $('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function saveSession({ token: t, user }) {
  token = t;
  me    = user;
  localStorage.setItem('duoq_token', t);
  localStorage.setItem('duoq_me', JSON.stringify(user));
  bootApp();
}

async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  localStorage.clear();
  token = null; me = null;
  if (socket) { socket.disconnect(); socket = null; }
  $('app-screen').style.display  = 'none';
  $('auth-screen').style.display = 'flex';
}

// ── Boot ───────────────────────────────────────
function bootApp() {
  // Mostra o app, esconde o auth
  $('auth-screen').style.display = 'none';
  $('app-screen').style.display = 'flex';

  // Atualiza avatar no compositor
  updateMyAvatar();

  // Mostra nav de admin se for admin
  bootAdmin();

  // Carrega dados
  refreshMe();
  loadPage('feed');
  loadFriends();
  loadRightPanelChats();
  loadNotifCount();
  loadMsgCount();
  pollOnlineCount();

  // Polls periódicos
  setInterval(pollOnlineCount, 10000);
  setInterval(loadNotifCount,  30000);
  setInterval(loadMsgCount,    15000);
  setInterval(loadQueueList,   20000); // Atualiza fila a cada 20s

  // Verificar status da fila
  checkQueueStatus();
  loadQueueList();

  // Socket
  initSocket();
}

function updateMyAvatar() {
  if (!me) return;
  const el = $('my-avatar-feed');
  if (!el) return;
  // Substitui o elemento inteiro para garantir tamanho e imagem corretos
  const html = avatarHTML({ ...me, online_status: 'online' }, 'av-lg');
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const newEl = tmp.firstElementChild;
  if (newEl) {
    newEl.id = 'my-avatar-feed';
    el.replaceWith(newEl);
  }
}

async function refreshMe() {
  try {
    const user = await api('/users/me');
    me = { ...me, ...user };
    localStorage.setItem('duoq_me', JSON.stringify(me));
    updateMyAvatar();
    renderSidebarRanks();
    bootAdmin();
    updateMuteBtn();
  } catch (err) {
    // Só desloga se for erro de autenticação (401), não erros de rede
    if (err && (err.error?.includes('Token') || err.error?.includes('inválido') || err.error?.includes('expirado'))) {
      logout();
    }
    // Erros de rede/servidor são ignorados — mantém sessão local
  }
}

// ── Socket ─────────────────────────────────────
function initSocket() {
  if (typeof io === 'undefined') {
    const s = document.createElement('script');
    s.src    = '/socket.io/socket.io.js';
    s.onload = connectSocket;
    document.head.appendChild(s);
  } else {
    connectSocket();
  }
}

function connectSocket() {
  if (socket) return;
  socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
  socket.on('connect',      () => console.log('🔌 Socket conectado'));
  socket.on('new_message',  onSocketMessage);
  socket.on('notification',   onSocketNotif);
  socket.on('queue_update',   onQueueUpdate);
  socket.on('friend_online',({ user_id, status }) => updateFriendStatus(user_id, status));
  socket.on('connect_error', err => console.warn('Socket error:', err.message));
}

function onSocketMessage(msg) {
  const isFromMe = msg.sender_id == me?.id;
  const isCurrentConv = currentConvId && msg.conversation_id == currentConvId;

  // Adiciona bolha se a conversa estiver aberta
  if (isCurrentConv) {
    appendBubble(msg, isFromMe ? 'me' : 'them');
  }

  // Som e badge para mensagens de outros
  if (!isFromMe) {
    if (!isCurrentConv) {
      msgCount++;
      updateMsgBadge();
      toast('💬 Nova mensagem de ' + (msg.sender_display_name || msg.sender_username || 'alguém'));
    }
    playMsnSound();
  }

  // Atualiza o painel de chat lateral em tempo real (sempre)
  rpUpdateConv(msg);
}

function onSocketNotif(notif) {
  notifCount++;
  updateNotifBadge();
  const icons = {
    POST_LIKE:'❤️', POST_COMMENT:'💬', FRIEND_REQUEST:'👤',
    FRIEND_ACCEPTED:'✅', NEW_MESSAGE:'💬', ELO_UPDATE:'🏆'
  };
  toast((icons[notif.type] || '🔔') + ' Nova notificação');
}

// ── Navigation ─────────────────────────────────
function loadPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.s-item').forEach(i => i.classList.remove('active'));
  const page = $('page-' + name);
  const nav  = $('nav-' + name);
  if (page) page.classList.add('active');
  if (nav)  nav.classList.add('active');

  const rp = document.querySelector('.right-panel');
  if (rp) rp.style.display = (name === 'feed' || name === 'explore') ? '' : 'none';

  if (name === 'feed')          loadFeed();
  if (name === 'explore')       loadExplore();
  if (name === 'friends')       loadFriendsPage();
  if (name === 'messages')      loadConversations();
  if (name === 'notifications') loadNotifications();
  if (name === 'profile')       loadMyProfile();
}

// ── Feed ───────────────────────────────────────
let feedLoading = false;

async function loadFeed() {
  if (feedLoading) return;
  feedLoading = true;
  const c = $('feed-posts');
  c.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';
  try {
    const posts = await api(`/posts?queue=${currentFilter}&limit=25`);
    if (!posts.length) {
      c.innerHTML = '<div class="empty"><i class="ti ti-mood-empty"></i><p>Nenhum post aqui ainda. Seja o primeiro!</p></div>';
    } else {
      c.innerHTML = posts.map(postHTML).join('');
    }
  } catch (err) {
    console.error(err);
    c.innerHTML = '<div class="empty"><i class="ti ti-alert-circle"></i><p>Erro ao carregar o feed. Tente novamente.</p></div>';
  }
  feedLoading = false;
}

function postHTML(p) {
  const isMe = p.user_id == me?.id;
  return `
  <div class="post-card" id="post-${p.id}">
    <div class="post-head">
      <div onclick="viewProfile(${p.user_id})" style="cursor:pointer;flex-shrink:0" title="Ver perfil de ${escapeHtml(p.lol_game_name)}">${avatarHTML(p, 'av-lg')}</div>
      <div class="post-meta">
        <div class="post-top">
          <span class="post-name" onclick="viewProfile(${p.user_id})">${escapeHtml(p.lol_game_name)}<span class="post-tag">#${escapeHtml(p.lol_tag_line)}</span></span>
          <span class="post-nick">${escapeHtml(dName(p))}</span>
          ${p.has_mic ? '<span class="post-mic" title="Tem microfone"><i class="ti ti-microphone"></i></span>' : ''}
          <span class="post-time">${timeAgo(p.created_at)}</span>
          <!-- Menu 3 pontos -->
          <div class="post-menu" style="margin-left:auto;position:relative">
            <button class="post-menu-btn" onclick="togglePostMenu(${p.id},${p.user_id})" title="Opções"><i class="ti ti-dots"></i></button>
            <div class="post-dropdown" id="pd-${p.id}" style="display:none">
              ${!isMe ? `<div class="pd-item pd-danger" onclick="openReportModal(${p.id},${p.user_id});togglePostMenu(${p.id})"><i class="ti ti-flag"></i> Denunciar</div>` : ''}
              ${me?.admin_role === 'admin' ? `
                <div class="pd-divider"></div>
                <div class="pd-label">Admin</div>
                <div class="pd-item pd-danger" onclick="adminDeletePost(${p.id})"><i class="ti ti-trash"></i> Deletar post</div>
                <div class="pd-item pd-danger" onclick="adminBan(${p.user_id},true);togglePostMenu(${p.id})"><i class="ti ti-ban"></i> Banir usuário</div>
                <div class="pd-item pd-warn" onclick="adminRestrict(${p.user_id},24);togglePostMenu(${p.id})"><i class="ti ti-clock"></i> Silenciar 24h</div>
                <div class="pd-item pd-warn" onclick="adminRestrict(${p.user_id},168);togglePostMenu(${p.id})"><i class="ti ti-clock"></i> Silenciar 7 dias</div>
              ` : ''}
              ${isMe ? `<div class="pd-item pd-danger" onclick="deletePost(${p.id})"><i class="ti ti-trash"></i> Deletar meu post</div>` : ''}
            </div>
          </div>
        </div>
        <div class="post-elos">
          <span class="elo ${eloClass(p.solo_tier)}">Solo ${eloLabel(p.solo_tier, p.solo_rank, p.solo_lp)}</span>
          <span class="elo ${eloClass(p.flex_tier)}">Flex ${eloLabel(p.flex_tier, p.flex_rank, p.flex_lp)}</span>
        </div>
      </div>
    </div>
    <div class="post-body">${escapeHtml(p.content)}</div>
    <div style="margin-bottom:8px">
      <span class="tag ${
        p.queue_type==='FLEX'  ? 'tag-flex on'  :
        p.queue_type==='ARAM'  ? 'tag-aram on'  :
        p.queue_type==='ARENA' ? 'tag-arena on' :
        'tag-solo on'
      }" style="cursor:default;pointer-events:none">
        ${ p.queue_type==='FLEX' ? 'Flex' : p.queue_type==='ARAM' ? 'ARAM' : p.queue_type==='ARENA' ? 'Arena' : p.queue_type==='BOTH' ? 'Solo + Flex' : 'Solo/Duo' }
      </span>
    </div>
    <div class="post-actions">
      <button class="act-btn ${p.liked_by_me ? 'liked' : ''}" onclick="toggleLike(${p.id}, this)">
        <i class="ti ti-heart"></i> <span class="lk">${p.total_likes}</span>
      </button>
      <button class="act-btn" onclick="toggleComments(${p.id}, this)">
        <i class="ti ti-message-2"></i> <span>${p.total_comments}</span>
      </button>
      ${!isMe ? `
      <button class="act-btn" onclick="addFriend(${p.user_id}, this)">
        <i class="ti ti-user-plus"></i> <span>Adicionar</span>
      </button>
      <button class="act-btn" style="margin-left:auto" onclick="openDM(${p.user_id},'${escapeHtml(p.username)}')">
        <i class="ti ti-send"></i> DM
      </button>` : `
      <button class="act-btn" onclick="deletePost(${p.id})" style="margin-left:auto">
        <i class="ti ti-trash"></i> Deletar
      </button>`}
    </div>
    <div class="comments-section" id="comments-${p.id}" style="display:none">
      <div id="clist-${p.id}"></div>
      <div class="comment-input-row">
        <input class="comment-inp" id="cinp-${p.id}" placeholder="Comentar..." onkeydown="if(event.key==='Enter')submitComment(${p.id})">
        <button class="btn-send" onclick="submitComment(${p.id})"><i class="ti ti-send"></i></button>
      </div>
    </div>
  </div>`;
}

async function toggleLike(postId, btn) {
  try {
    const res  = await api('/posts/' + postId + '/like', { method: 'POST' });
    const span = btn.querySelector('.lk');
    span.textContent = parseInt(span.textContent) + (res.liked ? 1 : -1);
    btn.classList.toggle('liked', res.liked);
  } catch { toast('Erro ao curtir'); }
}

async function toggleComments(postId) {
  const section = $('comments-' + postId);
  const open    = section.style.display !== 'none';
  section.style.display = open ? 'none' : 'block';
  if (!open && !section.dataset.loaded) {
    section.dataset.loaded = '1';
    const list = $('clist-' + postId);
    list.innerHTML = '<div class="loading" style="padding:8px"><div class="spinner"></div></div>';
    try {
      const comments = await api('/posts/' + postId + '/comments');
      list.innerHTML = comments.length
        ? comments.map(c => `
          <div class="comment-item">
            ${avatarHTML({username:c.username, avatar_url:c.avatar_url, online_status:'offline'}, 'av-sm')}
            <div class="comment-content">
              <div class="comment-author">${escapeHtml(c.username)}</div>
              <div class="comment-text">${escapeHtml(c.content)}</div>
            </div>
          </div>`).join('')
        : '<div style="color:var(--dim);font-size:13px;padding:8px 0">Sem comentários ainda.</div>';
    } catch { list.innerHTML = '<div style="color:var(--dim);font-size:13px">Erro ao carregar.</div>'; }
  }
}

async function submitComment(postId) {
  const inp = $('cinp-' + postId);
  if (!inp || !inp.value.trim()) return;
  try {
    const c   = await api('/posts/' + postId + '/comments', { method:'POST', body:{ content: inp.value } });
    const list = $('clist-' + postId);
    const div  = document.createElement('div');
    div.className = 'comment-item';
    div.innerHTML = `${avatarHTML(me, 'av-sm')}<div class="comment-content"><div class="comment-author">${escapeHtml(me.username)}</div><div class="comment-text">${escapeHtml(c.content)}</div></div>`;
    list.appendChild(div);
    inp.value = '';
  } catch { toast('Erro ao comentar'); }
}

async function deletePost(postId) {
  if (!confirm('Deletar este post?')) return;
  await api('/posts/' + postId, { method: 'DELETE' });
  const el = $('post-' + postId);
  if (el) el.remove();
  toast('Post removido');
}

function setPostQueue(q, el) {
  postQueue = q;
  document.querySelectorAll('.composer-tag').forEach(t => {
    t.classList.remove('on');
    if (t.tagName === 'BUTTON') {
      t.style.background = 'rgba(100,100,100,.12)';
      t.style.color      = 'var(--muted)';
      t.style.borderColor= 'var(--dim)';
    }
  });
  el.classList.add('on');
  el.style.background  = '';
  el.style.color       = '';
  el.style.borderColor = '';
}

async function publishPost() {
  const ta      = $('post-textarea');
  const content = ta.value.trim();
  if (!content || content.length < 5) { toast('Escreva pelo menos 5 caracteres'); return; }
  if (content.length > 500)           { toast('Máximo 500 caracteres'); return; }
  const btn = $('btn-publish');
  btn.disabled = true; btn.textContent = 'POSTANDO...';
  try {
    const post = await api('/posts', { method:'POST', body:{ content, queue_type: postQueue } });
    ta.value = '';

    const postData = {
      ...post,
      username:      me.username      || post.username,
      lol_game_name: me.lol_game_name || post.lol_game_name,
      lol_tag_line:  me.lol_tag_line  || post.lol_tag_line,
      solo_tier:     me.solo_tier     || post.solo_tier,
      solo_rank:     me.solo_rank     || post.solo_rank,
      solo_lp:       me.solo_lp       || post.solo_lp,
      flex_tier:     me.flex_tier     || post.flex_tier,
      flex_rank:     me.flex_rank     || post.flex_rank,
      flex_lp:       me.flex_lp       || post.flex_lp,
      online_status: 'online',
      liked_by_me:   0,
      total_likes:   0,
      total_comments:0
    };

    const c = $('feed-posts');
    const empty = c.querySelector('.empty');
    if (empty) empty.remove();

    const wrapper = document.createElement('div');
    wrapper.innerHTML = postHTML(postData);
    const newPost = wrapper.firstElementChild;
    if (newPost) {
      c.insertBefore(newPost, c.firstChild);
      const scrollable = c.closest('.scrollable');
      if (scrollable) scrollable.scrollTo({ top: 0, behavior: 'smooth' });
    }

    toast('\u{1F4E2} Post publicado!');
  } catch (err) {
    toast(err.error || 'Erro ao publicar');
  }
  btn.disabled = false; btn.textContent = 'POSTAR';
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.feed-filter').forEach(el => {
    el.classList.remove('on');
    if (el.dataset.filter === f) el.classList.add('on');
  });
  loadFeed();
}

// ── Explore ────────────────────────────────────
async function loadExplore() {
  const grid = $('explore-grid');
  grid.innerHTML = '<div class="loading" style="grid-column:1/-1"><div class="spinner"></div> Buscando jogadores...</div>';
  try {
    const users = await api('/users?limit=20');
    renderPlayerGrid(users);
  } catch { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><i class="ti ti-alert-circle"></i><p>Erro ao carregar</p></div>'; }
}

async function searchPlayers() {
  const q    = $('explore-search').value.trim();
  const grid = $('explore-grid');
  grid.innerHTML = '<div class="loading" style="grid-column:1/-1"><div class="spinner"></div></div>';
  try {
    const users = await api('/users?q=' + encodeURIComponent(q));
    renderPlayerGrid(users);
  } catch {}
}

function renderPlayerGrid(users) {
  const grid = $('explore-grid');
  if (!users.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><i class="ti ti-users-off"></i><p>Nenhum jogador encontrado</p></div>';
    return;
  }
  grid.innerHTML = users.map(u => {
    const col = avatarColor(u.username || 'U');
    const letter = (u.username || 'U')[0].toUpperCase();
    const status = u.online_status || 'offline';
    const dotCls = status === 'online' ? 'dot-online' : 'dot-offline';
    return `
    <div class="player-card">
      <div class="pc-banner">
        <div class="pc-avatar-wrap">
          <div class="av av-md" style="background:${col};color:#0E0E12;width:44px;height:44px;font-size:16px;box-shadow:0 0 0 2px var(--navy-c),0 0 0 3px ${col}60">
            ${letter}
            <div class="status-dot ${dotCls}"></div>
          </div>
        </div>
      </div>
      <div class="pc-body">
        <div class="pc-top">
          <div class="pc-name">${escapeHtml(dName(u))}</div>
          <div class="pc-nick">${escapeHtml(u.lol_game_name)}#${escapeHtml(u.lol_tag_line)}</div>
        </div>
        <div class="pc-elos">
          <span class="elo ${eloClass(u.solo_tier)}">Solo ${eloLabel(u.solo_tier,u.solo_rank,u.solo_lp)}</span>
          <span class="elo ${eloClass(u.flex_tier)}">Flex ${eloLabel(u.flex_tier,u.flex_rank,u.flex_lp)}</span>
        </div>
        <div class="pc-actions">
          <div class="btn-invite" onclick="addFriendById(${u.id},'${escapeHtml(u.username)}',this)">+ Adicionar</div>
          <div class="btn-dm" onclick="openDM(${u.id},'${escapeHtml(u.username)}')">DM</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function addFriendById(userId, username, el) {
  try {
    await api('/users/me/friend-request', { method:'POST', body:{ receiver_id: userId } });
    el.className = 'btn-invite sent';
    el.textContent = '✓ Enviado';
    toast('✅ Solicitação enviada para ' + username);
  } catch (err) { toast(err.error || 'Erro'); }
}

// ── Messages ───────────────────────────────────
async function loadConversations() {
  const list = $('conv-list');
  list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  msgCount = 0; updateMsgBadge();

  // Carregar amigos junto com as conversas
  loadFriendsInMessages();

  try {
    const convs = await api('/messages');
    if (!convs.length) {
      list.innerHTML = '<div class="empty"><i class="ti ti-messages-off"></i><p>Nenhuma conversa ainda</p></div>';
      return;
    }
    list.innerHTML = convs.map(c => `
      <div class="conv-item ${c.unread_count > 0 ? 'unread' : ''}" onclick="openConv(${c.id},${c.partner_id},'${escapeHtml(c.username)}')">
        ${avatarHTML(c, 'av-md')}
        <div class="conv-meta">
          <div class="conv-name">${escapeHtml(c.username)}</div>
          <div class="conv-last">${escapeHtml(c.last_message || 'Iniciar conversa')}</div>
        </div>
        ${c.unread_count > 0 ? `<div class="unread-badge">${c.unread_count}</div>` : ''}
      </div>`).join('');
  } catch { list.innerHTML = '<div class="empty"><p>Erro ao carregar</p></div>'; }
}

async function openDM(partnerId, partnerName) {
  try {
    const { conversation_id } = await api('/messages/open', { method:'POST', body:{ partner_id: partnerId } });
    openChatWindow(conversation_id, partnerId, partnerName);
  } catch { toast('Erro ao abrir conversa'); }
}

function openConv(convId, partnerId, partnerName) {
  openChatWindow(convId, partnerId, partnerName);
}

function openChatWindow(convId, partnerId, partnerName) {
  currentConvId      = convId;
  currentChatPartner = { id: partnerId, name: partnerName };
  // Zera o unread no cache local e redesenha o painel
  const c = rpConvCache.find(c => c.id == convId);
  if (c) { c.unread_count = 0; renderRightPanelChats(rpConvCache); }
  $('chat-partner-name').textContent = partnerName;
  const av  = $('chat-av-header');
  const col = avatarColor(partnerName);
  av.style.background = col;
  av.style.color      = '#0A0E1A';
  av.textContent      = partnerName[0].toUpperCase();
  $('chat-window').classList.add('open');
  loadMessages(convId);
  if (socket) socket.emit('join_conversation', convId);
}

async function loadMessages(convId) {
  const msgs = $('chat-msgs');
  msgs.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const list = await api('/messages/' + convId);
    msgs.innerHTML = '';
    list.forEach(m => appendBubble(m, m.sender_id == me?.id ? 'me' : 'them'));
    msgs.scrollTop = msgs.scrollHeight;
  } catch { msgs.innerHTML = '<div class="empty"><p>Erro ao carregar mensagens</p></div>'; }
}

function appendBubble(msg, side) {
  const msgs = $('chat-msgs');
  const div  = document.createElement('div');
  div.className   = 'bubble ' + side;
  div.textContent = msg.content;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

async function sendChatMessage() {
  if (!currentConvId) return;
  const inp     = $('chat-input');
  const content = inp.value.trim();
  if (!content) return;
  inp.value = '';
  if (socket?.connected) {
    // Socket cuida de adicionar a bolha via evento new_message (sem duplicar)
    socket.emit('send_message', { conversation_id: currentConvId, content });
  } else {
    // Fallback HTTP: adiciona manualmente pois não há socket para retornar
    try {
      const msg = await api('/messages/' + currentConvId, { method:'POST', body:{ content } });
      appendBubble({ content, sender_id: me?.id }, 'me');
    } catch { toast('Erro ao enviar'); inp.value = content; }
  }
}

// ── Notifications ──────────────────────────────
async function loadNotifications() {
  const list = $('notif-list');
  list.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const notifs = await api('/notifications');
    await api('/notifications/read-all', { method:'PATCH' });
    notifCount = 0; updateNotifBadge();
    if (!notifs.length) {
      list.innerHTML = '<div class="empty"><i class="ti ti-bell-off"></i><p>Sem notificações</p></div>';
      return;
    }
    list.innerHTML = notifs.map(n => notifItemHTML(n)).join('');
  } catch { list.innerHTML = '<div class="empty"><p>Erro ao carregar</p></div>'; }
}

function notifItemHTML(n) {
  const icons = {
    POST_LIKE:'ti-heart', POST_COMMENT:'ti-message-2', COMMENT_REPLY:'ti-message-reply',
    FRIEND_REQUEST:'ti-user-plus', FRIEND_ACCEPTED:'ti-user-check',
    NEW_MESSAGE:'ti-message', DUO_INVITE:'ti-sword', ELO_UPDATE:'ti-trophy', SYSTEM:'ti-info-circle'
  };
  const texts = {
    POST_LIKE:'curtiu seu post', POST_COMMENT:'comentou no seu post',
    COMMENT_REPLY:'respondeu seu comentário', FRIEND_REQUEST:'te enviou uma solicitação de amizade',
    FRIEND_ACCEPTED:'aceitou sua solicitação de amizade', NEW_MESSAGE:'te enviou uma mensagem',
    DUO_INVITE:'te convidou para duo', ELO_UPDATE:'Seu elo foi atualizado!', SYSTEM:'Mensagem do sistema'
  };

  const actorName = escapeHtml(n.actor_display_name || n.actor_username || '');
  const icon = icons[n.type] || 'ti-bell';

  // Ação ao clicar no item principal
  let clickAction = '';
  if (n.type === 'FRIEND_ACCEPTED' && n.actor_id)
    clickAction = `onclick="viewProfile(${n.actor_id})"`;
  else if ((n.type === 'POST_LIKE' || n.type === 'POST_COMMENT') && n.reference_id)
    clickAction = `onclick="goToPost(${n.reference_id})"`;
  else if (n.type === 'NEW_MESSAGE' && n.actor_id)
    clickAction = `onclick="openDM(${n.actor_id},'${actorName}')"`;
  else if (n.type === 'ELO_UPDATE')
    clickAction = `onclick="loadPage('profile')"`;

  const clickable = clickAction ? 'notif-clickable' : '';

  // Botões de aceitar/recusar para solicitação pendente
  const friendButtons = n.type === 'FRIEND_REQUEST' && n.actor_id ? `
    <div class="notif-friend-btns" id="nfb-${n.id}">
      <button class="notif-btn-accept" onclick="respondFriendRequest(${n.actor_id},'accept','${n.id}')">
        <i class="ti ti-check"></i> Aceitar
      </button>
      <button class="notif-btn-decline" onclick="respondFriendRequest(${n.actor_id},'reject','${n.id}')">
        <i class="ti ti-x"></i> Recusar
      </button>
    </div>` : '';

  return `
    <div class="notif-item ${n.is_read ? '' : 'unread'} ${clickable}" ${clickAction} id="notif-${n.id}">
      <div class="notif-icon notif-icon-${n.type.toLowerCase()}">
        <i class="ti ${icon}"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div class="notif-text">
          ${actorName ? `<strong>${actorName}</strong> ` : ''}${texts[n.type] || n.type}
        </div>
        <div class="notif-time">${timeAgo(n.created_at)}</div>
        ${friendButtons}
      </div>
      ${clickAction ? `<i class="ti ti-chevron-right" style="color:var(--dim);font-size:14px;flex-shrink:0"></i>` : ''}
    </div>`;
}

async function respondFriendRequest(senderId, action, notifId) {
  const btns = $('nfb-' + notifId);
  if (btns) btns.innerHTML = '<span style="font-size:12px;color:var(--dim)">Processando...</span>';
  try {
    await api('/users/me/friend-request/respond', { method:'POST', body:{ sender_id: senderId, action } });
    const notifEl = $('notif-' + notifId);
    if (action === 'accept') {
      if (btns) btns.innerHTML = '<span class="notif-status-ok"><i class="ti ti-user-check"></i> Amizade aceita!</span>';
      toast('✅ Solicitação aceita!');
      loadFriends(); // atualiza lista de amigos na sidebar
    } else {
      if (notifEl) notifEl.style.opacity = '0.4';
      if (btns) btns.innerHTML = '<span style="font-size:12px;color:var(--dim)">Solicitação recusada</span>';
      toast('Solicitação recusada');
    }
  } catch (err) {
    if (btns) btns.innerHTML = '<span style="font-size:12px;color:var(--red)">' + (err.error || 'Erro') + '</span>';
    toast('❌ ' + (err.error || 'Erro'));
  }
}

function goToPost(postId) {
  loadPage('feed');
  // Aguarda o feed carregar e tenta rolar até o post
  setTimeout(() => {
    const el = $('post-' + postId);
    if (el) {
      el.scrollIntoView({ behavior:'smooth', block:'center' });
      el.style.outline = '2px solid var(--gold)';
      el.style.outlineOffset = '3px';
      setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 2500);
    }
  }, 800);
}

async function loadNotifCount() {
  try {
    const { count } = await api('/notifications/count');
    notifCount = count;
    updateNotifBadge();
  } catch {}
}

async function loadMsgCount() {
  try {
    const convs = await api('/messages');
    msgCount = convs.reduce((a, c) => a + (parseInt(c.unread_count) || 0), 0);
    updateMsgBadge();
  } catch {}
}

function updateNotifBadge() {
  const b = $('notif-badge');
  if (!b) return;
  b.textContent    = notifCount;
  b.style.display  = notifCount > 0 ? '' : 'none';
}
function updateMsgBadge() {
  const b = $('msg-badge');
  if (!b) return;
  b.textContent   = msgCount;
  b.style.display = msgCount > 0 ? '' : 'none';
}

// ── Data Dragon — capa do perfil ──────────────
let _ddragonVersion = '14.24.1';
let _bannerSelection = null; // ex: { key:'Xerath', num:1, name:'Scorched Earth Xerath' }

// Mapeia nomes de exibição → chave interna do DDragon
const CHAMP_KEY_MAP = {
  'Aurelion Sol':'AurelionSol','Bel\'Veth':'Belveth','Cho\'Gath':'Chogath',
  'Dr. Mundo':'DrMundo','Jarvan IV':'JarvanIV','K\'Sante':'KSante',
  'Kai\'Sa':'Kaisa','Kha\'Zix':'Khazix','Kog\'Maw':'KogMaw',
  'LeBlanc':'Leblanc','Lee Sin':'LeeSin','Master Yi':'MasterYi',
  'Miss Fortune':'MissFortune','Nunu & Willump':'Nunu','Rek\'Sai':'RekSai',
  'Renata Glasc':'Renata','Tahm Kench':'TahmKench','Twisted Fate':'TwistedFate',
  'Vel\'Koz':'Velkoz','Wukong':'MonkeyKing','Xin Zhao':'XinZhao',
  'Aurelion Sol':'AurelionSol','Nunu & Willump':'Nunu',
};

function champKey(displayName) {
  if (CHAMP_KEY_MAP[displayName]) return CHAMP_KEY_MAP[displayName];
  return displayName.replace(/[\s'&.]/g,'').replace(/[^a-zA-Z0-9]/g,'');
}

function splashUrl(key, num) {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${key}_${num}.jpg`;
}

function tileUrl(key, num) {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/tiles/${key}_${num}.jpg`;
}

function portraitUrl(key) {
  return `https://ddragon.leagueoflegends.com/cdn/${_ddragonVersion}/img/champion/${key}.png`;
}

async function fetchDDragonVersion() {
  try {
    const r = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const v = await r.json();
    _ddragonVersion = v[0];
  } catch {}
}

async function fetchChampSkins(key) {
  try {
    const r = await fetch(`https://ddragon.leagueoflegends.com/cdn/${_ddragonVersion}/data/pt_BR/champion/${key}.json`);
    const d = await r.json();
    return d.data[Object.keys(d.data)[0]].skins;
  } catch {
    try {
      const r = await fetch(`https://ddragon.leagueoflegends.com/cdn/${_ddragonVersion}/data/en_US/champion/${key}.json`);
      const d = await r.json();
      return d.data[Object.keys(d.data)[0]].skins;
    } catch { return []; }
  }
}

// Abre o seletor de capa
async function openBannerPicker() {
  const modal = document.getElementById('banner-modal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  _bannerSelection = null;
  document.getElementById('banner-confirm-btn').disabled = true;
  document.getElementById('banner-confirm-btn').style.opacity = '.5';
  await fetchDDragonVersion();
  renderBannerChampList(LOL_CHAMPIONS);
}

function closeBannerModal() {
  document.getElementById('banner-modal').style.display = 'none';
  document.body.style.overflow = '';
}

function filterBannerChamps(q) {
  const filtered = q.trim()
    ? LOL_CHAMPIONS.filter(c => c.toLowerCase().includes(q.toLowerCase()))
    : LOL_CHAMPIONS;
  renderBannerChampList(filtered);
}

function renderBannerChampList(champs) {
  const list = document.getElementById('banner-champ-list');
  list.innerHTML = champs.map(c => {
    const key = champKey(c);
    // Usa data-attributes para evitar quebra com aspas simples nos nomes (Kai'Sa, Rek'Sai, etc.)
    return `<div class="banner-champ-item" data-key="${key}" data-name="${escapeHtml(c)}" onclick="selectBannerChampEl(this)">
      <img src="${portraitUrl(key)}" class="banner-champ-portrait" onerror="this.style.display='none'" loading="lazy">
      <span>${escapeHtml(c)}</span>
    </div>`;
  }).join('');
}

function selectBannerChampEl(el) {
  selectBannerChamp(el.dataset.key, el.dataset.name, el);
}

let _lastBannerChampEl = null;
async function selectBannerChamp(key, displayName, el) {
  if (_lastBannerChampEl) _lastBannerChampEl.classList.remove('active');
  el.classList.add('active');
  _lastBannerChampEl = el;

  const panel = document.getElementById('banner-skin-panel');
  panel.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando skins...</div>';

  const skins = await fetchChampSkins(key);
  if (!skins.length) {
    panel.innerHTML = '<div class="empty"><p>Erro ao carregar skins</p></div>';
    return;
  }

  // Filtra skins sem imagem (chromas não têm splash/tile próprio)
  const skinsWithImage = await filterSkinsWithImage(key, skins);

  panel.innerHTML = `
    <div style="margin-bottom:12px;font-family:'Rajdhani',sans-serif;font-size:15px;font-weight:700;letter-spacing:1px;color:var(--gold-l)">${escapeHtml(displayName)}</div>
    <div class="banner-skin-grid">
      ${skinsWithImage.map(s => `
        <div class="banner-skin-card" data-key="${key}" data-num="${s.num}" data-name="${escapeHtml(s.name==='default'?displayName:s.name)}"
             onclick="selectBannerSkin(this)">
          <img src="${tileUrl(key, s.num)}" class="banner-skin-thumb" loading="lazy"
               onerror="this.parentElement.style.display='none'">
          <div class="banner-skin-label">${s.name==='default'?'Padrão':escapeHtml(s.name)}</div>
        </div>`).join('')}
    </div>`;
}

// Testa quais skins têm imagem válida (remove chromas que retornam 404)
async function filterSkinsWithImage(key, skins) {
  const checks = skins.map(s => 
    fetch(tileUrl(key, s.num), { method: 'HEAD' })
      .then(r => r.ok ? s : null)
      .catch(() => null)
  );
  const results = await Promise.all(checks);
  return results.filter(Boolean);
}

function selectBannerSkin(el) {
  document.querySelectorAll('.banner-skin-card.selected').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  _bannerSelection = { key: el.dataset.key, num: parseInt(el.dataset.num), name: el.dataset.name };
  const btn = document.getElementById('banner-confirm-btn');
  btn.disabled = false;
  btn.style.opacity = '1';
}

async function confirmBannerSelection() {
  if (!_bannerSelection) return;
  const banner = `${_bannerSelection.key}_${_bannerSelection.num}`;
  try {
    await api('/users/me', { method:'PATCH', body:{ profile_banner: banner } });
    me.profile_banner = banner;
    localStorage.setItem('duoq_me', JSON.stringify(me));
    closeBannerModal();
    toast('✅ Capa atualizada!');
    loadMyProfile();
  } catch (err) { toast('❌ ' + (err?.error||'Erro ao salvar')); }
}

// ── Lista de campeões do LoL ───────────────────
const LOL_CHAMPIONS = [
  'Aatrox','Ahri','Akali','Akshan','Alistar','Ambessa','Amumu','Anivia','Annie','Aphelios',
  'Ashe','Aurelion Sol','Aurora','Azir','Bard','Bel\'Veth','Blitzcrank','Brand','Braum','Briar',
  'Caitlyn','Camille','Cassiopeia','Cho\'Gath','Corki','Darius','Diana','Dr. Mundo','Draven',
  'Ekko','Elise','Evelynn','Ezreal','Fiddlesticks','Fiora','Fizz','Galio','Gangplank','Garen',
  'Gnar','Gragas','Graves','Gwen','Hecarim','Heimerdinger','Hwei','Illaoi','Irelia','Ivern',
  'Janna','Jarvan IV','Jax','Jayce','Jhin','Jinx','K\'Sante','Kai\'Sa','Kalista','Karma',
  'Karthus','Kassadin','Katarina','Kayle','Kayn','Kennen','Kha\'Zix','Kindred','Kled',
  'Kog\'Maw','LeBlanc','Lee Sin','Leona','Lillia','Lissandra','Lucian','Lulu','Lux',
  'Malphite','Malzahar','Maokai','Master Yi','Milio','Miss Fortune','Mordekaiser','Morgana',
  'Naafiri','Nami','Nasus','Nautilus','Neeko','Nidalee','Nilah','Nocturne','Nunu & Willump',
  'Olaf','Orianna','Ornn','Pantheon','Poppy','Pyke','Qiyana','Quinn','Rakan','Rammus',
  'Rek\'Sai','Rell','Renata Glasc','Renekton','Rengar','Riven','Rumble','Ryze','Samira',
  'Sejuani','Senna','Seraphine','Sett','Shaco','Shen','Shyvana','Singed','Sion','Sivir',
  'Skarner','Smolder','Sona','Soraka','Swain','Sylas','Syndra','Tahm Kench','Taliyah',
  'Talon','Taric','Teemo','Thresh','Tristana','Trundle','Tryndamere','Twisted Fate','Twitch',
  'Udyr','Urgot','Varus','Vayne','Veigar','Vel\'Koz','Vex','Vi','Viego','Viktor','Vladimir',
  'Volibear','Warwick','Wukong','Xayah','Xerath','Xin Zhao','Yasuo','Yone','Yorick','Yuumi',
  'Zac','Zed','Zeri','Ziggs','Zilean','Zoe','Zyra'
].sort();

const LOL_ROLES = [
  { id:'TOP',     label:'Top',     icon:'ti-shield' },
  { id:'JUNGLE',  label:'Jungle',  icon:'ti-trees' },
  { id:'MID',     label:'Mid',     icon:'ti-flame' },
  { id:'ADC',     label:'ADC',     icon:'ti-bow' },
  { id:'SUPPORT', label:'Support', icon:'ti-heart' },
];

// ── YouTube helpers ────────────────────────────
function ytId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
function ytThumb(id) { return `https://img.youtube.com/vi/${id}/mqdefault.jpg`; }
function spotifyId(url) {
  const m = url.match(/spotify\.com\/(?:playlist|album|track)\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}
function spotifyType(url) {
  const m = url.match(/spotify\.com\/(playlist|album|track)\//);
  return m ? m[1] : 'playlist';
}

// ── Profile ────────────────────────────────────
async function loadMyProfile() {
  try {
    const user = await api('/users/me');
    me = { ...me, ...user };
    localStorage.setItem('duoq_me', JSON.stringify(me));
    renderProfile(user, true);
  } catch {}
}

async function viewProfile(userId) {
  loadPage('profile');
  try {
    const user = await api('/users/' + userId);
    renderProfile(user, userId == me?.id);
  } catch {}
}

function renderProfile(user, isMe) {
  const soloLabel = eloLabel(user.solo_tier, user.solo_rank, user.solo_lp);
  const flexLabel = eloLabel(user.flex_tier, user.flex_rank, user.flex_lp);

  const avatarEl = isMe
    ? `<div class="avatar-upload-wrap" onclick="triggerAvatarUpload()" title="Alterar foto de perfil">
        ${avatarHTML(user, 'av-2xl')}
        <div class="avatar-upload-overlay"><i class="ti ti-camera"></i></div>
       </div>`
    : avatarHTML(user, 'av-2xl');

  // Parse main_champions — MySQL retorna string JSON
  const champions = (() => {
    try { return JSON.parse(user.main_champions || '[]'); } catch { return []; }
  })();
  const userRoles = (user.roles || []).map(r => r.role || r);

  const bioContent = user.bio
    ? `<p class="profile-bio-text">${escapeHtml(user.bio)}</p>`
    : isMe
      ? `<p class="profile-bio-empty">Clique em editar para contar seu estilo de jogo, lane favorita e horários...</p>`
      : `<p class="profile-bio-empty">Este jogador ainda não escreveu uma bio.</p>`;

  // Carrega conteúdo do perfil em paralelo
  api('/profile/' + user.id).then(content => renderProfileContent(user.id, content, isMe)).catch(() => {});

  // Monta URL da capa
  // Cada perfil tem sua própria capa — não usar fallback do usuário logado
  const bannerVal = user.profile_banner || null;
  const bannerUrl = bannerVal
    ? `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${bannerVal}.jpg`
    : '';

  $('profile-content').innerHTML = `
    <!-- Header com capa cobrindo tudo -->
    <div class="profile-header-wrap" id="profile-cover"
         style="${bannerUrl ? `background-image:url('${bannerUrl}')` : ''}">
      <div class="cover-gradient-full"></div>
      ${isMe ? `<button class="cover-edit-btn" onclick="openBannerPicker()"><i class="ti ti-camera"></i> ${bannerUrl ? 'Alterar capa' : 'Adicionar capa'}</button>` : ''}

    <div class="profile-banner">
      <div class="profile-top">
        ${avatarEl}
        <div class="profile-info">
          <div class="profile-name">${escapeHtml(dName(user))}</div>
          <div class="profile-nick">${escapeHtml(user.lol_game_name)}#${escapeHtml(user.lol_tag_line)}</div>
          <div class="profile-elos">
            <span class="elo ${eloClass(user.solo_tier)}">Solo ${soloLabel}</span>
            <span class="elo ${eloClass(user.flex_tier)}">Flex ${flexLabel}</span>
            ${user.has_mic ? '<span class="profile-mic-badge"><i class="ti ti-microphone"></i> Mic</span>' : ''}
          </div>
          ${userRoles.length ? `
          <div class="profile-roles">
            ${userRoles.map(r => {
              const rd = LOL_ROLES.find(x => x.id === r);
              return `<span class="profile-role-badge"><i class="ti ${rd?.icon||'ti-sword'}"></i>${rd?.label||r}</span>`;
            }).join('')}
          </div>` : ''}
          ${champions.length ? `
          <div class="profile-champs">
            ${champions.map((c, i) => {
              const key = champKey(c);
              const tierClass = ['champ-tier-1','champ-tier-2','champ-tier-3'][i];
              const tierLabel = ['🥇 1º','🥈 2º','🥉 3º'][i];
              return `
              <div class="champ-badge ${tierClass}" title="${escapeHtml(c)}">
                <div class="champ-portrait-wrap">
                  <img class="champ-portrait"
                    src="${portraitUrl(key)}"
                    onerror="this.src='https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion/${key}.png'"
                    alt="${escapeHtml(c)}" loading="lazy">
                </div>
                <span class="champ-tier-label">${tierLabel} ${escapeHtml(c)}</span>
              </div>`;
            }).join('')}
          </div>` : ''}
          <div class="profile-stats">
            <div class="pstat"><div class="pstat-num">${user.total_posts || 0}</div><div class="pstat-lbl">Posts</div></div>
            <div class="pstat"><div class="pstat-num">${user.total_friends || 0}</div><div class="pstat-lbl">Amigos</div></div>
            <div class="pstat"><div class="pstat-num">${user.total_likes_received || 0}</div><div class="pstat-lbl">Curtidas</div></div>
          </div>
        </div>
      </div>
      <div class="profile-actions">
        ${isMe
          ? `<button id="mic-toggle-btn" type="button"
               class="mic-icon-btn ${user.has_mic ? 'mic-on' : ''}"
               onclick="toggleMicSave(this)"
               title="${user.has_mic ? 'Microfone ativo — clique para desativar' : 'Sem microfone — clique para ativar'}">
               <i class="ti ti-microphone${user.has_mic ? '' : '-off'}"></i>
             </button>
             <button class="btn-outline" onclick="syncElo()"><i class="ti ti-refresh"></i> Sync Elo</button>
             <button class="btn-outline" onclick="logout()" style="border-color:rgba(239,68,68,.4);color:#FCA5A5"><i class="ti ti-logout"></i> Sair</button>`
          : `<button class="btn-outline" style="border-color:rgba(64,128,255,.4);color:#93C5FD" onclick="openDM(${user.id},'${escapeHtml(dName(user))}')"><i class="ti ti-message-2"></i> Mensagem</button>
             ${user.is_friend
               ? `<button class="btn-outline" onclick="confirmUnfriend(${user.id},'${escapeHtml(dName(user))}')"><i class="ti ti-user-minus"></i> Desfazer amizade</button>`
               : `<button class="btn-outline" onclick="addFriendById(${user.id},'${escapeHtml(dName(user))}',this)"><i class="ti ti-user-plus"></i> Adicionar</button>`}
             <button class="btn-outline" id="profile-block-btn-${user.id}"
               style="border-color:rgba(239,68,68,.35);color:#FCA5A5"
               onclick="${user.is_blocked ? `unblockUser(${user.id},'${escapeHtml(dName(user))}')` : `confirmBlockUser(${user.id},'${escapeHtml(dName(user))}')`}">
               <i class="ti ti-${user.is_blocked ? 'lock-open' : 'ban'}"></i> ${user.is_blocked ? 'Desbloquear' : 'Bloquear'}
             </button>
             <button class="btn-outline" style="border-color:rgba(251,191,36,.35);color:#FDE68A"
               onclick="openReportModal(null,${user.id})"><i class="ti ti-flag"></i> Denunciar</button>`}
      </div>
    </div><!-- /profile-banner -->
    </div><!-- /profile-header-wrap -->

    <div class="profile-body">

      <!-- Bio -->
      <div class="profile-section">
        <div class="profile-section-head">
          <span class="profile-section-title"><i class="ti ti-user"></i> Sobre</span>
          ${isMe ? `<button class="profile-edit-btn" onclick="toggleBioEdit(this)" data-editing="false"><i class="ti ti-pencil"></i> Editar</button>` : ''}
        </div>
        <div id="bio-display">${bioContent}</div>
        ${isMe ? `
        <div id="bio-edit" style="display:none">
          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label" style="font-size:10px">Nome de exibição</label>
            <input id="displayname-input" class="form-input" type="text" maxlength="60"
              placeholder="Como você quer ser chamado no feed"
              value="${escapeHtml(user.display_name || '')}">
          </div>

          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label" style="font-size:10px">Rotas favoritas <span style="color:var(--dim)">(máx. 2)</span></label>
            <div class="role-picker" id="role-picker">
              ${LOL_ROLES.map(r => `
                <button type="button" class="role-pick-btn ${userRoles.includes(r.id)?'selected':''}"
                  data-role="${r.id}" onclick="toggleRolePick(this)">
                  <i class="ti ${r.icon}"></i>${r.label}
                </button>`).join('')}
            </div>
          </div>

          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label" style="font-size:10px">Campeões Main <span style="color:var(--dim)">(máx. 3, em ordem)</span></label>
            <div class="champ-tier-editor" id="champ-tier-editor">
              ${[0,1,2].map(i => `
                <div class="champ-tier-slot">
                  <span class="champ-slot-num">${i+1}º</span>
                  <select class="form-input champ-select" id="champ-slot-${i}">
                    <option value="">— Selecionar campeão —</option>
                    ${LOL_CHAMPIONS.map(c => `<option value="${escapeHtml(c)}" ${champions[i]===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}
                  </select>
                </div>`).join('')}
            </div>
          </div>

          <textarea id="bio-textarea" class="bio-textarea" maxlength="300" placeholder="Conta quem você é: sua lane principal, estilo de jogo, horários, o que procura num duo...">${escapeHtml(user.bio || '')}</textarea>
          <div class="bio-edit-foot">
            <span class="bio-char-count" id="bio-chars">${(user.bio||'').length}/300</span>
            <button class="btn-post" onclick="saveBio()">Salvar</button>
            <button class="btn-outline" onclick="cancelBioEdit()" style="padding:8px 14px;font-size:12px">Cancelar</button>
          </div>
        </div>` : ''}
      </div>

      <!-- Ranks -->
      <div class="profile-section">
        <div class="profile-section-head">
          <span class="profile-section-title"><i class="ti ti-trophy"></i> Ranked</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="rank-card">
            <div class="rank-row"><span class="rank-label">Solo/Duo</span><span class="rank-val">${soloLabel}</span></div>
            <div class="rank-row"><span class="rank-lp">${user.solo_wins||0}V ${user.solo_losses||0}D</span></div>
            <div class="rank-bar"><div class="rank-fill" style="width:${Math.min(user.solo_lp||0,100)}%;background:var(--gold)"></div></div>
          </div>
          <div class="rank-card">
            <div class="rank-row"><span class="rank-label">Flex</span><span class="rank-val" style="color:#93C5FD">${flexLabel}</span></div>
            <div class="rank-row"><span class="rank-lp">${user.flex_wins||0}V ${user.flex_losses||0}D</span></div>
            <div class="rank-bar"><div class="rank-fill" style="width:${Math.min(user.flex_lp||0,100)}%;background:var(--blue)"></div></div>
          </div>
        </div>
      </div>

      

    </div>

    <!-- Abas estilo Instagram -->
    <div class="profile-tabs" id="profile-tabs">
      <button class="ptab active" data-tab="playlists" onclick="switchProfileTab('playlists')">
        <i class="ti ti-playlist"></i> Playlists
      </button>
      <button class="ptab" data-tab="gameplays" onclick="switchProfileTab('gameplays')">
        <i class="ti ti-device-gamepad-2"></i> Gameplays
      </button>
      <button class="ptab" data-tab="screenshots" onclick="switchProfileTab('screenshots')">
        <i class="ti ti-camera"></i> Screenshots
      </button>
      <button class="ptab" data-tab="socials" onclick="switchProfileTab('socials')">
        <i class="ti ti-at"></i> Redes
      </button>
    </div>
    <div id="profile-tab-content">
      <div class="loading"><div class="spinner"></div></div>
    </div>`;

  renderSidebarRanks();
}

let _profileContentCache = null;
let _profileIsMe = false;
let _profileTabActive = 'playlists';

function renderProfileContent(userId, content, isMe) {
  _profileContentCache = content;
  _profileIsMe = isMe;
  switchProfileTab(_profileTabActive, false);
}

function switchProfileTab(tab, scroll = true) {
  _profileTabActive = tab;
  document.querySelectorAll('.ptab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const box = $('profile-tab-content');
  if (!box) return;
  const c = _profileContentCache;
  const isMe = _profileIsMe;

  if (tab === 'playlists')   box.innerHTML = renderPlaylists(c?.playlists || [], isMe);
  if (tab === 'gameplays')   box.innerHTML = renderGameplays(c?.gameplays || [], isMe);
  if (tab === 'screenshots') box.innerHTML = renderScreenshots(c?.screenshots || [], isMe);
  if (tab === 'socials')     box.innerHTML = renderSocialsTab(c?.socials || null, isMe);

  if (scroll) box.scrollIntoView({ behavior:'smooth', block:'start' });
}

// ── Modal de adicionar ─────────────────────────
let _addModalAction = null;

function openAddModal(title, icon, bodyHTML, onConfirm) {
  $('add-modal-title').innerHTML = `<i class="ti ti-${icon}"></i> ${title}`;
  $('add-modal-body').innerHTML = bodyHTML;
  _addModalAction = onConfirm;
  const modal = $('add-modal');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  // Foca no primeiro input
  setTimeout(() => modal.querySelector('input, textarea, select')?.focus(), 80);
}

function closeAddModal() {
  $('add-modal').classList.remove('open');
  document.body.style.overflow = '';
  _addModalAction = null;
}

async function confirmAddModal() {
  if (!_addModalAction) return;
  const btn = $('add-modal-confirm');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2"></i> Salvando...';
  try {
    const result = await _addModalAction();
    // false = usuário não selecionou arquivo (toast já foi mostrado)
    if (result !== false) closeAddModal();
  } catch (err) {
    toast('❌ ' + (err?.error || err?.message || 'Erro ao salvar. Tente novamente.'));
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-check"></i> Adicionar';
}

// Fecha com ESC
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAddModal(); });

// ── Playlists ──────────────────────────────────
function renderPlaylists(items, isMe) {
  const addBtn = isMe
    ? `<div class="ptab-header"><button class="ptab-add-btn" onclick="openAddPlaylistModal()"><i class="ti ti-plus"></i> Adicionar Playlist</button></div>`
    : '';

  if (!items.length) return `${addBtn}<div class="ptab-empty"><i class="ti ti-playlist"></i><p>${isMe ? 'Adicione suas playlists favoritas para jogar!' : 'Nenhuma playlist ainda.'}</p></div>`;

  return `${addBtn}<div class="ptab-playlist-list">${items.map(p => playlistCard(p, isMe)).join('')}</div>`;
}

function openAddPlaylistModal() {
  openAddModal('Adicionar Playlist', 'playlist', `
    <div class="ptab-form-grid">
      <div class="form-group">
        <label class="form-label">Título</label>
        <input class="form-input" id="pl-title" placeholder="Ex: Lo-fi para rankeada" maxlength="120">
      </div>
      <div class="form-group">
        <label class="form-label">Gênero <span style="color:var(--dim)">(opcional)</span></label>
        <input class="form-input" id="pl-genre" placeholder="Ex: Lo-fi, Rock, Eletrônico" maxlength="60">
      </div>
      <div class="form-group">
        <label class="form-label">Plataforma</label>
        <select class="form-input" id="pl-platform">
          <option value="youtube">🎬 YouTube</option>
          <option value="spotify">🎵 Spotify</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Link</label>
        <input class="form-input" id="pl-url" placeholder="Cole o link do YouTube ou Spotify" maxlength="500">
      </div>
    </div>`, addPlaylist);
}

function playlistCard(p, isMe) {
  const yid = p.platform === 'youtube' ? ytId(p.url) : null;
  const sid = p.platform === 'spotify' ? spotifyId(p.url) : null;
  const stype = sid ? spotifyType(p.url) : 'playlist';

  const player = yid
    ? `<div class="mini-player-wrap" id="mpy-${p.id}">
        <img src="${ytThumb(yid)}" class="mini-thumb" onclick="playYT('${yid}','mpy-${p.id}')" alt="">
        <div class="mini-play-btn" onclick="playYT('${yid}','mpy-${p.id}')"><i class="ti ti-player-play-filled"></i></div>
       </div>`
    : sid
      ? `<iframe src="https://open.spotify.com/embed/${stype}/${sid}?utm_source=generator&theme=0"
           class="spotify-embed" allowtransparency="true" allow="encrypted-media" loading="lazy"></iframe>`
      : `<a href="${escapeHtml(p.url)}" target="_blank" class="ext-link"><i class="ti ti-external-link"></i> Abrir link</a>`;

  return `
  <div class="playlist-card" id="plcard-${p.id}">
    ${player}
    <div class="playlist-info">
      <div class="playlist-title">${escapeHtml(p.title)}</div>
      ${p.genre ? `<div class="playlist-genre">${escapeHtml(p.genre)}</div>` : ''}
      <div class="playlist-platform platform-${p.platform}">
        <i class="ti ti-${p.platform === 'youtube' ? 'brand-youtube' : 'brand-spotify'}"></i>
        ${p.platform === 'youtube' ? 'YouTube' : 'Spotify'}
      </div>
    </div>
    ${isMe ? `<button class="ptab-del-btn" onclick="deletePlaylist(${p.id})"><i class="ti ti-trash"></i></button>` : ''}
  </div>`;
}

function playYT(id, wrapperId) {
  const wrap = $(wrapperId);
  if (!wrap) return;
  wrap.innerHTML = `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1"
    class="yt-iframe" allow="autoplay; encrypted-media" allowfullscreen loading="lazy"></iframe>`;
}

async function addPlaylist() {
  const title = $('pl-title')?.value.trim();
  const genre = $('pl-genre')?.value.trim();
  const platform = $('pl-platform')?.value;
  const url = $('pl-url')?.value.trim();
  if (!title || !url) { toast('⚠️ Preencha título e link'); return false; }
  const item = await api('/profile/me/playlist', { method:'POST', body:{title,genre,platform,url} });
  if (_profileContentCache) _profileContentCache.playlists.unshift(item);
  switchProfileTab('playlists', false);
  toast('✅ Playlist adicionada!');
}

async function deletePlaylist(id) {
  await api('/profile/me/playlist/' + id, { method:'DELETE' });
  _profileContentCache.playlists = _profileContentCache.playlists.filter(p => p.id !== id);
  switchProfileTab('playlists', false);
  toast('Playlist removida');
}

// ── Gameplays ──────────────────────────────────
function renderGameplays(items, isMe) {
  const addBtn = isMe
    ? `<div class="ptab-header"><button class="ptab-add-btn" onclick="openAddGameplayModal()"><i class="ti ti-plus"></i> Adicionar Gameplay</button></div>`
    : '';

  if (!items.length) return `${addBtn}<div class="ptab-empty"><i class="ti ti-device-gamepad-2"></i><p>${isMe ? 'Adicione seus melhores vídeos de gameplay!' : 'Nenhuma gameplay ainda.'}</p></div>`;

  return `${addBtn}<div class="ptab-video-grid">${items.map(g => gameplayCard(g, isMe)).join('')}</div>`;
}

function openAddGameplayModal() {
  openAddModal('Adicionar Gameplay', 'device-gamepad-2', `
    <div class="ptab-form-grid">
      <div class="form-group">
        <label class="form-label">Título do vídeo</label>
        <input class="form-input" id="gp-title" placeholder="Ex: Pentakill no Diamond - Mid Lane" maxlength="120">
      </div>
      <div class="form-group">
        <label class="form-label">Link do YouTube</label>
        <input class="form-input" id="gp-url" placeholder="https://youtube.com/watch?v=..." maxlength="500">
      </div>
    </div>`, addGameplay);
}

function gameplayCard(g, isMe) {
  const yid = ytId(g.url);
  const player = yid
    ? `<div class="mini-player-wrap" id="mpg-${g.id}">
        <img src="${ytThumb(yid)}" class="mini-thumb" onclick="playYT('${yid}','mpg-${g.id}')" alt="">
        <div class="mini-play-btn" onclick="playYT('${yid}','mpg-${g.id}')"><i class="ti ti-player-play-filled"></i></div>
       </div>`
    : `<a href="${escapeHtml(g.url)}" target="_blank" class="ext-link"><i class="ti ti-external-link"></i> Abrir</a>`;

  return `
  <div class="gameplay-card" id="gpcard-${g.id}">
    ${player}
    <div class="gameplay-title">${escapeHtml(g.title)}</div>
    ${isMe ? `<button class="ptab-del-btn" onclick="deleteGameplay(${g.id})"><i class="ti ti-trash"></i></button>` : ''}
  </div>`;
}

async function addGameplay() {
  const title = $('gp-title')?.value.trim();
  const url = $('gp-url')?.value.trim();
  if (!title || !url) { toast('⚠️ Preencha título e link'); return false; }
  if (!ytId(url)) { toast('⚠️ Link do YouTube inválido'); return false; }
  const item = await api('/profile/me/gameplay', { method:'POST', body:{title,url} });
  if (_profileContentCache) _profileContentCache.gameplays.unshift(item);
  switchProfileTab('gameplays', false);
  toast('✅ Gameplay adicionada!');
}

async function deleteGameplay(id) {
  await api('/profile/me/gameplay/' + id, { method:'DELETE' });
  _profileContentCache.gameplays = _profileContentCache.gameplays.filter(g => g.id !== id);
  switchProfileTab('gameplays', false);
  toast('Gameplay removida');
}

// ── Screenshots ────────────────────────────────
function renderScreenshots(items, isMe) {
  const addBtn = isMe
    ? `<div class="ptab-header"><button class="ptab-add-btn" onclick="openAddScreenshotModal()"><i class="ti ti-upload"></i> Upload Screenshot</button></div>`
    : '';

  if (!items.length) return `<div class="ptab-empty"><i class="ti ti-camera"></i><p>${isMe ? 'Adicione suas melhores screenshots de partidas!' : 'Nenhum screenshot ainda.'}</p></div>${addBtn}`;

  return `${addBtn}<div class="ptab-screenshot-grid">${items.map(s => screenshotCard(s, isMe)).join('')}</div>`;
}

function screenshotCard(s, isMe) {
  return `
  <div class="screenshot-card" id="sscard-${s.id}">
    <img src="${s.image}" class="screenshot-img" onclick="openScreenshot('${s.id}')" alt="${escapeHtml(s.caption||'')}">
    ${s.caption ? `<div class="screenshot-caption">${escapeHtml(s.caption)}</div>` : ''}
    ${isMe ? `<button class="ptab-del-btn ptab-del-ss" onclick="deleteScreenshot(${s.id})"><i class="ti ti-trash"></i></button>` : ''}
  </div>`;
}

function openAddScreenshotModal() {
  openAddModal('Adicionar Screenshot', 'camera', `
    <div class="ptab-form-grid">
      <div class="form-group">
        <label class="form-label">Imagem <span style="color:var(--muted)">(JPG, PNG, WebP)</span></label>
        <label class="ss-upload-area" id="ss-upload-label">
          <i class="ti ti-cloud-upload" style="font-size:32px;color:var(--dim)"></i>
          <span style="font-size:13px;color:var(--muted);margin-top:6px">Clique para selecionar</span>
          <input type="file" id="ss-file-input" accept="image/*" style="display:none" onchange="previewScreenshot(event)">
        </label>
        <img id="ss-preview" style="display:none;width:100%;border-radius:9px;margin-top:10px;max-height:200px;object-fit:cover" alt="">
      </div>
      <div class="form-group">
        <label class="form-label">Legenda <span style="color:var(--dim)">(opcional)</span></label>
        <input class="form-input" id="ss-caption" placeholder="Ex: Pentakill no Diamond!" maxlength="200">
      </div>
    </div>`, uploadScreenshot);
}

function previewScreenshot(e) {
  const file = e.target.files[0];
  if (!file) return;
  const prev = $('ss-preview');
  const label = $('ss-upload-label');
  prev.src = URL.createObjectURL(file);
  prev.style.display = 'block';
  label.style.display = 'none';
}

async function uploadScreenshot() {
  const inp = $('ss-file-input');
  if (!inp?.files?.length) {
    toast('⚠️ Selecione uma imagem primeiro');
    return false; // sinaliza que não deve fechar o modal
  }
  const file = inp.files[0];
  toast('⏳ Comprimindo imagem...');
  const image = await compressImage(file, 900, 0.80);
  const caption = $('ss-caption')?.value.trim() || '';
  const item = await api('/profile/me/screenshot', { method:'POST', body:{image, caption} });
  if (_profileContentCache) _profileContentCache.screenshots.unshift(item);
  switchProfileTab('screenshots', false);
  toast('✅ Screenshot adicionada!');
}

async function deleteScreenshot(id) {
  if (!confirm('Remover screenshot?')) return;
  await api('/profile/me/screenshot/' + id, { method:'DELETE' });
  _profileContentCache.screenshots = _profileContentCache.screenshots.filter(s => s.id !== id);
  switchProfileTab('screenshots', false);
  toast('Screenshot removida');
}

function openScreenshot(id) {
  const s = _profileContentCache?.screenshots?.find(x => x.id == id);
  if (!s) return;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:3000;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:20px';
  ov.onclick = () => ov.remove();
  ov.innerHTML = `<img src="${s.image}" style="max-width:100%;max-height:90vh;border-radius:10px;box-shadow:0 0 60px rgba(0,0,0,.8)">`;
  document.body.appendChild(ov);
}

// ── Redes Sociais ──────────────────────────────
function renderSocialsTab(socials, isMe) {
  const ig = socials?.instagram || '';
  const tt = socials?.tiktok || '';
  const yt = socials?.youtube || '';

  const viewLinks = `
    <div class="socials-view">
      ${ig ? `<a href="https://instagram.com/${ig.replace('@','')}" target="_blank" class="social-link social-ig"><i class="ti ti-brand-instagram"></i><span>@${ig.replace('@','')}</span></a>` : ''}
      ${tt ? `<a href="https://tiktok.com/@${tt.replace('@','')}" target="_blank" class="social-link social-tt"><i class="ti ti-brand-tiktok"></i><span>@${tt.replace('@','')}</span></a>` : ''}
      ${yt ? `<a href="${yt.startsWith('http') ? yt : 'https://youtube.com/@'+yt.replace('@','')}" target="_blank" class="social-link social-yt"><i class="ti ti-brand-youtube"></i><span>${yt}</span></a>` : ''}
      ${!ig && !tt && !yt ? `<div class="ptab-empty"><i class="ti ti-at"></i><p>${isMe ? 'Adicione suas redes sociais!' : 'Nenhuma rede social.'}</p></div>` : ''}
    </div>`;

  const editBtn = isMe
    ? `<div class="ptab-header"><button class="ptab-add-btn" onclick="openEditSocialsModal()"><i class="ti ti-pencil"></i> Editar Redes Sociais</button></div>`
    : '';

  return editBtn + viewLinks;
}

function openEditSocialsModal() {
  const s = _profileContentCache?.socials || {};
  openAddModal('Editar Redes Sociais', 'at', `
    <div class="ptab-form-grid">
      <div class="form-group">
        <label class="form-label"><i class="ti ti-brand-instagram" style="color:#E1306C"></i> Instagram</label>
        <input class="form-input" id="soc-ig" placeholder="@seu_instagram" value="${escapeHtml(s.instagram||'')}" maxlength="120">
      </div>
      <div class="form-group">
        <label class="form-label"><i class="ti ti-brand-tiktok" style="color:#aaa"></i> TikTok</label>
        <input class="form-input" id="soc-tt" placeholder="@seu_tiktok" value="${escapeHtml(s.tiktok||'')}" maxlength="120">
      </div>
      <div class="form-group">
        <label class="form-label"><i class="ti ti-brand-youtube" style="color:#FF0000"></i> YouTube</label>
        <input class="form-input" id="soc-yt" placeholder="@canal ou link completo" value="${escapeHtml(s.youtube||'')}" maxlength="200">
      </div>
    </div>`, saveSocials);
  // Muda botão do footer para "Salvar"
  setTimeout(() => { const btn = $('add-modal-confirm'); if(btn){ btn.innerHTML='<i class="ti ti-check"></i> Salvar'; } }, 10);
}

async function saveSocials() {
  const instagram = $('soc-ig')?.value.trim();
  const tiktok    = $('soc-tt')?.value.trim();
  const youtube   = $('soc-yt')?.value.trim();
  await api('/profile/me/socials', { method:'PUT', body:{instagram,tiktok,youtube} });
  if (_profileContentCache) _profileContentCache.socials = { instagram, tiktok, youtube };
  switchProfileTab('socials', false);
  toast('✅ Redes sociais salvas!');
}

function toggleBioEdit(btn) {
  const editing = btn.dataset.editing === 'true';
  if (editing) {
    cancelBioEdit();
  } else {
    btn.dataset.editing = 'true';
    btn.innerHTML = '<i class="ti ti-x"></i> Cancelar';
    document.getElementById('bio-display').style.display = 'none';
    document.getElementById('bio-edit').style.display = 'block';
    const ta = document.getElementById('bio-textarea');
    ta.oninput = () => {
      const c = document.getElementById('bio-chars');
      if (c) c.textContent = ta.value.length + '/300';
    };
    ta.focus();
    ta.selectionStart = ta.selectionEnd = ta.value.length;
  }
}

function cancelBioEdit() {
  const btn = document.querySelector('.profile-edit-btn');
  if (btn) { btn.dataset.editing = 'false'; btn.innerHTML = '<i class="ti ti-pencil"></i> Editar'; }
  const d = document.getElementById('bio-display');
  const e = document.getElementById('bio-edit');
  if (d) d.style.display = '';
  if (e) e.style.display = 'none';
}

function toggleRolePick(btn) {
  const picker = document.getElementById('role-picker');
  const selected = picker.querySelectorAll('.role-pick-btn.selected');
  if (btn.classList.contains('selected')) {
    btn.classList.remove('selected');
  } else {
    if (selected.length >= 2) { toast('⚠️ Máximo 2 rotas'); return; }
    btn.classList.add('selected');
  }
}

async function saveBio() {
  const bio          = document.getElementById('bio-textarea')?.value.trim() ?? '';
  const display_name = document.getElementById('displayname-input')?.value.trim() ?? '';

  // Coleta rotas selecionadas
  const roles = [...document.querySelectorAll('.role-pick-btn.selected')].map(b => b.dataset.role);

  // Coleta campeões selecionados (ignora slots vazios)
  const main_champions = [0,1,2]
    .map(i => document.getElementById('champ-slot-'+i)?.value || '')
    .filter(Boolean);

  try {
    const has_mic = document.getElementById('mic-toggle-btn')?.classList.contains('mic-on') ? 1 : 0;
    await api('/users/me', { method: 'PATCH', body: { bio, display_name, roles, main_champions, has_mic } });
    me.bio = bio;
    me.has_mic = has_mic;
    me.display_name = display_name || null;
    localStorage.setItem('duoq_me', JSON.stringify(me));
    toast('✅ Perfil atualizado!');
    loadMyProfile();
  } catch { toast('❌ Erro ao salvar'); }
}

// ── Página de Amigos ───────────────────────────
async function loadFriendsPage() {
  const list = $('friends-list-page');
  list.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';
  try {
    const friends = await api('/users/me/friends');
    if (!friends.length) {
      list.innerHTML = '<div class="empty"><i class="ti ti-users-off"></i><p>Você ainda não tem amigos. Explore e adicione jogadores!</p></div>';
      return;
    }
    list.innerHTML = `<div class="friends-grid">${friends.map(f => friendCardHTML(f)).join('')}</div>`;
  } catch { list.innerHTML = '<div class="empty"><p>Erro ao carregar</p></div>'; }
}

function friendCardHTML(f) {
  const col    = avatarColor(f.username || 'U');
  const px     = AV_SIZES['av-lg'] || 150;
  const letter = (f.display_name || f.username || 'U')[0].toUpperCase();
  const online = f.online_status === 'online';
  const eloSolo = eloLabel(f.solo_tier, f.solo_rank, f.solo_lp || 0);
  const eloFlex = eloLabel(f.flex_tier, f.flex_rank, f.flex_lp || 0);

  const avatarEl = f.avatar_url
    ? `<img src="${f.avatar_url}" style="width:${px}px;height:${px}px;border-radius:50%;object-fit:cover;cursor:pointer" onclick="viewProfile(${f.id})" alt="">`
    : `<div class="av av-lg" style="width:${px}px;height:${px}px;background:${col};color:#0E0E12;cursor:pointer" onclick="viewProfile(${f.id})">${letter}<div class="status-dot ${online ? 'dot-online' : 'dot-offline'}"></div></div>`;

  return `
  <div class="friend-card" id="fcard-${f.id}">
    <div class="friend-card-av">${avatarEl}</div>
    <div class="friend-card-info">
      <div class="friend-card-name" onclick="viewProfile(${f.id})">${escapeHtml(f.display_name || f.username)}</div>
      <div class="friend-card-nick">${escapeHtml(f.lol_game_name)}#${escapeHtml(f.lol_tag_line)}</div>
      <div class="friend-card-elos">
        <span class="elo ${eloClass(f.solo_tier)}">Solo ${eloSolo}</span>
        <span class="elo ${eloClass(f.flex_tier)}">Flex ${eloFlex}</span>
      </div>
      <div class="friend-card-status ${online ? 'fc-online' : 'fc-offline'}">
        <span class="fc-dot"></span>${online ? 'Online' : 'Offline'}
      </div>
    </div>
    <div class="friend-card-actions">
      <button class="fc-btn fc-btn-blue" onclick="openDM(${f.id},'${escapeHtml(f.display_name||f.username)}')">
        <i class="ti ti-message-2"></i> Mensagem
      </button>
      <button class="fc-btn" onclick="viewProfile(${f.id})">
        <i class="ti ti-user"></i> Perfil
      </button>
      <button class="fc-btn fc-btn-warn" onclick="confirmUnfriend(${f.id},'${escapeHtml(f.display_name||f.username)}')">
        <i class="ti ti-user-minus"></i> Desfazer
      </button>
      <button class="fc-btn fc-btn-red" onclick="confirmBlockUser(${f.id},'${escapeHtml(f.display_name||f.username)}')">
        <i class="ti ti-ban"></i> Bloquear
      </button>
    </div>
  </div>`;
}

async function confirmUnfriend(userId, name) {
  if (!confirm(`Desfazer amizade com ${name}?`)) return;
  try {
    await api(`/users/me/friends/${userId}`, { method: 'DELETE' });
    $('fcard-' + userId)?.remove();
    toast('✅ Amizade desfeita');
    loadFriends(); // atualiza sidebar
    if (!document.querySelector('.friend-card')) {
      $('friends-list-page').innerHTML = '<div class="empty"><i class="ti ti-users-off"></i><p>Você ainda não tem amigos.</p></div>';
    }
  } catch (err) { toast('❌ ' + (err.error || 'Erro')); }
}

async function confirmBlockUser(userId, name) {
  if (!confirm(`Bloquear ${name}? Isso também vai desfazer a amizade.`)) return;
  try {
    await api(`/users/me/block/${userId}`, { method: 'POST' });
    $('fcard-' + userId)?.remove();
    toast(`🚫 ${name} foi bloqueado`);
    loadFriends();
    // Atualiza botão no perfil se estiver aberto
    const btn = $('profile-block-btn-' + userId);
    if (btn) { btn.innerHTML = '<i class="ti ti-lock-open"></i> Desbloquear'; btn.onclick = () => unblockUser(userId, name); }
  } catch (err) { toast('❌ ' + (err.error || 'Erro')); }
}

async function unblockUser(userId, name) {
  try {
    await api(`/users/me/block/${userId}`, { method: 'DELETE' });
    toast(`✅ ${name} foi desbloqueado`);
    const btn = $('profile-block-btn-' + userId);
    if (btn) { btn.innerHTML = '<i class="ti ti-ban"></i> Bloquear'; btn.onclick = () => confirmBlockUser(userId, name); }
  } catch (err) { toast('❌ ' + (err.error || 'Erro')); }
}

// ── Friends sidebar ────────────────────────────
async function loadFriends() {
  try {
    const friends = await api('/users/me/friends');
    const onlineList  = $('friends-online');
    const offlineList = $('friends-offline');
    const noFriends   = $('s-no-friends');
    const offSection  = $('s-offline-section');
    const badge       = $('friends-online-badge');
    if (!onlineList) return;

    onlineList.innerHTML = '';
    offlineList.innerHTML = '';

    if (!friends.length) {
      if (noFriends) noFriends.style.display = '';
      if (offSection) offSection.style.display = 'none';
      return;
    }
    if (noFriends) noFriends.style.display = 'none';

    const online  = friends.filter(f => f.online_status === 'online' || f.online_status === 'away');
    const offline = friends.filter(f => f.online_status === 'offline' || !f.online_status);

    // Badge com contagem de online
    if (badge) {
      badge.textContent = online.length;
      badge.style.display = online.length > 0 ? '' : 'none';
    }

    // Renderizar online
    if (online.length) {
      onlineList.innerHTML = online.map(f => friendSidebarItemHTML(f)).join('');
    } else {
      onlineList.innerHTML = '<div style="font-size:11px;color:var(--dim);padding:3px 4px">Nenhum amigo online</div>';
    }

    // Renderizar offline
    if (offSection) offSection.style.display = offline.length ? '' : 'none';
    if (offline.length) {
      offlineList.innerHTML = offline.map(f => friendSidebarItemHTML(f)).join('');
    }

    // Adicionar eventos
    document.querySelectorAll('.friend-sidebar-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.id);
        const action = el.dataset.action;
        if (action === 'profile') viewProfile(id);
        else openDM(id, el.dataset.name);
      });
    });
  } catch {}
}

function friendSidebarItemHTML(f) {
  const name = escapeHtml(f.display_name || f.username);
  const nick = escapeHtml(f.lol_game_name) + '#' + escapeHtml(f.lol_tag_line);
  return `<div class="friend-row friend-sidebar-item" id="friend-${f.id}"
               data-id="${f.id}" data-name="${escapeHtml(f.username)}" data-action="profile"
               title="${nick}">
    ${avatarHTML(f, 'av-sm')}
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
      <div style="font-size:10.5px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nick}</div>
    </div>
    <button class="friend-dm-btn" title="Abrir chat"
            onclick="event.stopPropagation();openDM(${f.id},'${escapeHtml(f.username)}')"
            style="background:none;border:none;cursor:pointer;color:var(--dim);font-size:14px;padding:2px 4px;border-radius:5px;flex-shrink:0">
      <i class="ti ti-message-2"></i>
    </button>
  </div>`;
}


function toggleMicEdit(btn) {
  const isOn = btn.classList.toggle('mic-on');
  const icon  = btn.querySelector('i');
  const label = btn.querySelector('span');
  icon.className = isOn ? 'ti ti-microphone' : 'ti ti-microphone-off';
  btn.title      = isOn ? 'Microfone ativo — clique para desativar' : 'Sem microfone — clique para ativar';
  if (btn.querySelector('span')) btn.querySelector('span').textContent = isOn ? 'Tenho microfone' : 'Sem microfone';
}

async function toggleMicSave(btn) {
  const isOn = btn.classList.toggle('mic-on');
  const icon  = btn.querySelector('i');
  const label = btn.querySelector('span');
  icon.className = isOn ? 'ti ti-microphone' : 'ti ti-microphone-off';
  btn.title      = isOn ? 'Microfone ativo — clique para desativar' : 'Sem microfone — clique para ativar';
  if (btn.querySelector('span')) btn.querySelector('span').textContent = isOn ? 'Tenho microfone' : 'Sem microfone';
  try {
    await api('/users/me', { method: 'PATCH', body: { has_mic: isOn ? 1 : 0 } });
    me.has_mic = isOn ? 1 : 0;
    localStorage.setItem('duoq_me', JSON.stringify(me));
    toast(isOn ? '🎙️ Microfone ativado!' : '🔇 Microfone desativado');
  } catch { toast('Erro ao salvar'); }
}
function toggleFriendsPanel() {
  const panel = $('s-friends-panel');
  if (panel) panel.classList.toggle('s-friends-body-collapsed');
}


// ── Right panel — Chat ao vivo ──────────────────
let rpConvCache = []; // cache local para updates em tempo real

async function loadRightPanelChats() {
  try {
    const convs = await api('/messages');
    rpConvCache = convs;
    renderRightPanelChats(convs);
  } catch {}
}

function renderRightPanelChats(convs) {
  const list = $('rp-conv-list');
  if (!list) return;

  const totalUnread = convs.reduce((sum, c) => sum + (parseInt(c.unread_count) || 0), 0);
  const badge = $('rp-unread-total');
  if (badge) { badge.textContent = totalUnread; badge.style.display = totalUnread > 0 ? '' : 'none'; }

  if (!convs.length) {
    list.innerHTML = '<div style="padding:20px 14px;text-align:center;color:var(--dim);font-size:13px">Nenhuma conversa ainda</div>';
    return;
  }

  list.innerHTML = convs.map(c => {
    const col = avatarColor(c.username || 'U');
    const letter = (c.display_name || c.username || 'U')[0].toUpperCase();
    const unread = parseInt(c.unread_count) || 0;
    const isOpen = currentConvId && currentConvId == c.id;
    return `
    <div class="rp-conv-item ${unread > 0 ? 'rp-conv-unread' : ''} ${isOpen ? 'rp-conv-active' : ''}"
         id="rp-conv-${c.id}"
         onclick="openConv(${c.id},${c.partner_id},'${escapeHtml(c.display_name || c.username)}')">
      <div class="rp-conv-av-wrap">
        <div class="av av-sm" style="width:36px;height:36px;font-size:14px;background:${col};color:#0E0E12">${letter}
          <div class="status-dot ${c.online_status === 'online' ? 'dot-online' : 'dot-offline'}"></div>
        </div>
        ${unread > 0 && !isOpen ? `<span class="rp-conv-badge">${unread}</span>` : ''}
      </div>
      <div class="rp-conv-info">
        <div class="rp-conv-name">${escapeHtml(c.display_name || c.username)}</div>
        <div class="rp-conv-last">${escapeHtml(c.last_message || '...')}</div>
      </div>
    </div>`;
  }).join('');
}

// Atualiza um item do painel sem recarregar tudo
function rpUpdateConv(msg) {
  const idx = rpConvCache.findIndex(c => c.id == msg.conversation_id);
  const isFromMe = msg.sender_id == me?.id;

  if (idx >= 0) {
    rpConvCache[idx].last_message = msg.content;
    if (!isFromMe && currentConvId != msg.conversation_id) {
      rpConvCache[idx].unread_count = (parseInt(rpConvCache[idx].unread_count) || 0) + 1;
    }
    // Move para o topo
    const [conv] = rpConvCache.splice(idx, 1);
    rpConvCache.unshift(conv);
  }
  renderRightPanelChats(rpConvCache);
}

function updateFriendStatus(userId, status) {
  const el = $('friend-' + userId);
  if (!el) return;
  const dot = el.querySelector('.status-dot');
  if (dot) dot.className = 'status-dot dot-' + status;
  // Recarregar lista para mover entre online/offline
  loadFriends();
}

async function addFriend(userId, btn) {
  try {
    await api('/users/me/friend-request', { method:'POST', body:{ receiver_id: userId } });
    btn.innerHTML = '<i class="ti ti-check"></i> <span>Enviado</span>';
    btn.style.color = 'var(--green)';
    toast('✅ Solicitação enviada!');
  } catch (err) { toast(err.error || 'Erro ao adicionar'); }
}

// ── Sidebar ranks (agora no sidebar esquerdo) ──
function renderSidebarRanks() {
  if (!me) return;
  const soloLabel = eloLabel(me.solo_tier, me.solo_rank, me.solo_lp);
  const flexLabel = eloLabel(me.flex_tier, me.flex_rank, me.flex_lp);
  const sv = $('s-solo-val');
  const fv = $('s-flex-val');
  if (sv) sv.textContent = soloLabel;
  if (fv) fv.textContent = flexLabel;
}

// ── Avatar upload ──────────────────────────────
function triggerAvatarUpload() {
  let inp = document.getElementById('avatar-file-input');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file';
    inp.id = 'avatar-file-input';
    inp.accept = 'image/jpeg,image/png,image/webp,image/gif';
    inp.style.display = 'none';
    inp.onchange = uploadAvatar;
    document.body.appendChild(inp);
  }
  inp.value = '';
  inp.click();
}

// Comprime e redimensiona a imagem no cliente (max 300x300, jpeg 0.82)
// Resultado: base64 ~30-60KB — persiste no banco, nunca some em redeploy
function compressImage(file, maxPx = 300, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function uploadAvatar() {
  const inp = document.getElementById('avatar-file-input');
  if (!inp?.files?.length) return;
  const file = inp.files[0];
  if (file.size > 10 * 1024 * 1024) { toast('Imagem muito grande. Máximo 10MB.'); return; }

  toast('⏳ Processando foto...');
  try {
    const image = await compressImage(file);
    const data  = await api('/users/me/avatar', { method: 'POST', body: { image } });

    me.avatar_url = data.avatar_url;
    localStorage.setItem('duoq_me', JSON.stringify(me));
    toast('✅ Foto atualizada!');
    loadMyProfile();
  } catch (err) {
    toast('❌ ' + (err.error || 'Erro ao enviar foto'));
  }
}

// ── Sync Elo ───────────────────────────────────
async function syncElo() {
  toast('⏳ Sincronizando com a Riot API...');
  try {
    const res = await api('/users/me/sync-elo', { method:'POST' });
    if (res.warning) { toast('⚠️ ' + res.warning, 5000); return; }
    toast('✅ Elo atualizado!');
    loadMyProfile();
  } catch (err) { toast('❌ ' + (err.error || 'Erro ao sincronizar')); }
}

// ── Online count ───────────────────────────────
async function pollOnlineCount() {
  try {
    const { count } = await api('/users/stats/online');
    const el = $('online-count');
    if (el) el.textContent = count;
  } catch {}
}

// ── Report modal ───────────────────────────────
const REPORT_REASONS = [
  'Spam ou propaganda',
  'Conteúdo ofensivo ou hate speech',
  'Assédio ou bullying',
  'Informações falsas',
  'Conteúdo inapropriado',
  'Outro',
];

let _reportPostId = null;
let _reportAuthorId = null;

function openReportModal(postId, authorId) {
  _reportPostId   = postId;
  _reportAuthorId = authorId;
  const modal = $('report-modal');
  const box   = $('report-reasons');
  $('report-details').value = '';
  box.innerHTML = REPORT_REASONS.map((r, i) => `
    <label class="report-reason-opt">
      <input type="radio" name="report-reason" value="${r}" ${i===0?'checked':''}>
      <span>${r}</span>
    </label>`).join('');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeReportModal() {
  $('report-modal').style.display = 'none';
  document.body.style.overflow = '';
  _reportPostId = _reportAuthorId = null;
}

async function submitReport() {
  const reason  = document.querySelector('input[name="report-reason"]:checked')?.value;
  const details = $('report-details').value.trim();
  if (!reason || !_reportPostId) return;
  try {
    await api(`/posts/${_reportPostId}/report`, { method:'POST', body:{ reason, details } });
    toast('✅ Denúncia enviada para moderação!');
    closeReportModal();
  } catch (err) { toast('❌ ' + (err.error || 'Erro ao denunciar')); }
}

// Fecha dropdown ao clicar fora
document.addEventListener('click', e => {
  if (!e.target.closest('.post-menu')) {
    document.querySelectorAll('.post-dropdown').forEach(d => d.style.display = 'none');
  }
});

function togglePostMenu(postId, authorId) {
  // Fecha todos os outros
  document.querySelectorAll('.post-dropdown').forEach(d => {
    if (d.id !== 'pd-' + postId) d.style.display = 'none';
  });
  const dd = $('pd-' + postId);
  if (!dd) return;
  dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
}

// ── Admin panel ────────────────────────────────
function bootAdmin() {
  const btn = $('nav-admin');
  if (btn) btn.style.display = me?.admin_role === 'admin' ? '' : 'none';
}

async function adminSearch() {
  const q    = $('admin-search')?.value.trim() || '';
  const list = $('admin-user-list');
  list.innerHTML = '<div class="loading"><div class="spinner"></div> Buscando...</div>';
  try {
    const users = await api('/admin/users?q=' + encodeURIComponent(q));
    if (!users.length) {
      list.innerHTML = '<div class="empty"><i class="ti ti-users-off"></i><p>Nenhum usuário encontrado</p></div>';
      return;
    }
    list.innerHTML = users.map(u => adminUserCard(u)).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty"><i class="ti ti-alert-circle"></i><p>${err.error || 'Erro ao buscar'}</p></div>`;
  }
}

function adminUserCard(u) {
  const restricted = u.post_restricted_until && new Date(u.post_restricted_until) > new Date();
  const restrictedUntil = restricted
    ? new Date(u.post_restricted_until).toLocaleString('pt-BR')
    : null;

  return `
  <div class="admin-card" id="admin-card-${u.id}">
    <div class="admin-card-head">
      <div class="av av-md" style="background:${avatarColor(u.username)};color:#0E0E12;flex-shrink:0">${(u.display_name||u.username||'?')[0].toUpperCase()}</div>
      <div class="admin-card-info">
        <div class="admin-card-name">${escapeHtml(u.display_name || u.username)}
          ${u.admin_role === 'admin' ? '<span class="admin-badge">ADMIN</span>' : ''}
          ${u.is_banned ? '<span class="banned-badge">BANIDO</span>' : ''}
          ${restricted ? `<span class="restrict-badge">RESTRITO até ${restrictedUntil}</span>` : ''}
        </div>
        <div class="admin-card-sub">${escapeHtml(u.lol_game_name)}#${escapeHtml(u.lol_tag_line)} · <span style="color:var(--dim)">${escapeHtml(u.email)}</span></div>
        <div class="admin-card-sub" style="color:var(--dim);font-size:11px">@${escapeHtml(u.username)} · ID #${u.id}</div>
      </div>
    </div>

    <div class="admin-actions">

      <div class="admin-action-group">
        <div class="admin-group-label">Mudar senha</div>
        <div style="display:flex;gap:6px">
          <input class="form-input" id="pwd-${u.id}" type="password" placeholder="Nova senha (mín. 6)" style="flex:1;padding:8px 10px;font-size:12px">
          <button class="admin-btn admin-btn-gold" onclick="adminChangePassword(${u.id})">Salvar</button>
        </div>
      </div>

      <div class="admin-action-group">
        <div class="admin-group-label">Mudar nick do LoL</div>
        <div style="display:flex;gap:6px;align-items:center">
          <input class="form-input" id="nick-${u.id}" type="text" value="${escapeHtml(u.lol_game_name)}" placeholder="Nome" style="flex:1;padding:8px 10px;font-size:12px">
          <span style="color:var(--dim);font-weight:700">#</span>
          <input class="form-input" id="tag-${u.id}" type="text" value="${escapeHtml(u.lol_tag_line)}" placeholder="TAG" style="width:72px;padding:8px 10px;font-size:12px">
          <button class="admin-btn admin-btn-gold" onclick="adminChangeNick(${u.id})">Salvar</button>
        </div>
      </div>

      <div class="admin-action-group">
        <div class="admin-group-label">Impedir de postar</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="admin-btn admin-btn-warn" onclick="adminRestrict(${u.id},1)">1h</button>
          <button class="admin-btn admin-btn-warn" onclick="adminRestrict(${u.id},6)">6h</button>
          <button class="admin-btn admin-btn-warn" onclick="adminRestrict(${u.id},24)">24h</button>
          <button class="admin-btn admin-btn-warn" onclick="adminRestrict(${u.id},72)">3 dias</button>
          <button class="admin-btn admin-btn-warn" onclick="adminRestrict(${u.id},168)">7 dias</button>
          ${restricted ? `<button class="admin-btn admin-btn-green" onclick="adminRestrict(${u.id},0)">Remover restrição</button>` : ''}
        </div>
      </div>

      <div class="admin-action-group">
        <div class="admin-group-label">Ações de conta</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${u.is_banned
            ? `<button class="admin-btn admin-btn-green" onclick="adminBan(${u.id},false)"><i class="ti ti-user-check"></i> Desbanir</button>`
            : `<button class="admin-btn admin-btn-red" onclick="adminBan(${u.id},true)"><i class="ti ti-ban"></i> Banir</button>`}
          ${u.admin_role === 'admin'
            ? `<button class="admin-btn admin-btn-warn" onclick="adminSetRole(${u.id},'user')"><i class="ti ti-arrow-down"></i> Remover admin</button>`
            : `<button class="admin-btn admin-btn-blue" onclick="adminSetRole(${u.id},'admin')"><i class="ti ti-shield"></i> Tornar admin</button>`}
        </div>
      </div>

    </div>
  </div>`;
}

async function adminChangePassword(userId) {
  const pwd = $('pwd-' + userId)?.value;
  if (!pwd || pwd.length < 6) { toast('Senha deve ter pelo menos 6 caracteres'); return; }
  try {
    await api('/admin/users/' + userId + '/password', { method: 'PATCH', body: { password: pwd } });
    $('pwd-' + userId).value = '';
    toast('✅ Senha alterada!');
  } catch (err) { toast('❌ ' + (err.error || 'Erro')); }
}

async function adminChangeNick(userId) {
  const name = $('nick-' + userId)?.value.trim();
  const tag  = $('tag-' + userId)?.value.trim();
  if (!name || !tag) { toast('Preencha nome e tag'); return; }
  try {
    await api('/admin/users/' + userId + '/nick', { method: 'PATCH', body: { lol_game_name: name, lol_tag_line: tag } });
    toast('✅ Nick atualizado!');
  } catch (err) { toast('❌ ' + (err.error || 'Erro')); }
}

async function adminBan(userId, ban) {
  try {
    await api('/admin/users/' + userId + '/ban', { method: 'PATCH', body: { banned: ban } });
    toast(ban ? '🔨 Usuário banido' : '✅ Usuário desbanido');
    adminSearch();
  } catch (err) { toast('❌ ' + (err.error || 'Erro')); }
}

async function adminRestrict(userId, hours) {
  try {
    await api('/admin/users/' + userId + '/restrict', { method: 'PATCH', body: { hours } });
    toast(hours === 0 ? '✅ Restrição removida' : `⏳ Usuário impedido de postar por ${hours}h`);
    adminSearch();
  } catch (err) { toast('❌ ' + (err.error || 'Erro')); }
}

async function adminDeletePost(postId) {
  if (!confirm('Deletar este post?')) return;
  try {
    await api('/admin/posts/' + postId, { method: 'DELETE' });
    const el = $('post-' + postId);
    if (el) el.remove();
    toast('🗑️ Post deletado');
    // Fecha o dropdown
    const dd = $('pd-' + postId);
    if (dd) dd.style.display = 'none';
  } catch (err) { toast('❌ ' + (err.error || 'Erro')); }
}

function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  $('atab-' + tab)?.classList.add('active');
  $('admin-tab-users').style.display  = tab === 'users'   ? 'flex' : 'none';
  $('admin-tab-reports').style.display = tab === 'reports' ? 'flex' : 'none';
  if (tab === 'reports') loadAdminReports();
}

async function loadAdminReports() {
  const list = $('admin-reports-list');
  list.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando denúncias...</div>';
  try {
    const reports = await api('/admin/reports');
    const badge = $('reports-badge');
    if (badge) { badge.textContent = reports.length; badge.style.display = reports.length ? '' : 'none'; }
    if (!reports.length) {
      list.innerHTML = '<div class="empty"><i class="ti ti-checks"></i><p>Nenhuma denúncia pendente</p></div>';
      return;
    }
    list.innerHTML = reports.map(r => `
      <div class="admin-report-card" id="report-card-${r.id}">
        <div class="report-card-head">
          <span class="report-reason-tag">${escapeHtml(r.reason)}</span>
          <span style="font-size:11px;color:var(--dim);margin-left:auto">${timeAgo(r.created_at)}</span>
        </div>
        <div class="report-post-content">${escapeHtml(r.post_content)}</div>
        ${r.details ? `<div class="report-details-text"><i class="ti ti-message"></i> "${escapeHtml(r.details)}"</div>` : ''}
        <div class="report-meta">
          <span>Autor: <strong>${escapeHtml(r.author_name || r.author_username)}</strong> (${escapeHtml(r.lol_game_name)}#${escapeHtml(r.lol_tag_line)})</span>
          <span style="color:var(--dim)">Denunciado por: ${escapeHtml(r.reporter_name || r.reporter_username)}</span>
        </div>
        <div class="report-actions-row">
          ${r.is_deleted ? '<span style="color:var(--dim);font-size:12px">Post já deletado</span>' :
            `<button class="admin-btn admin-btn-red" onclick="reportDeletePost(${r.post_id},${r.id})"><i class="ti ti-trash"></i> Deletar post</button>`}
          <button class="admin-btn admin-btn-warn" onclick="adminRestrict(${r.author_id},24).then(()=>dismissReport(${r.id}))"><i class="ti ti-clock"></i> Silenciar 24h</button>
          <button class="admin-btn admin-btn-red" onclick="adminBan(${r.author_id},true).then(()=>dismissReport(${r.id}))"><i class="ti ti-ban"></i> Banir</button>
          <button class="admin-btn admin-btn-green" onclick="dismissReport(${r.id})"><i class="ti ti-x"></i> Dispensar</button>
        </div>
      </div>`).join('');
  } catch (err) {
    list.innerHTML = `<div class="empty"><i class="ti ti-alert-circle"></i><p>${err.error || 'Erro ao carregar'}</p></div>`;
  }
}

async function reportDeletePost(postId, reportId) {
  try {
    await api('/admin/posts/' + postId, { method: 'DELETE' });
    await dismissReport(reportId);
    toast('🗑️ Post deletado');
  } catch (err) { toast('❌ ' + (err.error || 'Erro')); }
}

async function dismissReport(reportId) {
  try {
    await api('/admin/reports/' + reportId + '/dismiss', { method: 'PATCH' });
    $('report-card-' + reportId)?.remove();
    const remaining = document.querySelectorAll('[id^="report-card-"]').length;
    const badge = $('reports-badge');
    if (badge) { badge.textContent = remaining; badge.style.display = remaining ? '' : 'none'; }
    if (!remaining) $('admin-reports-list').innerHTML = '<div class="empty"><i class="ti ti-checks"></i><p>Nenhuma denúncia pendente</p></div>';
  } catch (err) { toast('❌ Erro ao dispensar'); }
}

async function adminSetRole(userId, role) {
  if (!confirm(role === 'admin' ? 'Tornar este usuário administrador?' : 'Remover permissões de admin?')) return;
  try {
    await api('/admin/users/' + userId + '/role', { method: 'PATCH', body: { role } });
    toast(role === 'admin' ? '✅ Admin concedido' : '✅ Admin removido');
    adminSearch();
  } catch (err) { toast('❌ ' + (err.error || 'Erro')); }
}

// ── Init ───────────────────────────────────────

// ── Pesquisa global de invocadores ────────────────────
let _searchTimer = null;

function openGlobalSearch() {
  const bar = $('global-search-bar');
  bar.classList.add('open');
  setTimeout(() => $('global-search-input').focus(), 50);
  $('global-search-clear').style.display = '';
}

function closeGlobalSearch() {
  const bar = $('global-search-bar');
  bar.classList.remove('open');
  $('global-search-input').value = '';
  $('global-search-results').innerHTML = '';
  $('global-search-clear').style.display = 'none';
}

function onGlobalSearch(q) {
  clearTimeout(_searchTimer);
  const results = $('global-search-results');
  if (!q.trim()) { results.innerHTML = ''; return; }
  results.innerHTML = '<div class="gs-empty"><div class="spinner" style="margin:0 auto"></div></div>';
  _searchTimer = setTimeout(() => runGlobalSearch(q), 350);
}

async function runGlobalSearch(q) {
  const results = $('global-search-results');
  try {
    const users = await api('/users?q=' + encodeURIComponent(q) + '&limit=8');
    if (!users.length) {
      results.innerHTML = '<div class="gs-empty">Nenhum invocador encontrado</div>';
      return;
    }
    results.innerHTML = users.map(u => `
      <div class="gs-result" onclick="closeGlobalSearch();viewProfile(${u.id})">
        ${avatarHTML(u, 'av-md')}
        <div class="gs-result-info">
          <div class="gs-result-name">${escapeHtml(u.display_name || u.username)}</div>
          <div class="gs-result-nick">${escapeHtml(u.lol_game_name)}#${escapeHtml(u.lol_tag_line)}</div>
          <div class="gs-result-elos">
            <span class="elo ${eloClass(u.solo_tier)}">Solo ${eloLabel(u.solo_tier, u.solo_rank, u.solo_lp)}</span>
            <span class="elo ${eloClass(u.flex_tier)}">Flex ${eloLabel(u.flex_tier, u.flex_rank, u.flex_lp)}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center">
          <div class="status-dot ${u.online_status==='online'?'dot-online':u.online_status==='away'?'dot-away':'dot-offline'}" style="position:static;border:none;width:9px;height:9px"></div>
        </div>
      </div>`).join('');
  } catch {
    results.innerHTML = '<div class="gs-empty">Erro ao buscar</div>';
  }
}

// Fechar ao clicar fora
document.addEventListener('click', e => {
  const bar = $('global-search-bar');
  if (bar?.classList.contains('open') && !bar.contains(e.target) && e.target.id !== 'btn-open-search') {
    closeGlobalSearch();
  }
});


// ── Amigos na aba de Mensagens ─────────────────
async function loadFriendsInMessages() {
  const panel = $('friends-in-messages');
  if (!panel) return;
  try {
    const friends = await api('/users/me/friends');
    panel.style.display = '';

    const online  = friends.filter(f => f.online_status === 'online' || f.online_status === 'away');
    const offline = friends.filter(f => f.online_status !== 'online' && f.online_status !== 'away');

    panel.innerHTML = `
      <div class="social-panel">
        <div class="social-panel-title">
          <i class="ti ti-users"></i> Amigos
          <span class="social-online-count">${online.length} online</span>
        </div>

        ${online.length ? `
        <div class="social-section-label">
          <span class="social-dot online"></span> Online
        </div>
        <div class="social-friends-list">
          ${online.map(f => socialFriendHTML(f)).join('')}
        </div>` : ''}

        <div class="social-section-label" style="margin-top:${online.length ? 12 : 0}px">
          <span class="social-dot offline"></span> Offline
        </div>
        <div class="social-friends-list">
          ${offline.length
            ? offline.map(f => socialFriendHTML(f)).join('')
            : '<div class="social-empty">Nenhum amigo offline</div>'}
        </div>

        ${!friends.length ? '<div class="social-empty" style="margin-top:16px">Você ainda não tem amigos. Explore e adicione jogadores!</div>' : ''}
      </div>

      <div class="social-divider">
        <i class="ti ti-message-2"></i> Conversas
      </div>`;
  } catch {
    const panel = $('friends-in-messages');
    if (panel) panel.innerHTML = '';
  }
}

function socialFriendHTML(f) {
  const name    = escapeHtml(f.display_name || f.username);
  const nick    = escapeHtml(f.lol_game_name) + '#' + escapeHtml(f.lol_tag_line);
  const isAway  = f.online_status === 'away';
  const isOnline= f.online_status === 'online';
  const dotCls  = isOnline ? 'dot-online' : isAway ? 'dot-away' : 'dot-offline';
  const statusText = isOnline ? 'Online' : isAway ? 'Ausente' : 'Offline';

  return `<div class="social-friend-item" onclick="viewProfile(${f.id})" title="Ver perfil de ${name}">
    <div class="social-friend-av" style="position:relative;flex-shrink:0">
      ${avatarHTML(f, 'av-md')}
    </div>
    <div class="social-friend-info">
      <div class="social-friend-name">${name}</div>
      <div class="social-friend-status">
        <span class="social-dot-sm ${dotCls}"></span>
        ${statusText}
      </div>
    </div>
    <button class="social-chat-btn"
            onclick="event.stopPropagation();openDM(${f.id},'${escapeHtml(f.username)}')"
            title="Abrir conversa">
      <i class="ti ti-message-circle"></i>
    </button>
  </div>`;
}


// ══════════════════════════════════════════════
//  FILA AO VIVO
// ══════════════════════════════════════════════
let _inQueue       = false;
let _queueType     = 'SOLO';
let _queueFilter   = 'all';
let _queuePlayers  = [];   // lista atual visível
let _allQueuePlayers = []; // todos sem filtro
let _queueTimerInt = null;
let _queueJoinedAt = null;
let _queueMinimized = false;

// Som de notificação (novo jogador na fila)
function playQueueSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o   = ctx.createOscillator();
    const g   = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type      = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.1);
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start(); o.stop(ctx.currentTime + 0.4);
  } catch {}
}

// Abrir painel
function openQueuePanel() {
  $('queue-panel').classList.add('open');
  $('queue-overlay').classList.add('open');
  $('queue-fab').style.display = 'none';
  loadQueueList();
}

function closeQueuePanel() {
  $('queue-panel').classList.remove('open');
  $('queue-overlay').classList.remove('open');
  $('queue-fab').style.display = 'flex';
}

// Minimizar/expandir
function toggleQueueMinimize() {
  _queueMinimized = !_queueMinimized;
  const body = $('queue-body');
  const icon = $('queue-minimize-btn').querySelector('i');
  body.style.display    = _queueMinimized ? 'none' : '';
  icon.className        = _queueMinimized ? 'ti ti-chevron-up' : 'ti ti-minus';
}

// Filtro de fila
function setQueueFilter(q, btn) {
  _queueFilter = q;
  document.querySelectorAll('.queue-filter-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  renderQueueList();
}

// Entrar / sair da fila
async function toggleQueue() {
  if (_inQueue) {
    await leaveQueue();
  } else {
    await joinQueue();
  }
}

async function joinQueue() {
  const queueType = $('queue-type-select').value;
  try {
    const { user } = await api('/queue/join', { method:'POST', body:{ queue_type: queueType } });
    _inQueue      = true;
    _queueType    = queueType;
    _queueJoinedAt = new Date();

    // Atualizar UI
    const btn = $('queue-join-btn');
    btn.innerHTML = '<i class="ti ti-x"></i> Sair da Fila';
    btn.classList.add('leaving');
    $('queue-timer-bar').style.display = 'flex';
    $('queue-type-select').disabled = true;
    $('queue-fab').classList.add('in-queue');

    // Iniciar timer
    startQueueTimer();

    // Notificar via socket
    if (socket) socket.emit('queue_join', { queue_type: queueType });

    toast('🟢 Você entrou na fila de ' + queueTypeLabel(queueType) + '!');
    loadQueueList();
  } catch (err) {
    toast('Erro ao entrar na fila');
  }
}

async function leaveQueue() {
  try {
    await api('/queue/leave', { method:'DELETE' });
    _inQueue = false;

    const btn = $('queue-join-btn');
    btn.innerHTML = '<i class="ti ti-search"></i> Entrar na Fila';
    btn.classList.remove('leaving');
    $('queue-timer-bar').style.display = 'none';
    $('queue-type-select').disabled = false;
    $('queue-fab').classList.remove('in-queue');

    clearInterval(_queueTimerInt);
    _queueTimerInt = null;
    _queueJoinedAt = null;

    if (socket) socket.emit('queue_leave');

    toast('⬜ Você saiu da fila');
    loadQueueList();
  } catch {}
}

function startQueueTimer() {
  clearInterval(_queueTimerInt);
  _queueTimerInt = setInterval(() => {
    if (!_queueJoinedAt) return;
    const secs  = Math.floor((Date.now() - _queueJoinedAt) / 1000);
    const mm    = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss    = String(secs % 60).padStart(2, '0');
    const timer = $('queue-timer');
    if (timer) timer.textContent = mm + ':' + ss;

    // Auto-sair após 30 min
    if (secs >= 1800) leaveQueue();
  }, 1000);
}

function queueTypeLabel(q) {
  const m = { SOLO:'Solo/Duo', FLEX:'Flex', ARAM:'ARAM', ARENA:'Arena' };
  return m[q] || q;
}

// Carregar lista da fila via API
async function loadQueueList() {
  try {
    const players = await api('/queue');
    _allQueuePlayers = players;
    // Atualizar badge do FAB
    const badge = $('queue-fab-badge');
    if (badge) {
      badge.textContent = players.length;
      badge.style.display = players.length > 0 ? '' : 'none';
    }
    updateQueueCount(players.length);
    renderQueueList();
  } catch {}
}

function updateQueueCount(n) {
  const el = $('queue-count');
  if (el) el.textContent = n;
}

function renderQueueList() {
  const list = $('queue-list');
  if (!list) return;

  const filtered = _queueFilter === 'all'
    ? _allQueuePlayers
    : _allQueuePlayers.filter(p => p.queue_type === _queueFilter);

  if (!filtered.length) {
    list.innerHTML = '<div class="queue-empty">Nenhum jogador nesta fila agora<br><span style="font-size:11px;margin-top:4px;display:block">Seja o primeiro! 🎮</span></div>';
    return;
  }

  list.innerHTML = filtered.map(p => queuePlayerCardHTML(p)).join('');
}

function queuePlayerCardHTML(p) {
  const isMe    = p.id == me?.id;
  const name    = escapeHtml(p.display_name || p.username);
  const nick    = escapeHtml(p.lol_game_name) + '#' + escapeHtml(p.lol_tag_line);
  const soloLbl = eloLabel(p.solo_tier, p.solo_rank, p.solo_lp);
  const flexLbl = eloLabel(p.flex_tier, p.flex_rank, p.flex_lp);
  const roles   = p.roles ? p.roles.split(',').filter(Boolean) : [];
  const qtBadge = p.queue_type?.toLowerCase();

  return `<div class="queue-player-card ${isMe ? 'is-me' : ''}" onclick="viewProfile(${p.id})">
    ${avatarHTML(p, 'av-md')}
    <div class="queue-player-info">
      <div class="queue-player-name">
        ${name}
        ${p.has_mic ? '<i class="ti ti-microphone queue-mic-icon" title="Tem microfone"></i>' : ''}
      </div>
      <div class="queue-player-nick">${nick}</div>
      <div class="queue-player-elos">
        <span class="elo ${eloClass(p.solo_tier)}">Solo ${soloLbl}</span>
        <span class="elo ${eloClass(p.flex_tier)}">Flex ${flexLbl}</span>
        <span class="queue-type-badge ${qtBadge}">${queueTypeLabel(p.queue_type)}</span>
      </div>
      ${roles.length ? `<div class="queue-player-roles">${roles.map(r => `<span class="queue-role-chip">${r}</span>`).join('')}</div>` : ''}
    </div>
    ${!isMe ? `<div class="queue-player-actions" onclick="event.stopPropagation()">
      <div class="queue-add-btn" onclick="addFriend(${p.id},this)" title="Adicionar amigo"><i class="ti ti-user-plus"></i></div>
      <div class="queue-dm-btn"  onclick="openDM(${p.id},'${escapeHtml(p.username)}')" title="Enviar mensagem"><i class="ti ti-message-2"></i></div>
    </div>` : `<div style="font-size:10px;color:var(--gold-l);font-weight:700;text-align:center;padding:2px 4px">VOCÊ</div>`}
  </div>`;
}

// Receber atualizações da fila via socket
function onQueueUpdate({ action, user, user_id }) {
  if (action === 'join') {
    // Remover se já estava (reconexão)
    _allQueuePlayers = _allQueuePlayers.filter(p => p.id !== user.id);
    _allQueuePlayers.push(user);
    updateQueueCount(_allQueuePlayers.length);
    renderQueueList();
    // Som e badge
    const badge = $('queue-fab-badge');
    if (badge) { badge.textContent = _allQueuePlayers.length; badge.style.display = ''; }
    // Tocar som só se não for eu
    if (user.id !== me?.id) {
      playQueueSound();
      // Toast discreto
      if (!$('queue-panel')?.classList.contains('open')) {
        toast(`🎮 ${user.display_name || user.username} entrou na fila de ${queueTypeLabel(user.queue_type)}!`);
      }
    }
  } else if (action === 'leave') {
    _allQueuePlayers = _allQueuePlayers.filter(p => p.id !== user_id);
    updateQueueCount(_allQueuePlayers.length);
    renderQueueList();
    const badge = $('queue-fab-badge');
    if (badge) {
      badge.textContent = _allQueuePlayers.length;
      badge.style.display = _allQueuePlayers.length > 0 ? '' : 'none';
    }
  }
}

// Verificar se usuário já está na fila ao carregar
async function checkQueueStatus() {
  try {
    const entry = await api('/queue/me');
    if (entry) {
      _inQueue       = true;
      _queueType     = entry.queue_type;
      _queueJoinedAt = new Date(entry.joined_at);
      const btn = $('queue-join-btn');
      if (btn) { btn.innerHTML = '<i class="ti ti-x"></i> Sair da Fila'; btn.classList.add('leaving'); }
      const timerBar = $('queue-timer-bar');
      if (timerBar) timerBar.style.display = 'flex';
      const sel = $('queue-type-select');
      if (sel) { sel.value = entry.queue_type; sel.disabled = true; }
      $('queue-fab')?.classList.add('in-queue');
      startQueueTimer();
    }
  } catch {}
}


// ── Inicialização ─────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (token && me) {
    bootApp();
  } else {
    // Garante que a tela de auth aparece
    const authScreen = document.getElementById('auth-screen');
    const appScreen  = document.getElementById('app-screen');
    if (authScreen) authScreen.style.display = 'flex';
    if (appScreen)  appScreen.style.display  = 'none';
  }
});