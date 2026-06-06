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

  // DUO_LIKE — mostrar popup especial com botão de ver preview
  if (notif.type === 'DUO_LIKE' && notif.actor_id) {
    showDuoLiveNotif(notif, 'DUO_LIKE');
    return;
  }
  // DUO_MATCH — match mútuo!
  if (notif.type === 'DUO_MATCH' && notif.actor_id) {
    showDuoLiveNotif(notif, 'DUO_MATCH');
    return;
  }

  const icons = {
    POST_LIKE:'❤️', POST_COMMENT:'💬', FRIEND_REQUEST:'👤',
    FRIEND_ACCEPTED:'✅', NEW_MESSAGE:'💬', ELO_UPDATE:'🏆'
  };
  toast((icons[notif.type] || '🔔') + ' Nova notificação');
}

function showDuoLiveNotif(notif, type) {
  // Remove notif anterior se existir
  const existing = document.getElementById('duo-live-notif');
  if (existing) existing.remove();

  const isMatch = type === 'DUO_MATCH';
  const name    = escapeHtml(notif.actor_display_name || notif.actor_username || 'Alguém');
  const avLetter= (notif.actor_display_name || notif.actor_username || '?')[0].toUpperCase();
  const avHTML  = notif.actor_avatar
    ? `<img src="${escapeHtml(notif.actor_avatar)}" style="width:42px;height:42px;border-radius:50%;object-fit:cover;flex-shrink:0">`
    : `<div style="width:42px;height:42px;border-radius:50%;background:var(--gold);color:var(--navy);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0">${avLetter}</div>`;

  const div = document.createElement('div');
  div.id = 'duo-live-notif';
  div.className = 'duo-live-notif' + (isMatch ? ' is-match' : '');
  div.innerHTML = `
    <div class="duo-live-notif-inner">
      ${avHTML}
      <div class="duo-live-notif-text">
        <div class="duo-live-notif-title">
          ${isMatch ? '💙 É um MATCH!' : '❤️ Novo like no Match Duo'}
        </div>
        <div class="duo-live-notif-sub">
          ${isMatch ? `Você e <strong>${name}</strong> se curtiram!` : `<strong>${name}</strong> curtiu você`}
        </div>
      </div>
      <button class="duo-live-notif-btn" onclick="document.getElementById('duo-live-notif').remove();openDuoPreview(${notif.actor_id},'${type}')">
        Ver perfil
      </button>
      <button onclick="this.parentElement.parentElement.remove()" class="duo-live-close"><i class="ti ti-x"></i></button>
    </div>`;

  document.body.appendChild(div);
  // Auto-remover após 12 segundos
  setTimeout(() => div.remove(), 12000);
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

  if (name === 'feed')          { loadFeed(true); initFeedScroll(); }
  if (name === 'explore')       loadExplore();
  if (name === 'friends')       loadFriendsPage();
  if (name === 'messages')      loadConversations();
  if (name === 'notifications') loadNotifications();
  if (name === 'profile')       loadMyProfile();
  if (name === 'groups')        loadGroupsPage();
  if (name === 'match')         loadMatchPage();
}

// ── Feed ───────────────────────────────────────
let feedLoading = false;

let feedPage    = 1;
let feedHasMore = true;
let feedObserver = null;

async function loadFeed(reset = true) {
  if (feedLoading) return;
  if (reset) { feedPage = 1; feedHasMore = true; }
  if (!feedHasMore) return;
  feedLoading = true;
  const c = $('feed-posts');
  if (reset) c.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';
  const sentinel = $('feed-sentinel');
  if (sentinel && !reset) sentinel.innerHTML = '<div class="load-more-spinner"><div class="spinner"></div> Carregando mais...</div>';
  try {
    const posts = await api(`/posts?queue=${currentFilter}&limit=50&page=${feedPage}`);
    if (reset) c.innerHTML = '';
    if (!posts.length && feedPage === 1) {
      c.innerHTML = '<div class="empty"><i class="ti ti-mood-empty"></i><p>Nenhum post aqui ainda. Seja o primeiro!</p></div>';
      feedHasMore = false;
    } else {
      posts.forEach(p => { const d = document.createElement('div'); d.innerHTML = postHTML(p); if (d.firstElementChild) c.appendChild(d.firstElementChild); });
      feedHasMore = posts.length === 50;
      feedPage++;
    }
  } catch (err) {
    console.error(err);
    if (feedPage === 1) c.innerHTML = '<div class="empty"><i class="ti ti-alert-circle"></i><p>Erro ao carregar posts</p></div>';
  } finally {
    feedLoading = false;
    if (sentinel) sentinel.innerHTML = feedHasMore ? '' : '<div style="text-align:center;padding:12px;font-size:12px;color:var(--dim)">Todos os posts carregados ✓</div>';
  }
}

function initFeedScroll() {
  if (feedObserver) feedObserver.disconnect();
  const sentinel = $('feed-sentinel');
  if (!sentinel) return;
  feedObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && feedHasMore && !feedLoading) loadFeed(false);
  }, { threshold: 0.1 });
  feedObserver.observe(sentinel);
}


