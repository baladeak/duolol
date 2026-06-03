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
    // Token expirado
    if (err.error && err.error.includes('Token')) logout();
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
  socket.on('notification', onSocketNotif);
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
      ${avatarHTML(p, 'av-lg')}
      <div class="post-meta">
        <div class="post-top">
          <span class="post-name" onclick="viewProfile(${p.user_id})">${escapeHtml(p.lol_game_name)}<span class="post-tag">#${escapeHtml(p.lol_tag_line)}</span></span>
          <span class="post-nick">${escapeHtml(dName(p))}</span>
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
      <span class="tag ${p.queue_type==='FLEX' ? 'tag-flex on' : 'tag-solo on'}" style="cursor:default;pointer-events:none">
        ${p.queue_type==='FLEX' ? 'Flex' : p.queue_type==='BOTH' ? 'Solo + Flex' : 'Solo/Duo'}
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

  const bioContent = user.bio
    ? `<p class="profile-bio-text">${escapeHtml(user.bio)}</p>`
    : isMe
      ? `<p class="profile-bio-empty">Clique em editar para contar seu estilo de jogo, lane favorita e horários...</p>`
      : `<p class="profile-bio-empty">Este jogador ainda não escreveu uma bio.</p>`;

  $('profile-content').innerHTML = `
    <div class="profile-banner">
      <div class="profile-top">
        ${avatarEl}
        <div class="profile-info">
          <div class="profile-name">${escapeHtml(dName(user))}</div>
          <div class="profile-nick">${escapeHtml(user.lol_game_name)}#${escapeHtml(user.lol_tag_line)}</div>
          <div class="profile-elos">
            <span class="elo ${eloClass(user.solo_tier)}">Solo ${soloLabel}</span>
            <span class="elo ${eloClass(user.flex_tier)}">Flex ${flexLabel}</span>
          </div>
          <div class="profile-stats">
            <div class="pstat"><div class="pstat-num">${user.total_posts || 0}</div><div class="pstat-lbl">Posts</div></div>
            <div class="pstat"><div class="pstat-num">${user.total_friends || 0}</div><div class="pstat-lbl">Amigos</div></div>
            <div class="pstat"><div class="pstat-num">${user.total_likes_received || 0}</div><div class="pstat-lbl">Curtidas</div></div>
          </div>
        </div>
      </div>
      <div class="profile-actions">
        ${isMe
          ? `<button class="btn-outline" onclick="syncElo()"><i class="ti ti-refresh"></i> Sync Elo</button>
             <button class="btn-outline" onclick="logout()" style="border-color:rgba(239,68,68,.4);color:#FCA5A5"><i class="ti ti-logout"></i> Sair</button>`
          : `<button class="btn-outline" onclick="addFriendById(${user.id},'${escapeHtml(user.username)}',this)"><i class="ti ti-user-plus"></i> Adicionar</button>
             <button class="btn-outline" style="border-color:rgba(64,128,255,.4);color:#93C5FD" onclick="openDM(${user.id},'${escapeHtml(user.username)}')"><i class="ti ti-message-2"></i> DM</button>`}
      </div>
    </div>

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
          <div class="form-group" style="margin-bottom:12px">
            <label class="form-label" style="font-size:10px">Nome de exibição</label>
            <input id="displayname-input" class="form-input" type="text" maxlength="60"
              placeholder="Como você quer ser chamado no feed"
              value="${escapeHtml(user.display_name || '')}">
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

      ${user.roles?.length ? `
      <div class="profile-section">
        <div class="profile-section-head">
          <span class="profile-section-title"><i class="ti ti-sword"></i> Lanes</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${user.roles.map(r => `<span class="tag tag-solo on" style="cursor:default">${r.role}</span>`).join('')}
        </div>
      </div>` : ''}

    </div>`;
  renderSidebarRanks();
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

async function saveBio() {
  const bio = document.getElementById('bio-textarea')?.value.trim() ?? '';
  const display_name = document.getElementById('displayname-input')?.value.trim() ?? '';
  try {
    await api('/users/me', { method: 'PATCH', body: { bio, display_name } });
    me.bio = bio;
    me.display_name = display_name || null;
    localStorage.setItem('duoq_me', JSON.stringify(me));
    toast('✅ Perfil atualizado!');
    loadMyProfile();
  } catch { toast('❌ Erro ao salvar'); }
}

// ── Friends sidebar ────────────────────────────
async function loadFriends() {
  try {
    const friends = await api('/users/me/friends');
    const list    = $('friends-online');
    if (!list) return;
    list.innerHTML = '';
    if (!friends.length) {
      list.innerHTML = '<div style="font-size:11px;color:var(--dim);padding:4px">Sem amigos ainda</div>';
      return;
    }
    friends.forEach(f => {
      const div = document.createElement('div');
      div.className   = 'friend-row';
      div.id          = 'friend-' + f.id;
      div.onclick     = () => openDM(f.id, f.username);
      div.innerHTML   = `${avatarHTML(f, 'av-sm')}<span class="friend-name">${escapeHtml(f.username)}</span>`;
      list.appendChild(div);
    });
  } catch {}
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
window.addEventListener('DOMContentLoaded', () => {
  if (token && me) {
    bootApp();
  }
});