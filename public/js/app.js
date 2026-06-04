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
  socket.on('notification',      onSocketNotif);
  socket.on('queue_update',      onQueueUpdate);
  socket.on('queue_chat_msg',    onQueueChatMsg);
  socket.on('queue_chat_history',onQueueChatHistory);
  socket.on('group_message',     onGroupMessage);
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

  if (name === 'feed')          { loadFeed(); initFeedScroll(); }
  if (name === 'explore')       loadExplore();
  if (name === 'friends')       loadFriendsPage();
  if (name === 'messages')      loadConversations();
  if (name === 'notifications') loadNotifications();
  if (name === 'profile')       loadMyProfile();
  if (name === 'groups')        loadGroupsPage();
}

// ── Feed com infinite scroll ──────────────────
let feedLoading  = false;
let feedPage     = 1;
let feedHasMore  = true;
let feedObserver = null;

async function loadFeed(reset = true) {
  if (feedLoading) return;
  if (reset) {
    feedPage    = 1;
    feedHasMore = true;
    const c = $('feed-posts');
    c.innerHTML = '<div class="loading"><div class="spinner"></div> Carregando...</div>';
  }
  if (!feedHasMore) return;
  feedLoading = true;

  const sentinel = $('feed-sentinel');
  if (sentinel && !reset) sentinel.innerHTML = '<div class="load-more-spinner"><div class="spinner"></div> Carregando mais...</div>';

  try {
    const posts = await api(`/posts?queue=${currentFilter}&limit=50&page=${feedPage}`);
    const c     = $('feed-posts');

    if (reset) c.innerHTML = '';

    if (!posts.length && feedPage === 1) {
      c.innerHTML = '<div class="empty"><i class="ti ti-mood-empty"></i><p>Nenhum post aqui ainda. Seja o primeiro!</p></div>';
      feedHasMore = false;
    } else {
      posts.forEach(p => { const d = document.createElement('div'); d.innerHTML = postHTML(p); c.appendChild(d.firstElementChild); });
      feedHasMore = posts.length === 50;
      feedPage++;
    }
  } catch (err) {
    console.error(err);
    if (feedPage === 1) $('feed-posts').innerHTML = '<div class="empty"><i class="ti ti-alert-circle"></i><p>Erro ao carregar posts</p></div>';
  } finally {
    feedLoading = false;
    const sentinel = $('feed-sentinel');
    if (sentinel) sentinel.innerHTML = feedHasMore ? '' : '<div style="text-align:center;padding:12px;font-size:12px;color:var(--dim)">Todos os posts carregados</div>';
  }
}

function initFeedScroll() {
  if (feedObserver) feedObserver.disconnect();
  const sentinel = $('feed-sentinel');
  if (!sentinel) return;
  feedObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && feedHasMore && !feedLoading) {
      loadFeed(false);
    }
  }, { threshold: 0.1 });
  feedObserver.observe(sentinel);
}