function postHTML(p) {
  const isMe = p.user_id == me?.id;
  return `
  <div class="post-card" id="post-${p.id}">
    <div class="post-head">
      <div onclick="viewProfile(${p.user_id})" style="cursor:pointer;flex-shrink:0;align-self:flex-start" title="Ver perfil de ${escapeHtml(p.lol_game_name)}">${avatarHTML(p, 'av-xl')}</div>
      <div class="post-meta">
        <div class="post-top">
          <span class="post-name" onclick="viewProfile(${p.user_id})">${escapeHtml(p.lol_game_name)}<span class="post-tag">#${escapeHtml(p.lol_tag_line)}</span></span>
          <span class="post-nick">${escapeHtml(dName(p))}</span>
          ${p.has_mic ? '<span class="post-mic" title="Tem microfone"><i class="ti ti-microphone"></i></span>' : ''}
          ${p.custom_status ? `<span class="post-status-badge" title="${escapeHtml(p.custom_status)}"><i class="ti ti-message-circle" style="font-size:11px"></i> ${escapeHtml(p.custom_status)}</span>` : ''}
          ${p.online_status === 'online' ? '<span class="post-online"><i class="ti ti-circle-filled"></i> Online</span>' : ''}
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
        <div class="post-body">${escapeHtml(p.content)}</div>
        <div class="post-tag-row">
          <span class="tag ${
            p.queue_type==='FLEX'  ? 'tag-flex on'  :
            p.queue_type==='ARAM'  ? 'tag-aram on'  :
            p.queue_type==='ARENA' ? 'tag-arena on' :
            'tag-solo on'
          }" style="cursor:default;pointer-events:none">
            ${p.queue_type==='FLEX' ? 'Flex' : p.queue_type==='ARAM' ? 'ARAM' : p.queue_type==='ARENA' ? 'Arena' : p.queue_type==='BOTH' ? 'Solo + Flex' : 'Solo/Duo'}
          </span>
          <span class="post-time" style="margin-left:auto">${timeAgo(p.created_at)}</span>
        </div>
      </div>
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
  loadFeed(true);
  initFeedScroll();
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
    grid.innerHTML = '<div class="empty"><i class="ti ti-users-off"></i><p>Nenhum jogador encontrado</p></div>';
    return;
  }
  grid.innerHTML = users.map(u => explorePlayerHTML(u)).join('');
}

function explorePlayerHTML(u) {
  const roles  = (u.roles || '').split(',').filter(Boolean);
  let champs   = [];
  try { champs = u.main_champions ? JSON.parse(u.main_champions) : []; } catch {}
  if (!Array.isArray(champs)) champs = [];
  const isOnline = u.online_status === 'online';

  return `<div class="explore-player-row" onclick="viewProfile(${u.id})">
    <!-- Avatar -->
    <div style="position:relative;flex-shrink:0">
      ${avatarHTML(u, 'av-lg')}
      <span class="explore-status-dot ${isOnline ? 'online' : 'offline'}"></span>
    </div>

    <!-- Info principal -->
    <div class="explore-player-info">
      <div class="explore-player-top">
        <div>
          <div class="explore-player-name">
            ${escapeHtml(u.display_name || u.username)}
            ${u.has_mic ? '<i class="ti ti-microphone" style="color:var(--green);font-size:13px" title="Tem microfone"></i>' : ''}
            ${isOnline ? '<span class="post-online" style="font-size:11px"><i class="ti ti-circle-filled"></i> Online</span>' : ''}
          </div>
          <div class="explore-player-nick">${escapeHtml(u.lol_game_name)}#${escapeHtml(u.lol_tag_line)}</div>
        </div>
        <div class="explore-player-elos">
          <span class="elo ${eloClass(u.solo_tier)}">Solo ${eloLabel(u.solo_tier,u.solo_rank,u.solo_lp)}</span>
          <span class="elo ${eloClass(u.flex_tier)}">Flex ${eloLabel(u.flex_tier,u.flex_rank,u.flex_lp)}</span>
        </div>
      </div>

      <!-- Lanes -->
      ${roles.length ? `<div class="explore-player-lanes">
        ${roles.map(r => `<span class="tag tag-solo on" style="cursor:default;font-size:10.5px;padding:2px 9px">${r}</span>`).join('')}
      </div>` : ''}

      <!-- Campeões -->
      ${champs.length ? `<div class="explore-player-champs">
        ${champs.slice(0, 5).map(ch => {
          const k = champKey2(ch);
          return `<img src="https://ddragon.leagueoflegends.com/cdn/${_ddragonVersion}/img/champion/${k}.png"
                       class="explore-champ-icon" title="${escapeHtml(ch)}" loading="lazy"
                       onerror="this.style.display='none'">`;
        }).join('')}
      </div>` : ''}

      <!-- Bio -->
      ${u.bio ? `<div class="explore-player-bio">${escapeHtml(u.bio)}</div>` : ''}
    </div>

    <!-- Botões de ação -->
    <div class="explore-player-actions" onclick="event.stopPropagation()">
      <button class="duo-action-add" onclick="addFriend(${u.id},this)" title="Adicionar">
        <i class="ti ti-user-plus"></i>
      </button>
      <button class="duo-action-dm" onclick="openDM(${u.id},'${escapeHtml(u.username)}')" title="Mensagem">
        <i class="ti ti-message-2"></i>
      </button>
    </div>
  </div>`;
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
      <div class="conv-item ${c.unread_count > 0 ? 'unread' : ''}" onclick="openConv(${c.id},${c.partner_id},'${escapeHtml(c.display_name||c.username)}')">
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
    // Buscar dados do parceiro para mostrar nick correto
    let displayLabel = partnerName || '';
    try {
      const partner = await api('/users/' + partnerId);
      if (partner && partner.lol_game_name) {
        const nick = partner.lol_game_name + '#' + (partner.lol_tag_line || '');
        const name = partner.display_name || partner.username || '';
        displayLabel = name ? nick + '  ' + name : nick;
      }
    } catch {}
    openChatWindow(conversation_id, partnerId, displayLabel);
  } catch { toast('Erro ao abrir conversa'); }
}

async function openConv(convId, partnerId, partnerName) {
  let displayLabel = partnerName || '';
  try {
    const partner = await api('/users/' + partnerId);
    if (partner?.lol_game_name) {
      const nick = partner.lol_game_name + '#' + (partner.lol_tag_line || '');
      const name = partner.display_name || partner.username || '';
      displayLabel = name ? nick + '  ' + name : nick;
    }
  } catch {}
  openChatWindow(convId, partnerId, displayLabel);
}

function openChatWindow(convId, partnerId, partnerName) {
  currentConvId      = convId;
  currentChatPartner = { id: partnerId, name: partnerName };
  // Zera o unread no cache local e redesenha o painel
  const c = rpConvCache.find(c => c.id == convId);
  if (c) { c.unread_count = 0; renderRightPanelChats(rpConvCache); }
  // Mostrar nick#tag - nome da pessoa no header do chat
  $('chat-partner-name').textContent = partnerName;
  // Mostrar status no chat se disponível
  const statusEl = $('chat-partner-status');
  if (statusEl) statusEl.style.display = 'none';
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
    NEW_MESSAGE:'ti-message', DUO_INVITE:'ti-sword', ELO_UPDATE:'ti-trophy',
    DUO_LIKE:'ti-heart-handshake', DUO_MATCH:'ti-hearts', SYSTEM:'ti-info-circle'
  };
  const texts = {
    POST_LIKE:'curtiu seu post', POST_COMMENT:'comentou no seu post',
    COMMENT_REPLY:'respondeu seu comentário', FRIEND_REQUEST:'te enviou uma solicitação de amizade',
    FRIEND_ACCEPTED:'aceitou sua solicitação de amizade', NEW_MESSAGE:'te enviou uma mensagem',
    DUO_INVITE:'te convidou para duo', ELO_UPDATE:'Seu elo foi atualizado!',
    DUO_LIKE:'te deu like no Match Duo! Veja o perfil dele', DUO_MATCH:'É um MATCH! Vocês dois se curtiram 💙',
    SYSTEM:'Mensagem do sistema'
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
    </div>` :
  n.type === 'DUO_LIKE' && n.actor_id ? `
    <div class="notif-friend-btns">
      <button class="notif-btn-accept" onclick="openDuoPreview(${n.actor_id},'DUO_LIKE')">
        <i class="ti ti-eye"></i> Ver perfil
      </button>
    </div>` :
  n.type === 'DUO_MATCH' && n.actor_id ? `
    <div class="notif-friend-btns">
      <button class="notif-btn-accept" onclick="openDuoPreview(${n.actor_id},'DUO_MATCH')" style="background:rgba(244,63,94,.15);border-color:rgba(244,63,94,.4);color:#FB7185">
        <i class="ti ti-hearts"></i> Ver match
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
  _groupBannerMode = false;
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
    return `<div class="banner-champ-item" onclick="selectBannerChamp('${key}','${escapeHtml(c)}',this)">
      <img src="${portraitUrl(key)}" class="banner-champ-portrait" onerror="this.style.display='none'" loading="lazy">
      <span>${escapeHtml(c)}</span>
    </div>`;
  }).join('');
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

  panel.innerHTML = `
    <div style="margin-bottom:12px;font-family:'Rajdhani',sans-serif;font-size:15px;font-weight:700;letter-spacing:1px;color:var(--gold-l)">${escapeHtml(displayName)}</div>
    <div class="banner-skin-grid">
      ${skins.map(s => `
        <div class="banner-skin-card" data-key="${key}" data-num="${s.num}" data-name="${escapeHtml(s.name==='default'?displayName:s.name)}"
             onclick="selectBannerSkin(this)">
          <img src="${tileUrl(key, s.num)}" class="banner-skin-thumb" loading="lazy"
               onerror="this.style.display='none'">
          <div class="banner-skin-label">${s.name==='default'?'Padrão':escapeHtml(s.name)}</div>
        </div>`).join('')}
    </div>`;
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
  if (_groupBannerMode) { await confirmBannerSelectionGroup(); return; }
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
  const bannerVal = user.profile_banner || me?.profile_banner;
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
          ${isMe ? `
            <div class="profile-status-row" onclick="openStatusEditor()" title="${user.custom_status ? 'Clique para editar seu status' : 'Definir status'}">
              ${user.custom_status
                ? `<div class="profile-custom-status profile-status-clickable">
                    <i class="ti ti-message-circle" style="font-size:12px"></i>
                    <span>${escapeHtml(user.custom_status)}</span>
                    <i class="ti ti-pencil profile-status-pencil"></i>
                  </div>`
                : `<div class="profile-custom-status profile-status-empty">
                    <i class="ti ti-plus" style="font-size:11px"></i> Definir status
                  </div>`
              }
            </div>` : (user.custom_status ? `<div class="profile-custom-status">
              <i class="ti ti-message-circle" style="font-size:12px"></i> ${escapeHtml(user.custom_status)}
            </div>` : '')}
          <div class="profile-elos">
            <span class="elo ${eloClass(user.solo_tier)}">Solo ${soloLabel}</span>
            <span class="elo ${eloClass(user.flex_tier)}">Flex ${flexLabel}</span>
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
      <button class="ptab" data-tab="matches" onclick="switchProfileTab('matches')">
        <i class="ti ti-sword"></i> Partidas
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
let _profileUserId = null;
let _profileTabActive = 'playlists';

function renderProfileContent(userId, content, isMe) {
  _profileContentCache = content;
  _profileUserId = userId;
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

  if (tab === 'matches')     loadProfileMatches(_profileUserId);
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
    await api('/users/me', { method: 'PATCH', body: { bio, display_name, roles, main_champions } });
    me.bio = bio;
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
         onclick="openConv(${c.id},${c.partner_id},'${escapeHtml(c.lol_game_name ? c.lol_game_name+'#'+(c.lol_tag_line||'')+'  '+(c.display_name||c.username||'') : c.display_name||c.username)}')">
      <div class="rp-conv-av-wrap">
        <div class="av av-sm" style="width:36px;height:36px;font-size:14px;background:${col};color:#0E0E12">${letter}
          <div class="status-dot ${c.online_status === 'online' ? 'dot-online' : 'dot-offline'}"></div>
        </div>
        ${unread > 0 && !isOpen ? `<span class="rp-conv-badge">${unread}</span>` : ''}
      </div>
      <div class="rp-conv-info">
        <div class="rp-conv-name" style="font-size:12.5px">
            ${c.lol_game_name ? escapeHtml(c.lol_game_name+'#'+(c.lol_tag_line||'')) : escapeHtml(c.display_name||c.username)}
          </div>
          <div style="font-size:10.5px;color:var(--dim);margin-top:-2px">
            ${c.display_name||c.username ? escapeHtml(c.display_name||c.username) : ''}
          </div>
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
  $('admin-tab-users').style.display   = tab === 'users'   ? 'flex' : 'none';
  $('admin-tab-reports').style.display = tab === 'reports' ? 'flex' : 'none';
  $('admin-tab-config').style.display  = tab === 'config'  ? 'flex' : 'none';
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

// ── Inicialização ─────────────────────────────
const _audioCtx = { sound: null };
function playQueueSound() {
  if (!_audioCtx.sound) {
    _audioCtx.sound = new Audio('/sounds/entrouFila.mp3');
    _audioCtx.sound.volume = 0.7;
  }
  const a = _audioCtx.sound;
  a.pause(); a.currentTime = 0;
  a.play().catch(e => console.warn('Som:', e));
}

// ══════════════════════════════════════════════════════════════
//  GRUPOS / CLÃS
// ══════════════════════════════════════════════════════════════
let _currentGroupId   = null;
let _currentGroupRole = null;
let _currentGroupTab  = 'feed';

async function loadGroupsPage() {
  const myList  = $('my-groups-list');
  const allList = $('all-groups-list');
  if (!myList) return;
  myList.innerHTML = allList.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const all  = await api('/groups');
    const mine = all.filter(g => g.my_role);
    const rest = all.filter(g => !g.my_role);
    myList.innerHTML  = mine.length ? mine.map(g => groupCardHTML(g)).join('') : '<p style="color:var(--dim);font-size:13px">Você não faz parte de nenhum grupo ainda.</p>';
    allList.innerHTML = rest.length ? rest.map(g => groupCardHTML(g)).join('') : '<p style="color:var(--dim);font-size:13px">Nenhum outro grupo encontrado.</p>';
  } catch { myList.innerHTML = '<p style="color:var(--dim)">Erro ao carregar</p>'; allList.innerHTML = ''; }
}

async function searchGroups() {
  const q = $('groups-search')?.value.trim();
  const allList = $('all-groups-list');
  if (!allList) return;
  allList.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const all = await api('/groups' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    const rest = all.filter(g => !g.my_role);
    allList.innerHTML = rest.length ? rest.map(g => groupCardHTML(g)).join('') : '<p style="color:var(--dim);font-size:13px">Nenhum grupo encontrado.</p>';
  } catch { allList.innerHTML = '<p style="color:var(--dim)">Erro</p>'; }
}

function groupCardHTML(g) {
  const initial = (g.name || '?')[0].toUpperCase();
  const avHTML  = g.avatar_url ? `<img src="${escapeHtml(g.avatar_url)}" alt="">` : initial;
  const roleLabel = g.my_role ? `<span class="group-card-role role-${g.my_role}">${g.my_role==='owner'?'Dono':g.my_role==='admin'?'Admin':'Membro'}</span>` : '';
  return `<div class="group-card" onclick="viewGroup(${g.id})">
    <div class="group-card-banner">${g.banner_url?`<img src="${escapeHtml(g.banner_url)}" alt="">`:''}
      <span class="group-card-tag">[${escapeHtml(g.tag)}]</span></div>
    <div class="group-card-body">
      <div class="group-card-av">${avHTML}</div>
      <div class="group-card-name">${escapeHtml(g.name)}</div>
      <div class="group-card-desc">${escapeHtml(g.description||'Sem descrição')}</div>
      <div class="group-card-footer">
        <span class="group-card-members"><i class="ti ti-users" style="font-size:12px"></i> ${g.member_count}</span>
        ${roleLabel}
        ${!g.my_role?`<span class="group-card-lock"><i class="ti ti-${g.is_public?'lock-open':'lock'}"></i></span>`:''}
      </div>
    </div></div>`;
}

async function viewGroup(id) {
  _currentGroupId = id; _currentGroupRole = null;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.s-item').forEach(i => i.classList.remove('active'));
  $('page-group-detail')?.classList.add('active');
  $('nav-groups')?.classList.add('active');
  const rp = document.querySelector('.right-panel');
  if (rp) rp.style.display = 'none';
  $('group-detail-name').textContent = 'Carregando...';
  $('group-tab-content').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  $('group-detail-actions').innerHTML = '';
  $('group-banner-area').innerHTML = '';
  try {
    const g = await api(`/groups/${id}`);
    _currentGroupRole = g.my_role || null;
    const canEditGroup = g.my_role === 'owner' || g.my_role === 'admin';
    $('group-banner-area').innerHTML = `
      <div class="group-detail-banner" id="group-banner-img">
        ${g.banner_url?`<img src="${escapeHtml(g.banner_url)}" alt="">` : ''}
        ${canEditGroup ? `<button class="profile-banner-btn" onclick="openGroupBannerPicker()" title="Alterar capa do grupo">
          <i class="ti ti-photo"></i> Alterar capa
        </button>` : ''}
      </div>
      <div class="group-detail-info">
        <div class="group-detail-av">${g.avatar_url?`<img src="${escapeHtml(g.avatar_url)}" alt="">`:escapeHtml((g.name||'?')[0].toUpperCase())}</div>
        <div class="group-detail-meta">
          <div class="group-detail-name">${escapeHtml(g.name)}</div>
          <div class="group-detail-tag">[${escapeHtml(g.tag)}]</div>
          <div class="group-detail-desc">${escapeHtml(g.description||'')}</div>
          <div style="font-size:11.5px;color:var(--dim);margin-top:4px">
            <i class="ti ti-users" style="font-size:12px"></i> ${g.member_count} membros •
            <i class="ti ti-${g.is_public?'lock-open':'lock'}" style="font-size:12px"></i> ${g.is_public?'Público':'Privado'}
          </div>
        </div>
      </div>`;
    $('group-detail-name').textContent = g.name;
    let actionHTML = '';
    if (!g.my_role && !g.my_request) actionHTML = `<button class="btn-post" onclick="joinGroup(${g.id})"><i class="ti ti-plus"></i> ${g.is_public?'Entrar':'Solicitar Entrada'}</button>`;
    else if (g.my_request==='pending') actionHTML = `<button class="btn-outline" disabled style="opacity:.6">Aguardando aprovação...</button>`;
    else if (g.my_role && g.my_role!=='owner') actionHTML = `<button class="btn-outline" onclick="leaveGroup(${g.id})" style="border-color:rgba(239,68,68,.4);color:#FCA5A5"><i class="ti ti-logout"></i> Sair</button>`;
    else if (g.my_role==='owner') actionHTML = `<button class="btn-outline" onclick="deleteGroup(${g.id})" style="border-color:rgba(239,68,68,.4);color:#FCA5A5"><i class="ti ti-trash"></i> Excluir Grupo</button>`;
    $('group-detail-actions').innerHTML = actionHTML;
    const reqTab = $('group-requests-tab');
    if (reqTab) reqTab.style.display = (g.my_role==='owner'||g.my_role==='admin') ? '' : 'none';
    _currentGroupTab = 'feed';
    document.querySelectorAll('.group-tab').forEach(t => t.classList.remove('on'));
    document.querySelector('.group-tab')?.classList.add('on');
    if (socket) socket.emit('join_group_room', id);
    if (g.my_role) loadGroupFeed();
    else $('group-tab-content').innerHTML = `<div class="empty" style="padding:40px"><i class="ti ti-lock"></i><p>${g.is_public?'Entre no grupo para ver o feed':'Grupo privado — solicite entrada'}</p></div>`;
  } catch { $('group-tab-content').innerHTML = '<div class="empty"><p>Erro ao carregar grupo</p></div>'; }
}

function switchGroupTab(tab, btn) {
  _currentGroupTab = tab;
  document.querySelectorAll('.group-tab').forEach(t => t.classList.remove('on'));
  if (btn) btn.classList.add('on');
  if (tab==='feed')     loadGroupFeed();
  if (tab==='chat')     loadGroupChat();
  if (tab==='members')  loadGroupMembers();
  if (tab==='requests') loadGroupRequests();
}

async function loadGroupFeed() {
  const c = $('group-tab-content'); c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const posts = await api(`/groups/${_currentGroupId}/posts`);
    const composerHTML = `<div style="padding:14px 16px"><div class="composer" style="margin-bottom:0"><div class="composer-body">${avatarHTML(me,'av-lg')}<textarea class="composer-ta" id="group-post-ta" placeholder="Compartilhe algo com o grupo..." maxlength="500" rows="2"></textarea></div><div class="composer-foot" style="justify-content:flex-end"><button class="btn-post" onclick="publishGroupPost()">POSTAR</button></div></div></div>`;
    c.innerHTML = composerHTML + (posts.length ? posts.map(p => groupPostHTML(p)).join('') : '<div class="empty"><i class="ti ti-writing-off"></i><p>Nenhum post ainda.</p></div>');
  } catch { c.innerHTML = '<div class="empty"><p>Erro ao carregar</p></div>'; }
}

function groupPostHTML(p) {
  const canDelete = p.user_id===me?.id || ['owner','admin'].includes(_currentGroupRole);
  return `<div class="group-post-card" id="gpost-${p.id}">
    <div class="post-head"><div onclick="viewProfile(${p.user_id})" style="cursor:pointer;flex-shrink:0">${avatarHTML(p,'av-lg')}</div>
    <div class="post-meta"><div class="post-top">
      <span class="post-name" onclick="viewProfile(${p.user_id})" style="cursor:pointer">${escapeHtml(p.display_name||p.username)}</span>
      ${p.has_mic?'<span class="post-mic"><i class="ti ti-microphone"></i></span>':''}
    </div>
    <div class="post-body">${escapeHtml(p.content)}</div>
    <div class="post-actions">
      <button class="act-btn ${p.liked_by_me?'liked':''}" onclick="likeGroupPost(${p.id},this)"><i class="ti ti-heart"></i> <span>${p.total_likes}</span></button>
      ${canDelete?`<button class="act-btn del-btn" onclick="deleteGroupPost(${p.id})"><i class="ti ti-trash"></i> Deletar</button>`:''}
    </div></div></div></div>`;
}

async function publishGroupPost() {
  const ta = $('group-post-ta'); if (!ta?.value.trim()) return;
  try { await api(`/groups/${_currentGroupId}/posts`,{method:'POST',body:{content:ta.value.trim()}}); ta.value=''; loadGroupFeed(); } catch { toast('Erro ao postar'); }
}
async function likeGroupPost(postId,btn) {
  try { const {liked}=await api(`/groups/${_currentGroupId}/posts/${postId}/like`,{method:'POST'}); btn.classList.toggle('liked',liked); const s=btn.querySelector('span'); if(s) s.textContent=parseInt(s.textContent)+(liked?1:-1); } catch {}
}
async function deleteGroupPost(postId) {
  if (!confirm('Deletar este post?')) return;
  try { await api(`/groups/${_currentGroupId}/posts/${postId}`,{method:'DELETE'}); $('gpost-'+postId)?.remove(); } catch { toast('Erro ao deletar'); }
}

async function loadGroupChat() {
  const c = $('group-tab-content'); c.style.padding='0';
  c.innerHTML = `<div class="group-chat-wrap"><div class="group-chat-msgs" id="gchat-msgs"></div><div class="group-chat-input-row"><input class="group-chat-input" id="gchat-input" placeholder="Mensagem..." maxlength="300" onkeydown="if(event.key==='Enter')sendGroupChatMsg()"><button class="queue-chat-send" onclick="sendGroupChatMsg()"><i class="ti ti-send"></i></button></div></div>`;
  try { const msgs=await api(`/groups/${_currentGroupId}/messages`); const cont=$('gchat-msgs'); msgs.forEach(m=>appendGroupMsg(cont,m)); cont.scrollTop=cont.scrollHeight; } catch {}
}
function appendGroupMsg(container,m) {
  if (!container) return;
  const isMe=m.user_id===me?.id; const name=escapeHtml(m.display_name||m.username); const letter=name[0]?.toUpperCase()||'?';
  const avHTML=m.avatar_url?`<img src="${escapeHtml(m.avatar_url)}" class="av av-sm" style="object-fit:cover">`:`<div class="av av-sm" style="background:var(--gold);color:var(--navy);font-weight:700">${letter}</div>`;
  const div=document.createElement('div'); div.className='queue-chat-bubble'+(isMe?' me':'');
  div.innerHTML=`<div class="queue-chat-av">${avHTML}</div><div class="queue-chat-body">${!isMe?`<div class="queue-chat-name">${name}</div>`:''}<div class="queue-chat-text">${escapeHtml(m.content)}</div></div>`;
  container.appendChild(div);
}
async function sendGroupChatMsg() {
  const input=$('gchat-input'); if (!input?.value.trim()) return; const content=input.value.trim(); input.value='';
  try { await api(`/groups/${_currentGroupId}/messages`,{method:'POST',body:{content}}); } catch { toast('Erro ao enviar'); }
}
function onGroupMessage(msg) {
  if (msg.group_id!==_currentGroupId||_currentGroupTab!=='chat') return;
  const container=$('gchat-msgs'); if (!container) return;
  appendGroupMsg(container,msg); container.scrollTop=container.scrollHeight;
}

async function loadGroupMembers() {
  const c=$('group-tab-content'); c.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try {
    const members=await api(`/groups/${_currentGroupId}/members`);
    const isOwner=_currentGroupRole==='owner', isAdmin=_currentGroupRole==='admin';
    c.innerHTML=members.map(m=>{
      const roleLabel=m.role==='owner'?'Dono':m.role==='admin'?'Admin':'Membro';
      const canKick=(isOwner&&m.role!=='owner')||(isAdmin&&m.role==='member');
      const canRole=isOwner&&m.user_id!==me?.id&&m.role!=='owner';
      return `<div class="member-row">
        <div onclick="viewProfile(${m.id})" style="cursor:pointer;flex-shrink:0">${avatarHTML(m,'av-md')}</div>
        <div class="member-info" onclick="viewProfile(${m.id})" style="cursor:pointer">
          <div class="member-name">${escapeHtml(m.display_name||m.username)} <span class="group-card-role role-${m.role}">${roleLabel}</span></div>
          <div class="member-nick">${escapeHtml(m.lol_game_name)}#${escapeHtml(m.lol_tag_line)}</div>
        </div>
        <div class="member-actions">
          ${canRole?`<button class="queue-add-btn" title="${m.role==='admin'?'Rebaixar':'Promover'}" onclick="toggleMemberRole(${m.id},'${m.role}')"><i class="ti ti-${m.role==='admin'?'arrow-down':'star'}"></i></button>`:''}
          ${canKick?`<button class="queue-add-btn" style="border-color:rgba(239,68,68,.3);color:#FCA5A5" onclick="kickGroupMember(${m.id})"><i class="ti ti-user-x"></i></button>`:''}
        </div>
      </div>`;
    }).join('')||'<div class="empty"><p>Nenhum membro</p></div>';
  } catch { c.innerHTML='<div class="empty"><p>Erro</p></div>'; }
}
async function toggleMemberRole(userId,currentRole) {
  const newRole=currentRole==='admin'?'member':'admin';
  if (!confirm(`Deseja ${newRole==='admin'?'promover a Admin':'rebaixar para Membro'}?`)) return;
  try { await api(`/groups/${_currentGroupId}/members/${userId}/role`,{method:'PATCH',body:{role:newRole}}); toast('✅ Cargo atualizado'); loadGroupMembers(); } catch(e){toast(e.error||'Erro');}
}
async function kickGroupMember(userId) {
  if (!confirm('Expulsar este membro?')) return;
  try { await api(`/groups/${_currentGroupId}/members/${userId}`,{method:'DELETE'}); toast('Membro expulso'); loadGroupMembers(); } catch(e){toast(e.error||'Erro');}
}

async function loadGroupRequests() {
  const c=$('group-tab-content'); c.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try {
    const reqs=await api(`/groups/${_currentGroupId}/requests`);
    const badge=$('group-req-badge'); if(badge){badge.textContent=reqs.length;badge.style.display=reqs.length?'':'none';}
    if (!reqs.length){c.innerHTML='<div class="empty"><i class="ti ti-check"></i><p>Nenhuma solicitação pendente</p></div>';return;}
    c.innerHTML=reqs.map(r=>`<div class="request-card" id="req-${r.id}">
      <div onclick="viewProfile(${r.user_id})" style="cursor:pointer;flex-shrink:0">${avatarHTML(r,'av-md')}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600">${escapeHtml(r.display_name||r.username)}</div>
        <div style="font-size:11.5px;color:var(--dim)">${escapeHtml(r.lol_game_name)}#${escapeHtml(r.lol_tag_line)}</div>
        ${r.message?`<div style="font-size:12px;color:var(--muted);margin-top:4px;font-style:italic">"${escapeHtml(r.message)}"</div>`:''}
      </div>
      <div class="request-actions">
        <button class="btn-approve" onclick="handleGroupRequest(${r.id},'approve')"><i class="ti ti-check"></i> Aprovar</button>
        <button class="btn-reject"  onclick="handleGroupRequest(${r.id},'reject')"><i class="ti ti-x"></i> Rejeitar</button>
      </div></div>`).join('');
  } catch { c.innerHTML='<div class="empty"><p>Erro</p></div>'; }
}
async function handleGroupRequest(reqId,action) {
  try { await api(`/groups/${_currentGroupId}/requests/${reqId}`,{method:'PATCH',body:{action}}); $('req-'+reqId)?.remove(); toast(action==='approve'?'✅ Aprovado!':'❌ Rejeitado'); loadGroupRequests(); } catch(e){toast(e.error||'Erro');}
}
async function joinGroup(id) {
  try { const {status}=await api(`/groups/${id}/join`,{method:'POST',body:{}}); toast(status==='joined'?'✅ Você entrou no grupo!':'📩 Solicitação enviada!'); viewGroup(id); } catch(e){toast(e.error||'Erro');}
}
async function leaveGroup(id) {
  if (!confirm('Sair deste grupo?')) return;
  try { await api(`/groups/${id}/leave`,{method:'DELETE'}); toast('Você saiu do grupo'); if(socket)socket.emit('leave_group_room',id); loadPage('groups'); } catch(e){toast(e.error||'Erro');}
}
async function deleteGroup(id) {
  if (!confirm('Excluir este grupo permanentemente?')) return;
  try { await api(`/groups/${id}`,{method:'DELETE'}); toast('Grupo excluído'); if(socket)socket.emit('leave_group_room',id); loadPage('groups'); } catch(e){toast(e.error||'Erro');}
}
function openCreateGroupModal(){const m=$('create-group-modal');if(m){m.style.display='flex';document.body.style.overflow='hidden';}}
function closeCreateGroupModal(){const m=$('create-group-modal');if(m){m.style.display='none';document.body.style.overflow='';}}
async function createGroup() {
  const name=$('cg-name')?.value.trim(), tag=$('cg-tag')?.value.trim(), desc=$('cg-desc')?.value.trim();
  const pub=document.querySelector('input[name="cg-public"]:checked')?.value;
  if (!name){toast('Nome obrigatório');return;} if (!tag){toast('Tag obrigatória');return;}
  try { const g=await api('/groups',{method:'POST',body:{name,tag,description:desc,is_public:pub==='1'?1:0}}); closeCreateGroupModal(); toast(`✅ Grupo [${g.tag}] criado!`); viewGroup(g.id); } catch(e){toast(e.error||'Erro ao criar grupo');}
}

// ── Pesquisa global ─────────────────────────────
let _searchTimer = null;
function openGlobalSearch(){
  const modal=$('search-modal');
  if(!modal)return;
  modal.style.display='flex';
  document.body.style.overflow='hidden';
  setTimeout(()=>$('global-search-input')?.focus(),80);
}
function closeGlobalSearch(){
  const modal=$('search-modal');
  if(!modal)return;
  modal.style.display='none';
  document.body.style.overflow='';
  const inp=$('global-search-input');
  if(inp)inp.value='';
  const res=$('global-search-results');
  if(res)res.innerHTML='';
}
function onGlobalSearch(q){clearTimeout(_searchTimer);const results=$('global-search-results');if(!q.trim()){results.innerHTML='';return;}results.innerHTML='<div class="gs-empty"><div class="spinner" style="margin:0 auto"></div></div>';_searchTimer=setTimeout(()=>runGlobalSearch(q),350);}
async function runGlobalSearch(q){
  const results=$('global-search-results');
  try {
    const users=await api('/users?q='+encodeURIComponent(q)+'&limit=8');
    if (!users.length){results.innerHTML='<div class="gs-empty">Nenhum invocador encontrado</div>';return;}
    results.innerHTML=users.map(u=>`<div class="gs-result" onclick="closeGlobalSearch();viewProfile(${u.id})">${avatarHTML(u,'av-md')}<div class="gs-result-info"><div class="gs-result-name">${escapeHtml(u.display_name||u.username)}</div><div class="gs-result-nick">${escapeHtml(u.lol_game_name)}#${escapeHtml(u.lol_tag_line)}</div><div class="gs-result-elos"><span class="elo ${eloClass(u.solo_tier)}">Solo ${eloLabel(u.solo_tier,u.solo_rank,u.solo_lp)}</span><span class="elo ${eloClass(u.flex_tier)}">Flex ${eloLabel(u.flex_tier,u.flex_rank,u.flex_lp)}</span></div></div></div>`).join('');
  } catch { results.innerHTML='<div class="gs-empty">Erro ao buscar</div>'; }
}
document.addEventListener('click',e=>{const modal=$('search-modal');if(modal&&modal.style.display!=='none'&&e.target===modal)closeGlobalSearch();});

// ── Fila ao vivo ────────────────────────────────
let _inQueue=false,_queueType='SOLO',_queueFilter='all',_queuePlayers=[],_allQueuePlayers=[],_queueTimerInt=null,_queueJoinedAt=null,_queueMinimized=false;
function openQueuePanel(){$('queue-panel').classList.add('open');$('queue-overlay').classList.add('open');$('queue-fab').style.display='none';loadQueueList();updateQueueChatInput();emitWhenReady('queue_chat_history');}
function closeQueuePanel(){
  $('queue-panel').classList.remove('open');
  $('queue-overlay').classList.remove('open');
  $('queue-fab').style.display='flex';
  if(_queueChatPollInterval){ clearInterval(_queueChatPollInterval); _queueChatPollInterval=null; }
}
function toggleQueueMinimize(){
  _queueMinimized=!_queueMinimized;
  const body=$('queue-body');
  const icon=$('queue-minimize-icon');
  const actions=$('match-actions'); // não confundir
  if(_queueMinimized){
    if(body){ body.style.display='none'; }
    if(icon) icon.className='ti ti-chevron-up';
  }else{
    if(body){ body.style.display=''; }
    if(icon) icon.className='ti ti-minus';
  }
}
function setQueueFilter(q,btn){_queueFilter=q;document.querySelectorAll('.queue-filter-btn').forEach(b=>b.classList.remove('on'));btn.classList.add('on');renderQueueList();}
async function toggleQueue(){if(_inQueue)await leaveQueue();else await joinQueue();}
async function joinQueue(){
  const queueType=$('queue-type-select').value;
  try{const{user}=await api('/queue/join',{method:'POST',body:{queue_type:queueType}});
    _inQueue=true;_queueType=queueType;_queueJoinedAt=new Date();
    const btn=$('queue-join-btn');btn.innerHTML='<i class="ti ti-x"></i> Sair da Fila';btn.classList.add('leaving');
    $('queue-timer-bar').style.display='flex';$('queue-type-select').disabled=true;$('queue-fab').classList.add('in-queue');
    startQueueTimer();playQueueSound();toast('🟢 Você entrou na fila de '+queueTypeLabel(queueType)+'!');
    updateQueueChatInput();emitWhenReady('queue_chat_history');loadQueueList();
  }catch(err){toast('Erro ao entrar na fila');}
}
async function leaveQueue(){
  try{await api('/queue/leave',{method:'DELETE'});_inQueue=false;
    const btn=$('queue-join-btn');btn.innerHTML='<i class="ti ti-search"></i> Entrar na Fila';btn.classList.remove('leaving');
    $('queue-timer-bar').style.display='none';$('queue-type-select').disabled=false;$('queue-fab').classList.remove('in-queue');
    clearInterval(_queueTimerInt);_queueTimerInt=null;_queueJoinedAt=null;
    toast('⬜ Você saiu da fila');updateQueueChatInput();loadQueueList();
  }catch{}
}
function startQueueTimer(){clearInterval(_queueTimerInt);_queueTimerInt=setInterval(()=>{if(!_queueJoinedAt)return;const secs=Math.floor((Date.now()-_queueJoinedAt)/1000);const mm=String(Math.floor(secs/60)).padStart(2,'0'),ss=String(secs%60).padStart(2,'0');const t=$('queue-timer');if(t)t.textContent=mm+':'+ss;if(secs>=1800)leaveQueue();},1000);}
function queueTypeLabel(q){return{SOLO:'Solo/Duo',FLEX:'Flex',ARAM:'ARAM',ARENA:'Arena'}[q]||q;}
async function loadQueueList(){try{const players=await api('/queue');if(Array.isArray(players)){_allQueuePlayers=players;const badge=$('queue-fab-badge');if(badge){badge.textContent=players.length;badge.style.display=players.length>0?'':'none';}updateQueueCount(players.length);renderQueueList();}}catch(err){console.warn('loadQueueList:',err);}}
function updateQueueCount(n){const el=$('queue-count');if(el)el.textContent=n;}
function renderQueueList(){const list=$('queue-list');if(!list)return;const filtered=_queueFilter==='all'?_allQueuePlayers:_allQueuePlayers.filter(p=>p.queue_type===_queueFilter);if(!filtered.length){list.innerHTML='<div class="queue-empty">Nenhum jogador nesta fila agora<br><span style="font-size:11px;margin-top:4px;display:block">Seja o primeiro! 🎮</span></div>';return;}list.innerHTML=filtered.map(p=>queuePlayerCardHTML(p)).join('');}
function queuePlayerCardHTML(p){const isMe=p.id==me?.id,name=escapeHtml(p.display_name||p.username),nick=escapeHtml(p.lol_game_name)+'#'+escapeHtml(p.lol_tag_line),roles=p.roles?p.roles.split(',').filter(Boolean):[],qtBadge=p.queue_type?.toLowerCase();return `<div class="queue-player-card ${isMe?'is-me':''}" onclick="viewProfile(${p.id})">${avatarHTML(p,'av-md')}<div class="queue-player-info"><div class="queue-player-name">${name}${p.has_mic?'<i class="ti ti-microphone queue-mic-icon" title="Tem microfone"></i>':''}</div><div class="queue-player-nick">${nick}</div><div class="queue-player-elos"><span class="elo ${eloClass(p.solo_tier)}">Solo ${eloLabel(p.solo_tier,p.solo_rank,p.solo_lp)}</span><span class="elo ${eloClass(p.flex_tier)}">Flex ${eloLabel(p.flex_tier,p.flex_rank,p.flex_lp)}</span><span class="queue-type-badge ${qtBadge}">${queueTypeLabel(p.queue_type)}</span></div>${roles.length?`<div class="queue-player-roles">${roles.map(r=>`<span class="queue-role-chip">${r}</span>`).join('')}</div>`:''}</div>${!isMe?`<div class="queue-player-actions" onclick="event.stopPropagation()"><div class="queue-add-btn" onclick="addFriend(${p.id},this)" title="Adicionar amigo"><i class="ti ti-user-plus"></i></div><div class="queue-dm-btn" onclick="openDM(${p.id},'${escapeHtml(p.username)}')" title="Enviar mensagem"><i class="ti ti-message-2"></i></div></div>`:`<div style="font-size:10px;color:var(--gold-l);font-weight:700;text-align:center;padding:2px 4px">VOCÊ</div>`}</div>`;}
function onQueueUpdate({action,user,user_id}){if(action==='join'){_allQueuePlayers=_allQueuePlayers.filter(p=>p.id!==user.id);_allQueuePlayers.push(user);}else if(action==='leave'){_allQueuePlayers=_allQueuePlayers.filter(p=>p.id!==user_id);}updateQueueCount(_allQueuePlayers.length);renderQueueList();const badge=$('queue-fab-badge');if(badge){badge.textContent=_allQueuePlayers.length;badge.style.display=_allQueuePlayers.length>0?'':'none';}if(action==='join'&&user.id!==me?.id){playQueueSound();const panelOpen=$('queue-panel')?.classList.contains('open')&&!$('queue-panel')?.classList.contains('queue-minimized');if(!panelOpen)toast(`🎮 ${user.display_name||user.username} entrou na fila de ${queueTypeLabel(user.queue_type)}!`);}}
async function checkQueueStatus(){try{const entry=await api('/queue/me');if(entry){_inQueue=true;_queueType=entry.queue_type;_queueJoinedAt=new Date(entry.joined_at);const btn=$('queue-join-btn');if(btn){btn.innerHTML='<i class="ti ti-x"></i> Sair da Fila';btn.classList.add('leaving');}const timerBar=$('queue-timer-bar');if(timerBar)timerBar.style.display='flex';const sel=$('queue-type-select');if(sel){sel.value=entry.queue_type;sel.disabled=true;}$('queue-fab')?.classList.add('in-queue');startQueueTimer();updateQueueChatInput();}}catch{}}

// ── Chat da Fila ────────────────────────────────
let _currentQueueTab='players',_queueChatUnread=0;
let _queueChatPollInterval = null;

function switchQueueTab(tab){
  _currentQueueTab=tab;
  document.querySelectorAll('.queue-tab').forEach(t=>t.classList.remove('on'));
  $('qtab-'+tab)?.classList.add('on');
  const players=$('queue-tab-players'),chat=$('queue-tab-chat');
  if(players)players.style.display=tab==='players'?'':'none';
  if(chat)chat.style.display=tab==='chat'?'flex':'none';

  if(tab==='chat'){
    _queueChatUnread=0;
    const badge=$('queue-chat-badge');
    if(badge)badge.style.display='none';
    // Limpar estado e carregar do servidor
    const chatContainer = $('queue-chat-msgs');
    if(chatContainer){ delete chatContainer.dataset.lastId; }
    _pendingQueueMsgs = [];
    setTimeout(()=>$('queue-chat-input')?.focus(),50);
    // Polling HTTP a cada 3s — busca mensagens de todos
    if(_queueChatPollInterval) clearInterval(_queueChatPollInterval);
    pollQueueChat(); // buscar imediatamente ao abrir
    _queueChatPollInterval = setInterval(()=>{
      if(_currentQueueTab==='chat' && $('queue-panel')?.classList.contains('open')){
        pollQueueChat();
      } else {
        clearInterval(_queueChatPollInterval);
        _queueChatPollInterval = null;
      }
    }, 3000);
  } else {
    if(_queueChatPollInterval){ clearInterval(_queueChatPollInterval); _queueChatPollInterval=null; }
  }
}
async function sendQueueChat(){
  const input=$('queue-chat-input');
  if(!input||!input.value.trim())return;
  if(!_inQueue){toast('⚠️ Entre na fila para enviar mensagens');return;}
  const content=input.value.trim();
  input.value='';
  // Enviar via socket quando disponível
  // Exibir imediatamente (optimista) com ID temporário negativo
  const tempId = -(Date.now());
  appendQueueChatHTTPMsg({
    id: tempId, user_id: me?.id,
    display_name: me?.display_name, username: me?.username,
    avatar_url: me?.avatar_url, content: content
  });
  // Registrar como pendente para o dedup do poll
  _pendingQueueMsgs.push({ tempId, content, user_id: me?.id });

  // Salvar no servidor
  try {
    await api('/queue/chat', { method: 'POST', body: { content } });
  } catch(e) {
    console.warn('Erro ao salvar msg chat:', e);
  }
}
function appendQueueChatMsg(msg){const container=$('queue-chat-msgs');if(!container)return;const isMe=msg.sender_id==me?.id;const avColor='#C8963E',letter=(msg.sender_name||'U')[0].toUpperCase();const avHTML=msg.avatar_url?`<img src="${msg.avatar_url}" class="av av-sm" style="object-fit:cover">`:`<div class="av av-sm" style="background:${avColor};color:#0A0E1A">${letter}</div>`;const div=document.createElement('div');div.className='queue-chat-bubble'+(isMe?' me':'');div.innerHTML=`<div class="queue-chat-av">${avHTML}</div><div class="queue-chat-body">${!isMe?`<div class="queue-chat-name">${escapeHtml(msg.sender_name||'')}</div>`:''}<div class="queue-chat-text">${escapeHtml(msg.content)}</div></div>`;container.appendChild(div);container.scrollTop=container.scrollHeight;}
function onQueueChatMsg(msg){
  // Não duplicar mensagem própria (já exibida optimistamente)
  if(msg.sender_id == me?.id) return;
  if(_currentQueueTab!=='chat'||!$('queue-panel')?.classList.contains('open')){
    _queueChatUnread++;
    const badge=$('queue-chat-badge');
    if(badge){badge.textContent=_queueChatUnread;badge.style.display='';}
  }
  appendQueueChatMsg(msg);
  playQueueSound();
}
function onQueueChatHistory(msgs){
  const container=$('queue-chat-msgs');
  if(!container)return;
  // Reconstruir com todas as mensagens do servidor (fonte da verdade)
  const info=container.querySelector('.queue-chat-info');
  const wasAtBottom=container.scrollHeight-container.scrollTop-container.clientHeight < 60;
  container.innerHTML='';
  if(info)container.appendChild(info);
  msgs.forEach(m=>appendQueueChatMsg(m));
  if(wasAtBottom) container.scrollTop=container.scrollHeight;
}
function updateQueueChatInput(){const input=$('queue-chat-input'),sendBtn=document.querySelector('.queue-chat-send');if(!input)return;if(_inQueue){input.disabled=false;input.placeholder='Mensagem para a fila...';if(sendBtn)sendBtn.disabled=false;}else{input.disabled=true;input.placeholder='Entre na fila para enviar mensagens';if(sendBtn)sendBtn.disabled=true;}}
function toggleMicEdit(btn){const isOn=btn.classList.toggle('mic-on'),icon=btn.querySelector('i'),label=btn.querySelector('span');icon.className=isOn?'ti ti-microphone':'ti ti-microphone-off';if(label)label.textContent=isOn?'Tenho microfone':'Sem microfone';}
async function toggleMicSave(btn){const isOn=btn.classList.toggle('mic-on'),icon=btn.querySelector('i');icon.className=isOn?'ti ti-microphone':'ti ti-microphone-off';btn.title=isOn?'Microfone ativo — clique para desativar':'Sem microfone — clique para ativar';try{await api('/users/me',{method:'PATCH',body:{has_mic:isOn?1:0}});me.has_mic=isOn?1:0;localStorage.setItem('duoq_me',JSON.stringify(me));toast(isOn?'🎙️ Microfone ativado!':'🔇 Microfone desativado');}catch{toast('Erro ao salvar');}}
function toggleFriendsPanel(){const panel=$('s-friends-panel');if(panel)panel.classList.toggle('s-friends-body-collapsed');}
function emitWhenReady(event,data,retries=10){if(socket?.connected){data!==undefined?socket.emit(event,data):socket.emit(event);}else if(retries>0){setTimeout(()=>emitWhenReady(event,data,retries-1),300);}}

// ── Amigos na aba Mensagens ─────────────────────
async function loadFriendsInMessages(){const panel=$('friends-in-messages');if(!panel)return;try{const friends=await api('/users/me/friends');panel.style.display='';const online=friends.filter(f=>f.online_status==='online'||f.online_status==='away'),offline=friends.filter(f=>f.online_status!=='online'&&f.online_status!=='away');panel.innerHTML=`<div class="social-panel"><div class="social-panel-title"><i class="ti ti-users"></i> Amigos<span class="social-online-count">${online.length} online</span></div>${online.length?`<div class="social-section-label"><span class="social-dot online"></span> Online</div><div class="social-friends-list">${online.map(f=>socialFriendHTML(f)).join('')}</div>`:''}<div class="social-section-label" style="margin-top:${online.length?12:0}px"><span class="social-dot offline"></span> Offline</div><div class="social-friends-list">${offline.length?offline.map(f=>socialFriendHTML(f)).join(''):'<div class="social-empty">Nenhum amigo offline</div>'}</div>${!friends.length?'<div class="social-empty" style="margin-top:16px">Você ainda não tem amigos.</div>':''}</div><div class="social-divider"><i class="ti ti-message-2"></i> Conversas</div>`;}catch{const panel=$('friends-in-messages');if(panel)panel.innerHTML='';}}
function socialFriendHTML(f){const name=escapeHtml(f.display_name||f.username),nick=escapeHtml(f.lol_game_name)+'#'+escapeHtml(f.lol_tag_line),isOnline=f.online_status==='online',dotCls=isOnline?'dot-online':f.online_status==='away'?'dot-away':'dot-offline',statusText=isOnline?'Online':f.online_status==='away'?'Ausente':'Offline';return `<div class="social-friend-item" onclick="viewProfile(${f.id})" title="Ver perfil de ${name}">${avatarHTML(f,'av-md')}<div class="social-friend-info"><div class="social-friend-name">${name}</div><div class="social-friend-status"><span class="social-dot-sm ${dotCls}"></span>${statusText}</div></div><button class="social-chat-btn" onclick="event.stopPropagation();openDM(${f.id},'${escapeHtml(f.username)}')" title="Abrir conversa"><i class="ti ti-message-circle"></i></button></div>`;}

// ── Inicialização ─────────────────────────────

// ── Capa do Grupo ────────────────────────────────
let _groupBannerMode = false; // true = picker para grupo, false = para perfil

async function openGroupBannerPicker() {
  _groupBannerMode = true;
  await openBannerPicker();
}

async function confirmBannerSelectionGroup() {
  if (!_bannerSelection) return;
  const banner = `${_bannerSelection.key}_${_bannerSelection.num}`;
  try {
    await api(`/groups/${_currentGroupId}`, { method:'PATCH', body:{ banner_url: splashUrl(_bannerSelection.key, _bannerSelection.num) } });
    // Atualizar visualmente sem recarregar tudo
    const img = document.querySelector('#group-banner-img img');
    const bannerDiv = $('group-banner-img');
    if (img) {
      img.src = splashUrl(_bannerSelection.key, _bannerSelection.num);
    } else if (bannerDiv) {
      const newImg = document.createElement('img');
      newImg.src = splashUrl(_bannerSelection.key, _bannerSelection.num);
      bannerDiv.insertBefore(newImg, bannerDiv.firstChild);
    }
    closeBannerModal();
    _groupBannerMode = false;
    toast('✅ Capa do grupo atualizada!');
  } catch (err) {
    toast('Erro ao salvar capa'); console.error(err);
  }
}
// ══════════════════════════════════════════════
//  HISTÓRICO DE PARTIDAS
// ══════════════════════════════════════════════
const QUEUE_LABELS = {
  420: 'Ranqueada Solo/Duo', 440: 'Ranqueada Flex',
  450: 'ARAM', 490: 'Normal', 400: 'Normal Draft',
  900: 'ARURF', 1020: 'One for All', 1700: 'Arena',
  1900: 'URF', 700: 'Clash'
};

let _matchesFilter = 'all';

async function loadProfileMatches(userId, filter) {
  if (filter !== undefined) _matchesFilter = filter;
  const box = $('profile-tab-content');
  if (!box) return;

  // Renderizar header com filtros
  box.innerHTML = `
    <div class="matches-filter-bar">
      <button class="mfilter-btn ${_matchesFilter==='all'   ?'on':''}" onclick="loadProfileMatches(${userId},'all')">Tudo</button>
      <button class="mfilter-btn ${_matchesFilter==='ranked'?'on':''}" onclick="loadProfileMatches(${userId},'ranked')">Ranked Solo</button>
      <button class="mfilter-btn ${_matchesFilter==='flex'  ?'on':''}" onclick="loadProfileMatches(${userId},'flex')">Flex</button>
      <button class="mfilter-btn ${_matchesFilter==='aram'  ?'on':''}" onclick="loadProfileMatches(${userId},'aram')">ARAM</button>
      <button class="mfilter-btn ${_matchesFilter==='normal'?'on':''}" onclick="loadProfileMatches(${userId},'normal')">Normal</button>
    </div>
    <div id="matches-content"><div class="loading"><div class="spinner"></div> Buscando partidas...</div></div>`;

  try {
    const url = `/users/${userId}/matches?filter=${_matchesFilter}`;
    const matches = await api(url);
    const mc = $('matches-content');
    if (!mc) return;
    if (!matches.length) {
      mc.innerHTML = '<div class="empty"><i class="ti ti-sword-off"></i><p>Nenhuma partida encontrada neste filtro</p><p style="font-size:12px;color:var(--dim)">Sincronize o elo para buscar partidas</p></div>';
      return;
    }
    mc.innerHTML = `<div class="matches-list">${matches.map(m => matchCardHTML(m)).join('')}</div>`;
  } catch (err) {
    const mc = $('matches-content');
    if (mc) mc.innerHTML = '<div class="empty"><i class="ti ti-alert-circle"></i><p>Erro ao carregar partidas</p></div>';
  }
}

function matchCardHTML(m) {
  const kda       = m.deaths === 0 ? 'Perfeito' : ((m.kills + m.assists) / m.deaths).toFixed(2);
  const kdaClass  = parseFloat(kda) >= 4 ? 'kda-great' : parseFloat(kda) >= 2.5 ? 'kda-good' : 'kda-bad';
  const csMin     = m.gameDuration > 0 ? (m.cs / (m.gameDuration / 60)).toFixed(1) : '0';
  const duration  = `${Math.floor(m.gameDuration / 60)}m ${m.gameDuration % 60}s`;
  const queueName = QUEUE_LABELS[m.queueId] || m.gameMode || 'Partida';
  const champKey  = champKey2(m.champion);
  const champIcon = `https://ddragon.leagueoflegends.com/cdn/${_ddragonVersion}/img/champion/${champKey}.png`;
  const timeAgoStr = m.gameCreation ? timeAgo(new Date(m.gameCreation)) : '';

  return `<div class="match-card ${m.win ? 'match-win' : 'match-loss'}">
    <div class="match-result-bar"></div>
    <div class="match-champ">
      <img src="${champIcon}" class="match-champ-icon" onerror="this.src='/img/placeholder.png'" loading="lazy">
      <div class="match-champ-level">${m.level}</div>
    </div>
    <div class="match-main">
      <div class="match-top">
        <span class="match-result-label ${m.win ? 'win' : 'loss'}">${m.win ? 'Vitória' : 'Derrota'}</span>
        <span class="match-queue">${queueName}</span>
        <span class="match-duration">${duration}</span>
        <span class="match-time" style="margin-left:auto">${timeAgoStr}</span>
      </div>
      <div class="match-champ-name">${escapeHtml(m.champion)}</div>
      <div class="match-stats">
        <span class="match-kda-raw"><strong>${m.kills}</strong> / <span style="color:#FCA5A5">${m.deaths}</span> / <strong>${m.assists}</strong></span>
        <span class="match-kda ${kdaClass}">${kda} KDA</span>
        <span class="match-cs"><i class="ti ti-coins" style="font-size:12px"></i> ${m.cs} CS <span style="color:var(--dim)">(${csMin}/min)</span></span>
      </div>
    </div>
    <div class="match-items">
      ${m.items.slice(0, 6).map(item => item
        ? `<img src="https://ddragon.leagueoflegends.com/cdn/${_ddragonVersion}/img/item/${item}.png" class="match-item" loading="lazy" onerror="this.style.background='var(--navy)'">`
        : '<div class="match-item match-item-empty"></div>'
      ).join('')}
    </div>
  </div>`;
}

// Mapear nome do campeão para chave do DDragon
function champKey2(name) {
  const map = {
    'Aurelion Sol':'AurelionSol','Bel\'Veth':'Belveth','Cho\'Gath':'Chogath',
    'Dr. Mundo':'DrMundo','Jarvan IV':'JarvanIV','K\'Sante':'KSante',
    'Kai\'Sa':'Kaisa','Kha\'Zix':'Khazix','Kog\'Maw':'KogMaw',
    'LeBlanc':'Leblanc','Lee Sin':'LeeSin','Master Yi':'MasterYi',
    'Miss Fortune':'MissFortune','Nunu & Willump':'Nunu','Rek\'Sai':'RekSai',
    'Renata Glasc':'Renata','Tahm Kench':'TahmKench','Twisted Fate':'TwistedFate',
    'Vel\'Koz':'Velkoz','Wukong':'MonkeyKing','Xin Zhao':'XinZhao',
    'Yorick':'Yorick','Zac':'Zac'
  };
  return map[name] || name?.replace(/[^a-zA-Z0-9]/g, '') || name;
}

// ══════════════════════════════════════════════════════════════
//  MATCH DUO — Sistema de compatibilidade
// ══════════════════════════════════════════════════════════════
let _matchQueue   = [];  // fila de sugestões
let _matchIndex   = 0;   // índice atual
let _matchLoading = false;
let _matchDragging = false;
let _matchStartX   = 0;
let _matchCurrentX = 0;

async function loadMatchPage() {
  const page = $('match-page-content');
  if (!page) return;

  // Verificar se o usuário tem lane e elo configurados
  if (!me?.solo_tier && !me?.flex_tier) {
    page.innerHTML = `
      <div class="match-empty">
        <i class="ti ti-hearts" style="font-size:48px;color:var(--dim)"></i>
        <h3>Configure seu perfil primeiro</h3>
        <p>Sincronize seu elo e adicione suas lanes para encontrar duos compatíveis</p>
        <button class="btn-post" onclick="loadPage('profile')" style="margin-top:16px">
          <i class="ti ti-user"></i> Ir para o Perfil
        </button>
      </div>`;
    return;
  }

  page.innerHTML = `
    <div class="match-page-wrap">
      <!-- Abas -->
      <div class="match-page-tabs">
        <button class="match-page-tab on" id="mptab-discover" onclick="switchMatchPageTab('discover',this)">
          <i class="ti ti-sparkles"></i> Descobrir
        </button>
        <button class="match-page-tab" id="mptab-matches" onclick="switchMatchPageTab('matches',this)">
          <i class="ti ti-hearts"></i> Meus Matches
          <span class="match-page-badge" id="match-count-badge" style="display:none">0</span>
        </button>
      </div>

      <!-- Aba Descobrir -->
      <div id="match-tab-discover" class="match-tab-panel">
        <div class="match-container">
          <div class="match-info-bar">
            <span class="match-info-text"><i class="ti ti-sparkles"></i> Duos compatíveis com você</span>
            <button class="match-reload-btn" onclick="reloadMatchQueue()" title="Buscar novos">
              <i class="ti ti-refresh"></i>
            </button>
          </div>
          <div class="match-card-area" id="match-card-area">
            <div class="loading"><div class="spinner"></div> Buscando duos compatíveis...</div>
          </div>
          <div class="match-actions" id="match-actions" style="display:none">
            <button class="match-btn match-skip" onclick="swipeDuo('skip')" title="Passar">
              <i class="ti ti-x"></i>
            </button>
            <button class="match-btn match-like" onclick="swipeDuo('like')" title="Curtir!">
              <i class="ti ti-heart"></i>
            </button>
          </div>
          <div class="match-counter" id="match-counter"></div>
        </div>
      </div>

      <!-- Aba Meus Matches -->
      <div id="match-tab-matches" class="match-tab-panel" style="display:none">
        <div id="my-matches-list" class="my-matches-grid">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>
    </div>`;

  await fetchMatchQueue();
  loadMyMatches();
}

async function fetchMatchQueue() {
  _matchLoading = true;
  _matchIndex   = 0;
  _matchQueue   = [];

  const area = $('match-card-area');
  if (area) area.innerHTML = '<div class="loading"><div class="spinner"></div> Buscando duos compatíveis...</div>';

  try {
    _matchQueue = await api('/match/suggestions');
    renderMatchCard();
  } catch {
    if (area) area.innerHTML = '<div class="match-empty"><i class="ti ti-alert-circle"></i><p>Erro ao buscar sugestões</p></div>';
  }
  _matchLoading = false;
}

async function reloadMatchQueue() {
  const area = $('match-card-area');
  if (area) area.innerHTML = '<div class="loading"><div class="spinner"></div> Buscando...</div>';
  await fetchMatchQueue();
}

function renderMatchCard() {
  const area    = $('match-card-area');
  const actions = $('match-actions');
  const counter = $('match-counter');
  if (!area) return;

  if (!_matchQueue.length || _matchIndex >= _matchQueue.length) {
    area.innerHTML = `
      <div class="match-empty">
        <i class="ti ti-check" style="font-size:48px;color:var(--green)"></i>
        <h3>Você viu todos os duos disponíveis!</h3>
        <p>Volte amanhã para novas sugestões ou clique em recarregar</p>
        <button class="btn-post" onclick="reloadMatchQueue()" style="margin-top:16px">
          <i class="ti ti-refresh"></i> Buscar novamente
        </button>
      </div>`;
    if (actions) actions.style.display = 'none';
    if (counter) counter.textContent = '';
    return;
  }

  const p = _matchQueue[_matchIndex];
  if (actions) actions.style.display = 'flex';

  // Compatibilidade visual em %
  const pct     = Math.min(100, Math.round(p.score));
  const pctColor = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--gold-l)' : 'var(--muted)';
  const roles   = Array.isArray(p.roles) ? p.roles : (p.roles||'').split(',').filter(Boolean);
  const champs  = p.main_champions ? JSON.parse(p.main_champions) : [];

  area.innerHTML = `
    <div class="match-duo-card" id="match-duo-card"
         onmousedown="matchDragStart(event)"
         ontouchstart="matchDragStart(event)">

      <!-- Indicadores de swipe -->
      <div class="swipe-label like"  id="swipe-like-label"><i class="ti ti-heart"></i> DUO!</div>
      <div class="swipe-label skip"  id="swipe-skip-label"><i class="ti ti-x"></i> PASS</div>

      <!-- Avatar e capa -->
      <div class="match-card-hero" onclick="viewProfile(${p.id})">
        ${avatarHTML(p, 'av-match')}
        <div class="match-card-score" style="color:${pctColor}">
          <i class="ti ti-target"></i> ${pct}% compatível
        </div>
      </div>

      <!-- Info -->
      <div class="match-card-info">
        <div class="match-card-name" onclick="viewProfile(${p.id})" style="cursor:pointer">
          ${escapeHtml(p.display_name || p.username)}
          ${p.has_mic ? '<i class="ti ti-microphone" style="color:var(--green);font-size:14px"></i>' : ''}
          <span class="match-online-dot ${p.online_status === 'online' ? 'online' : 'offline'}"></span>
        </div>
        <div class="match-card-nick">${escapeHtml(p.lol_game_name)}#${escapeHtml(p.lol_tag_line)}</div>

        <div class="match-card-elos">
          <span class="elo ${eloClass(p.solo_tier)}">Solo ${eloLabel(p.solo_tier, p.solo_rank, p.solo_lp)}</span>
          <span class="elo ${eloClass(p.flex_tier)}">Flex ${eloLabel(p.flex_tier, p.flex_rank, p.flex_lp)}</span>
        </div>

        ${roles.length ? `<div class="match-card-roles">${roles.map(r =>
          `<span class="tag tag-solo on" style="cursor:default">${r}</span>`
        ).join('')}</div>` : ''}

        ${champs.length ? `<div class="match-card-champs">
          ${champs.slice(0, 3).map(ch => {
            const key = ch.replace(/[^a-zA-Z0-9]/g, '');
            return `<img src="https://ddragon.leagueoflegends.com/cdn/${_ddragonVersion}/img/champion/${key}.png"
                        class="match-champ-mini" title="${escapeHtml(ch)}" loading="lazy"
                        onerror="this.style.display='none'">`;
          }).join('')}
          <span style="font-size:11px;color:var(--dim);align-self:center">Campeões principais</span>
        </div>` : ''}

        ${p.bio ? `<div class="match-card-bio">"${escapeHtml(p.bio)}"</div>` : ''}
      </div>
    </div>`;

  if (counter) counter.textContent = `${_matchIndex + 1} / ${_matchQueue.length}`;

  // Inicializar drag/swipe
  initMatchDrag();
}

// ── Swipe ────────────────────────────────────────
async function swipeDuo(action) {
  const p = _matchQueue[_matchIndex];
  if (!p) return;

  const card = $('match-duo-card');
  if (card) {
    card.style.transition = 'transform .3s ease, opacity .3s';
    card.style.transform  = action === 'like' ? 'translateX(120%) rotate(20deg)' : 'translateX(-120%) rotate(-20deg)';
    card.style.opacity    = '0';
  }

  try {
    const res = await api('/match/swipe', { method:'POST', body:{ target_id: p.id, action } });
    if (action === 'like') {
      if (res.match) {
        // MATCH MÚTUO!
        showMatchAnimation(p);
        return; // animação cuida do avanço
      }
      toast(`💙 Like enviado! ${p.display_name || p.username} vai ser notificado.`);
    }
  } catch {}

  setTimeout(() => {
    _matchIndex++;
    renderMatchCard();
  }, 300);
}

// ── Drag para swipe no desktop e mobile ──────────
function initMatchDrag() {
  const card = $('match-duo-card');
  if (!card) return;
  card.addEventListener('mousemove',  matchDragMove);
  card.addEventListener('mouseup',    matchDragEnd);
  card.addEventListener('mouseleave', matchDragEnd);
  card.addEventListener('touchmove',  matchDragMove, { passive: false });
  card.addEventListener('touchend',   matchDragEnd);
}

function matchDragStart(e) {
  _matchDragging = true;
  _matchStartX   = e.touches ? e.touches[0].clientX : e.clientX;
  _matchCurrentX = _matchStartX;
  const card = $('match-duo-card');
  if (card) card.style.transition = 'none';
}

function matchDragMove(e) {
  if (!_matchDragging) return;
  e.preventDefault?.();
  _matchCurrentX = e.touches ? e.touches[0].clientX : e.clientX;
  const dx   = _matchCurrentX - _matchStartX;
  const rot  = dx * 0.08;
  const card = $('match-duo-card');
  if (!card) return;
  card.style.transform = `translateX(${dx}px) rotate(${rot}deg)`;

  // Labels de like/skip
  const likeL = $('swipe-like-label');
  const skipL = $('swipe-skip-label');
  if (dx > 40)  { if (likeL) likeL.style.opacity = Math.min(1, (dx-40)/60)+''; if (skipL) skipL.style.opacity = '0'; }
  else if (dx < -40) { if (skipL) skipL.style.opacity = Math.min(1, (-dx-40)/60)+''; if (likeL) likeL.style.opacity = '0'; }
  else { if (likeL) likeL.style.opacity = '0'; if (skipL) skipL.style.opacity = '0'; }
}

function matchDragEnd() {
  if (!_matchDragging) return;
  _matchDragging = false;
  const dx   = _matchCurrentX - _matchStartX;
  const card = $('match-duo-card');
  if (!card) return;
  card.style.transition = 'transform .2s ease';

  if (dx > 80)       swipeDuo('like');
  else if (dx < -80) swipeDuo('skip');
  else { card.style.transform = 'translateX(0) rotate(0)'; }
}

// ── Preview de Duo Like / Match ───────────────────
let _duoPreviewActor = null;

async function openDuoPreview(actorId, notifType) {
  const modal = $('duo-preview-modal');
  const body  = $('duo-preview-body');
  if (!modal || !body) return;

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  body.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    // Garantir que temos a versão do DDragon carregada
    if (!_ddragonVersion || _ddragonVersion === '14.24.1') {
      try { await fetchDDragonVersion(); } catch {}
    }

    const p = await api(`/match/profile/${actorId}`);
    _duoPreviewActor = p;

    const roles   = Array.isArray(p.roles) ? p.roles : (p.roles||'').split(',').filter(Boolean);
    let champs = [];
    try { champs = p.main_champions ? JSON.parse(p.main_champions) : []; } catch { champs = []; }
    if (!Array.isArray(champs)) champs = [];
    const isMatch = notifType === 'DUO_MATCH';

    body.innerHTML = `
      <div class="duo-preview-header ${isMatch ? 'is-match' : ''}">
        ${isMatch ? '<div class="duo-preview-match-badge"><i class="ti ti-hearts"></i> MATCH!</div>' : '<div class="duo-preview-like-badge"><i class="ti ti-heart-handshake"></i> Curtiu você</div>'}
      </div>
      <div class="duo-preview-content">
        <div class="duo-preview-av-wrap" onclick="closeDuoPreview();viewProfile(${p.id})">
          ${avatarHTML(p, 'av-match')}
        </div>
        <div class="duo-preview-name" onclick="closeDuoPreview();viewProfile(${p.id})" style="cursor:pointer">
          ${escapeHtml(p.display_name || p.username)}
          ${p.has_mic ? '<i class="ti ti-microphone" style="color:var(--green);font-size:15px"></i>' : ''}
          <span class="match-online-dot ${p.online_status==='online'?'online':'offline'}"></span>
        </div>
        <div style="font-size:13px;color:var(--dim);margin-bottom:10px">${escapeHtml(p.lol_game_name)}#${escapeHtml(p.lol_tag_line)}</div>

        <div class="duo-preview-elos">
          <span class="elo ${eloClass(p.solo_tier)}">Solo ${eloLabel(p.solo_tier,p.solo_rank,p.solo_lp)}</span>
          <span class="elo ${eloClass(p.flex_tier)}">Flex ${eloLabel(p.flex_tier,p.flex_rank,p.flex_lp)}</span>
        </div>

        ${roles.length ? `<div class="duo-preview-roles">${roles.map(r=>`<span class="tag tag-solo on" style="cursor:default">${r}</span>`).join('')}</div>` : ''}

        ${champs.length ? `<div class="duo-preview-champs">
          <span style="font-size:11px;color:var(--dim);margin-bottom:4px;display:block">Campeões principais</span>
          <div style="display:flex;gap:6px">
            ${champs.slice(0,3).map(ch=>{const k=ch.replace(/[^a-zA-Z0-9]/g,'');return `<img src="https://ddragon.leagueoflegends.com/cdn/${_ddragonVersion}/img/champion/${k}.png" class="match-champ-mini" title="${escapeHtml(ch)}" onerror="this.style.display='none'">`;}).join('')}
          </div>
        </div>` : ''}

        ${p.bio ? `<div class="match-card-bio">"${escapeHtml(p.bio)}"</div>` : ''}

        <!-- Ações -->
        <div class="duo-preview-actions">
          ${!isMatch ? `
          <button class="duo-action-heart" onclick="heartBackDuo(${p.id})" title="Curtir de volta!">
            <i class="ti ti-heart-filled"></i> Curtir de volta
          </button>` : ''}
          <button class="duo-action-add" onclick="closeDuoPreview();addFriend(${p.id},this)">
            <i class="ti ti-user-plus"></i> Adicionar
          </button>
          <button class="duo-action-dm" onclick="closeDuoPreview();openDM(${p.id},'${escapeHtml(p.username)}')">
            <i class="ti ti-message-2"></i> Mensagem
          </button>
          <button class="duo-action-profile" onclick="closeDuoPreview();viewProfile(${p.id})">
            <i class="ti ti-user"></i> Ver perfil
          </button>
        </div>
      </div>`;
  } catch (err) {
    console.error('openDuoPreview error:', err);
    body.innerHTML = `<div class="empty"><i class="ti ti-alert-circle"></i><p>Erro ao carregar perfil</p><p style="font-size:11px;color:var(--dim)">${escapeHtml(String(err?.message||err))}</p></div>`;
  }
}

function closeDuoPreview() {
  const modal = $('duo-preview-modal');
  if (modal) { modal.style.display = 'none'; document.body.style.overflow = ''; }
  _duoPreviewActor = null;
}

async function heartBackDuo(actorId) {
  try {
    await api(`/match/heart-back/${actorId}`, { method:'POST' });
    // Atualizar modal para mostrar MATCH
    const body = $('duo-preview-body');
    if (body) {
      const badge = body.querySelector('.duo-preview-like-badge');
      if (badge) {
        badge.className = 'duo-preview-match-badge';
        badge.innerHTML = '<i class="ti ti-hearts"></i> MATCH! Vocês dois se curtiram 💙';
      }
      const heartBtn = body.querySelector('.duo-action-heart');
      if (heartBtn) heartBtn.remove();
    }
    toast('💙 MATCH! Vocês dois se curtiram!');
  } catch { toast('Erro ao curtir de volta'); }
}

// Animação de match mútuo ao deslizar
function showMatchAnimation(p) {
  const area = $('match-card-area');
  if (!area) return;
  area.innerHTML = `
    <div class="match-anim-wrap">
      <div class="match-anim-hearts">💙</div>
      <div class="match-anim-title">É um MATCH!</div>
      <div class="match-anim-sub">Você e ${escapeHtml(p.display_name||p.username)} se curtiram</div>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="duo-action-dm" onclick="closeDuoAnim();openDM(${p.id},'${escapeHtml(p.username)}')">
          <i class="ti ti-message-2"></i> Mandar mensagem
        </button>
        <button class="duo-action-profile" onclick="closeDuoAnim();viewProfile(${p.id})">
          <i class="ti ti-user"></i> Ver perfil
        </button>
      </div>
      <button class="btn-outline" onclick="closeDuoAnim()" style="margin-top:12px;padding:8px 20px">
        Continuar buscando
      </button>
    </div>`;
  const actions = $('match-actions');
  if (actions) actions.style.display = 'none';
}

function closeDuoAnim() {
  _matchIndex++;
  const actions = $('match-actions');
  if (actions) actions.style.display = 'flex';
  renderMatchCard();
}

// ── Admin: Configurações ───────────────────────
async function adminResetMatches() {
  if (!confirm('Resetar TODOS os swipes do Match Duo?\n\nTodas as pessoas poderão se dar like novamente.')) return;
  try {
    await api('/admin/reset-matches', { method: 'POST' });
    const el = $('reset-match-result');
    if (el) { el.style.display = ''; setTimeout(() => el.style.display = 'none', 4000); }
    toast('✅ Matches resetados! Todos podem se dar like novamente.');
  } catch (e) { toast('Erro: ' + (e.error || 'Não foi possível resetar')); }
}

async function adminResetQueue() {
  if (!confirm('Limpar toda a fila ao vivo?')) return;
  try {
    await api('/admin/reset-queue', { method: 'POST' });
    const el = $('reset-queue-result');
    if (el) { el.style.display = ''; setTimeout(() => el.style.display = 'none', 4000); }
    toast('✅ Fila limpa!');
    if (global._io) global._io.emit('queue_update', { action: 'reset' });
  } catch (e) { toast('Erro: ' + (e.error || 'Não foi possível limpar')); }
}

// ── Meus Matches ──────────────────────────────────
let _matchPageTab = 'discover';

function switchMatchPageTab(tab, btn) {
  _matchPageTab = tab;
  document.querySelectorAll('.match-page-tab').forEach(t => t.classList.remove('on'));
  if (btn) btn.classList.add('on');
  $('match-tab-discover').style.display = tab === 'discover' ? '' : 'none';
  $('match-tab-matches').style.display  = tab === 'matches'  ? '' : 'none';
  if (tab === 'matches') loadMyMatches();
}

async function loadMyMatches() {
  const list = $('my-matches-list');
  if (!list) return;
  list.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando matches...</div>';
  try {
    const matches = await api('/match/my-matches');

    // Atualizar badge
    const badge = $('match-count-badge');
    if (badge) {
      badge.textContent   = matches.length;
      badge.style.display = matches.length > 0 ? '' : 'none';
    }

    if (!matches.length) {
      list.innerHTML = `
        <div class="match-empty" style="padding:48px 20px">
          <i class="ti ti-heart-off" style="font-size:48px;color:var(--dim)"></i>
          <h3>Nenhum match ainda</h3>
          <p>Deslize para a direita em jogadores compatíveis e aguarde eles curtirem você de volta!</p>
        </div>`;
      return;
    }

    list.innerHTML = matches.map(p => myMatchCardHTML(p)).join('');
  } catch {
    list.innerHTML = '<div class="match-empty"><p>Erro ao carregar matches</p></div>';
  }
}

function myMatchCardHTML(p) {
  let champs = [];
  try { champs = p.main_champions ? JSON.parse(p.main_champions) : []; } catch {}
  if (!Array.isArray(champs)) champs = [];
  const roles = Array.isArray(p.roles) ? p.roles : (p.roles||'').split(',').filter(Boolean);

  return `<div class="my-match-card" id="mmcard-${p.id}">
    <!-- Header com avatar e status -->
    <div class="my-match-header">
      <div onclick="viewProfile(${p.id})" style="cursor:pointer;position:relative;flex-shrink:0">
        ${avatarHTML(p, 'av-xl')}
        <span class="my-match-status-dot ${p.online_status==='online'?'online':'offline'}"></span>
      </div>
      <div class="my-match-info">
        <div class="my-match-name" onclick="viewProfile(${p.id})" style="cursor:pointer">
          ${escapeHtml(p.display_name || p.username)}
          ${p.has_mic ? '<i class="ti ti-microphone" title="Tem microfone" style="color:var(--green);font-size:14px"></i>' : ''}
        </div>
        <div class="my-match-nick">${escapeHtml(p.lol_game_name)}#${escapeHtml(p.lol_tag_line)}</div>
        <div class="my-match-elos">
          <span class="elo ${eloClass(p.solo_tier)}">Solo ${eloLabel(p.solo_tier,p.solo_rank,p.solo_lp)}</span>
          <span class="elo ${eloClass(p.flex_tier)}">Flex ${eloLabel(p.flex_tier,p.flex_rank,p.flex_lp)}</span>
        </div>
      </div>
      <button class="my-match-delete" onclick="deleteMyMatch(${p.id})" title="Remover match">
        <i class="ti ti-x"></i>
      </button>
    </div>

    <!-- Lanes -->
    ${roles.length ? `<div class="my-match-section">
      <div class="my-match-label"><i class="ti ti-sword" style="font-size:12px"></i> Lanes</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${roles.map(r => `<span class="tag tag-solo on" style="cursor:default;font-size:11px">${r}</span>`).join('')}
      </div>
    </div>` : ''}

    <!-- Campeões -->
    ${champs.length ? `<div class="my-match-section">
      <div class="my-match-label"><i class="ti ti-star" style="font-size:12px"></i> Campeões principais</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        ${champs.slice(0,5).map(ch => {
          const k = champKey2(ch);
          return `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
            <img src="https://ddragon.leagueoflegends.com/cdn/${_ddragonVersion}/img/champion/${k}.png"
                 style="width:36px;height:36px;border-radius:50%;border:2px solid var(--border)"
                 title="${escapeHtml(ch)}" onerror="this.parentElement.style.display='none'" loading="lazy">
            <span style="font-size:9px;color:var(--dim);max-width:40px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(ch)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}

    <!-- Bio -->
    ${p.bio ? `<div class="my-match-section">
      <div class="my-match-label"><i class="ti ti-quote" style="font-size:12px"></i> Sobre</div>
      <div class="my-match-bio">"${escapeHtml(p.bio)}"</div>
    </div>` : ''}

    <!-- Ações -->
    <div class="my-match-actions">
      <button class="duo-action-dm" onclick="openDM(${p.id},'${escapeHtml(p.username)}')" style="flex:1;justify-content:center">
        <i class="ti ti-message-2"></i> Mensagem
      </button>
      <button class="duo-action-add" onclick="addFriend(${p.id},this)" style="flex:1;justify-content:center">
        <i class="ti ti-user-plus"></i> Adicionar
      </button>
      <button class="duo-action-profile" onclick="viewProfile(${p.id})" style="justify-content:center;padding:9px 12px">
        <i class="ti ti-user"></i>
      </button>
    </div>
  </div>`;
}

async function deleteMyMatch(userId) {
  if (!confirm('Remover este match? Vocês poderão se ver novamente nas sugestões.')) return;
  try {
    await api(`/match/my-matches/${userId}`, { method: 'DELETE' });
    const card = $('mmcard-' + userId);
    if (card) {
      card.style.transition = 'opacity .3s, transform .3s';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.9)';
      setTimeout(() => { card.remove(); }, 300);
    }
    toast('Match removido');
  } catch { toast('Erro ao remover match'); }
}

// ── Inicialização ─────────────────────────────

// ── Inicialização ─────────────────────────────

let _queueChatPolling = false;
let _pendingQueueMsgs = []; // msgs enviadas mas ainda não confirmadas pelo poll
async function pollQueueChat() {
  if (_queueChatPolling) return;
  _queueChatPolling = true;
  try {
    const msgs = await api('/queue/chat');
    const container = $('queue-chat-msgs');
    if (!container || !msgs?.length) return;

    // Reconstruir apenas se há msgs novas
    const lastId = parseInt(container.dataset.lastId || '0');
    const newMsgs = msgs.filter(m => m.id > lastId);
    if (!newMsgs.length) return;

    const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
    const info = container.querySelector('.queue-chat-info');

    // Primeira carga: mostrar tudo
    if (!container.dataset.lastId) {
      container.innerHTML = '';
      if (info) container.appendChild(info);
      msgs.forEach(m => appendQueueChatHTTPMsg(m));
    } else {
      // Filtrar msgs que já foram exibidas optimisticamente (pendentes)
      const toAdd = newMsgs.filter(m => {
        if (m.user_id != me?.id) return true; // msg de outro: sempre adicionar
        // Verificar se é uma das minhas msgs pendentes
        const pendIdx = _pendingQueueMsgs.findIndex(p =>
          p.content === m.content && p.user_id == m.user_id
        );
        if (pendIdx !== -1) {
          // Substituir o elemento temp pelo real (trocar ID no DOM)
          const tempEl = container.querySelector(`[data-msg-id="${_pendingQueueMsgs[pendIdx].tempId}"]`);
          if (tempEl) tempEl.dataset.msgId = m.id;
          _pendingQueueMsgs.splice(pendIdx, 1);
          return false; // já está exibida
        }
        return true;
      });
      toAdd.forEach(m => appendQueueChatHTTPMsg(m));
      const hasOtherMsgs = toAdd.some(m => m.user_id != me?.id);
      if (hasOtherMsgs) playQueueSound();
    }

    container.dataset.lastId = msgs[msgs.length - 1].id;
    if (wasAtBottom || !container.dataset.lastId) container.scrollTop = container.scrollHeight;
  } catch {}
  finally { _queueChatPolling = false; }
}

function appendQueueChatHTTPMsg(m) {
  const isMe = m.user_id == me?.id;
  // Não duplicar mensagens próprias já exibidas optimisticamente
  // Verificar por conteúdo + tempo próximo
  const container = $('queue-chat-msgs');
  if (!container) return;
  const name = escapeHtml(m.display_name || m.username || '');
  const letter = (name || 'U')[0].toUpperCase();
  const avHTML = m.avatar_url
    ? `<img src="${escapeHtml(m.avatar_url)}" class="av av-sm" style="object-fit:cover">`
    : `<div class="av av-sm" style="background:var(--gold);color:var(--navy);font-weight:700">${letter}</div>`;
  const div = document.createElement('div');
  div.className = 'queue-chat-bubble' + (isMe ? ' me' : '');
  div.dataset.msgId = m.id;
  div.innerHTML = `<div class="queue-chat-av">${avHTML}</div><div class="queue-chat-body">${!isMe ? `<div class="queue-chat-name">${name}</div>` : ''}<div class="queue-chat-text">${escapeHtml(m.content)}</div></div>`;
  container.appendChild(div);
}


// ── Status personalizado ───────────────────────
const STATUS_PRESETS = [
  '🎮 Jogando ranked','😤 Tilted, não chata','🌾 Farmando flex',
  '📚 Estudando LoL','🔥 Duo ready!','☕ De boa, só farmando',
  '🎯 Subindo de elo','😴 Só uns jogos antes de dormir',
  '🏆 Modo sério hoje','🤙 Casual, sem pressão',
];

function openStatusEditor() {
  // Criar modal inline se não existir
  let modal = $('status-edit-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'status-edit-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2500;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)';
    modal.onclick = e => { if(e.target===modal) closeStatusEditor(); };
    modal.innerHTML = `
      <div style="background:var(--navy-m);border:1px solid var(--border-h);border-radius:16px;width:min(420px,92vw);padding:22px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <span style="font-family:'Rajdhani',sans-serif;font-size:17px;font-weight:700">✏️ Definir Status</span>
          <button onclick="closeStatusEditor()" style="background:none;border:none;cursor:pointer;color:var(--dim);font-size:18px"><i class="ti ti-x"></i></button>
        </div>
        <input id="status-input" maxlength="100" placeholder="O que você está fazendo agora?"
          style="width:100%;padding:10px 14px;background:var(--navy);border:1px solid var(--border-h);border-radius:10px;color:var(--text);font-size:14px;font-family:'Exo 2',sans-serif;outline:none;box-sizing:border-box;margin-bottom:14px"
          oninput="document.getElementById('status-chars').textContent=100-this.value.length">
        <div style="text-align:right;font-size:11px;color:var(--dim);margin-top:-10px;margin-bottom:14px"><span id="status-chars">100</span> caracteres restantes</div>
        <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:18px">
          ${STATUS_PRESETS.map(s => `<button onclick="document.getElementById('status-input').value='${s}';document.getElementById('status-chars').textContent=100-'${s}'.length"
            style="padding:5px 12px;border-radius:20px;border:1px solid var(--border-h);background:var(--navy-c);color:var(--muted);font-size:12px;cursor:pointer;font-family:'Exo 2',sans-serif;white-space:nowrap"
            onmouseover="this.style.borderColor='var(--gold-d)';this.style.color='var(--text)'"
            onmouseout="this.style.borderColor='var(--border-h)';this.style.color='var(--muted)'">${s}</button>`).join('')}
        </div>
        <div style="display:flex;gap:10px">
          <button onclick="saveStatus()" style="flex:1;padding:10px;border-radius:10px;background:var(--gold);color:var(--navy);border:none;font-weight:700;font-size:14px;cursor:pointer;font-family:'Exo 2',sans-serif">
            Salvar
          </button>
          <button onclick="saveStatus('')" style="padding:10px 16px;border-radius:10px;border:1px solid var(--border-h);background:none;color:var(--muted);font-size:13px;cursor:pointer;font-family:'Exo 2',sans-serif">
            Remover
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  // Preencher com status atual
  const input = $('status-input');
  if (input) {
    input.value = me?.custom_status || '';
    const chars = $('status-chars');
    if (chars) chars.textContent = 100 - input.value.length;
  }
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('status-input')?.focus(), 80);
}

function closeStatusEditor() {
  const modal = $('status-edit-modal');
  if (modal) { modal.style.display = 'none'; document.body.style.overflow = ''; }
}

async function saveStatus(val) {
  const status = val !== undefined ? val : ($('status-input')?.value.trim() || '');
  try {
    await api('/users/me', { method: 'PATCH', body: { custom_status: status || null } });
    me.custom_status = status || null;
    localStorage.setItem('duoq_me', JSON.stringify(me));
    closeStatusEditor();
    toast(status ? `✅ Status: "${status}"` : '✅ Status removido');
    loadMyProfile(); // atualizar perfil
  } catch { toast('Erro ao salvar status'); }
}

window.addEventListener('DOMContentLoaded', () => {
  if (token && me) {
    bootApp();
  } else {
    const authScreen = document.getElementById('auth-screen');
    const appScreen  = document.getElementById('app-screen');
    if (authScreen) authScreen.style.display = 'flex';
    if (appScreen)  appScreen.style.display  = 'none';
  }
});