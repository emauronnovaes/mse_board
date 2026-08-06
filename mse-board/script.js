let hoveredCardId = null;
let currentUserName = null;
let currentView = 'kanban';
let isObserver = false;
let currentCalendarMonth = new Date();

// ==========================================
// CONEXÃO COM O BACKEND (PHP + MySQL)
// ==========================================
// Estes valores vêm do arquivo .env do backend, entregues por config.js.php
// (window.APP_CONFIG). Inclua <script src="config.js.php"></script> ANTES deste
// arquivo no HTML. O fallback abaixo só serve caso o config.js.php não carregue.
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || 'http://localhost/mse_board/mse-backend/api';

// Chave da API — a MESMA definida no .env (API_SECRET). Vem via window.APP_CONFIG.
const API_SECRET = (window.APP_CONFIG && window.APP_CONFIG.API_SECRET) || '';

async function fetchBoardStateFromServer() {
    try {
        const res = await fetch(`${API_BASE}/get_state.php`, {
            headers: { 'X-API-Key': API_SECRET }
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        return text ? JSON.parse(text) : {};
    } catch (err) {
        console.error('Não foi possível buscar do servidor MySQL:', err);
        return null; // null = falha; quem chamar decide se usa uma cópia local de reserva
    }
}

async function saveBoardStateToServer(obj) {
    try {
        // Não manda pessoas/post-its no blob — eles agora moram nas tabelas próprias
        const { people, cards, ...rest } = obj;
        await fetch(`${API_BASE}/save_state.php`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_SECRET
            },
            body: JSON.stringify(rest)
        });
        return true;
    } catch (err) {
        console.error('Não foi possível salvar no servidor MySQL:', err);
        return false;
    }
}

// ==========================================
// API: PESSOAS E POST-ITS (tabelas de verdade)
// ==========================================

async function apiCall(endpoint, body) {
    try {
        const res = await fetch(`${API_BASE}/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_SECRET
            },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
    } catch (err) {
        console.error(`Falha ao chamar ${endpoint}:`, err);
        if (typeof logError === 'function') {
            logError(
                `Falha ao sincronizar com o servidor (${endpoint})`,
                'Verifique se o Apache e o MySQL estão ligados no XAMPP. Suas alterações ficaram só neste navegador até a conexão voltar.'
            );
        }
        return null;
    }
}

async function fetchPeopleFromServer() {
    try {
        const res = await fetch(`${API_BASE}/get_people.php`, { headers: { 'X-API-Key': API_SECRET } });
        const text = await res.text();
        if (!res.ok) {
            let details = text;
            try { details = JSON.parse(text).details || JSON.parse(text).error || text; } catch (e) {}
            throw new Error(`HTTP ${res.status} — ${details}`);
        }
        return JSON.parse(text);
    } catch (err) {
        console.error('Não foi possível buscar pessoas do servidor:', err.message || err);
        return null;
    }
}

async function fetchCardsFromServer() {
    try {
        const res = await fetch(`${API_BASE}/get_cards.php`, { headers: { 'X-API-Key': API_SECRET } });
        const text = await res.text();
        if (!res.ok) {
            let details = text;
            try { details = JSON.parse(text).details || JSON.parse(text).error || text; } catch (e) {}
            throw new Error(`HTTP ${res.status} — ${details}`);
        }
        return JSON.parse(text);
    } catch (err) {
        console.error('Não foi possível buscar post-its do servidor:', err.message || err);
        return null;
    }
}

function savePersonToServer(person) { return apiCall('save_person.php', person); }
function deletePersonFromServer(id) { return apiCall('delete_person.php', { id }); }

// Mesma proteção dos post-its, agora pras pessoas/colunas: se salvar falhar,
// tenta de novo sozinho e nunca deixa a sincronização automática sobrescrever
// ou apagar uma coluna que ainda não confirmou salvar no servidor.
const pendingPersonSaves = new Set();

async function persistPerson(person, attempt = 1) {
    pendingPersonSaves.add(person.id);
    const ok = await savePersonToServer(person);

    if (ok) {
        pendingPersonSaves.delete(person.id);
        return true;
    }

    if (attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
        return persistPerson(person, attempt + 1);
    }

    if (typeof logError === 'function') {
        logError(
            `Não foi possível salvar a coluna "${person.name}" no servidor depois de várias tentativas.`,
            'Verifique sua internet/conexão com o servidor. O sistema vai continuar tentando salvar sozinho.'
        );
    }
    return false;
}

async function retryPendingPersonSaves() {
    if (pendingPersonSaves.size === 0) return;
    for (const id of Array.from(pendingPersonSaves)) {
        const person = state.people.find(p => p.id === id);
        if (person) persistPerson(person);
        else pendingPersonSaves.delete(id);
    }
}

// Pessoas/colunas excluídas na tela mas que ainda não confirmaram a exclusão
// no servidor — protege contra a coluna "ressuscitar" sozinha se a exclusão falhar.
const pendingPersonDeletes = new Set();

async function persistPersonDelete(personId, attempt = 1) {
    const ok = await deletePersonFromServer(personId);
    if (ok) {
        pendingPersonDeletes.delete(personId);
        return true;
    }
    if (attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
        return persistPersonDelete(personId, attempt + 1);
    }
    if (typeof logError === 'function') {
        logError(
            'Não foi possível confirmar a exclusão de uma coluna no servidor.',
            'Verifique sua internet/conexão. O sistema vai tentar excluir de novo sozinho.'
        );
    }
    return false;
}

async function retryPendingPersonDeletes() {
    if (pendingPersonDeletes.size === 0) return;
    for (const id of Array.from(pendingPersonDeletes)) {
        persistPersonDelete(id);
    }
}

function saveCardToServer(card) { return apiCall('save_card.php', card); }

// Post-its com um salvamento em andamento ou que falhou e está sendo tentado de
// novo. Enquanto o id estiver aqui, a sincronização automática NUNCA sobrescreve
// esse post-it com a versão do servidor — sem isso, se o salvamento falhasse
// (rede instável, servidor lento) e a sincronização automática rodasse logo
// depois (a cada 6s), o post-it sumia ou voltava como estava antes, sem aviso.
const pendingCardSaves = new Set();

async function persistCard(card, attempt = 1) {
    pendingCardSaves.add(card.id);
    const ok = await saveCardToServer(card);

    if (ok) {
        pendingCardSaves.delete(card.id);
        return true;
    }

    if (attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
        return persistCard(card, attempt + 1);
    }

    // Falhou depois de várias tentativas: mantém marcado como pendente (protege
    // contra sumir na próxima sincronização) e avisa de forma bem visível.
    // A sincronização automática vai continuar tentando salvar sozinha.
    if (typeof logError === 'function') {
        logError(
            `Não foi possível salvar "${card.title}" no servidor depois de várias tentativas.`,
            'Verifique sua internet/conexão com o servidor. O sistema vai continuar tentando salvar sozinho — não fecha essa aba até confirmar.'
        );
    }
    return false;
}

// Tenta salvar de novo qualquer post-it que ainda esteja pendente (falhou antes).
// Chamado a cada ciclo da sincronização automática.
async function retryPendingCardSaves() {
    if (pendingCardSaves.size === 0) return;
    const idsToRetry = Array.from(pendingCardSaves);
    for (const id of idsToRetry) {
        const card = state.cards.find(c => c.id === id);
        if (card) persistCard(card);
        else pendingCardSaves.delete(id); // o post-it não existe mais localmente (foi excluído)
    }
}

// Move um post-it no servidor com o mesmo esquema de proteção: se falhar, marca
// como pendente (protege de "voltar" pro lugar antigo na próxima sincronização)
// e deixa o retryPendingCardSaves tentar de novo sozinho depois (usando o
// salvamento completo, que também grava a coluna/status atual).
async function persistCardMove(cardId, personId, status, completedAt) {
    pendingCardSaves.add(cardId);
    const ok = await moveCardOnServer(cardId, personId, status, completedAt);
    if (ok) {
        pendingCardSaves.delete(cardId);
        return true;
    }
    if (typeof logError === 'function') {
        logError(
            'Não foi possível confirmar a movimentação de um post-it no servidor.',
            'Verifique sua internet/conexão. O sistema vai tentar salvar de novo sozinho.'
        );
    }
    return false;
}
function deleteCardFromServer(id) { return apiCall('delete_card.php', { id }); }
function moveCardOnServer(id, personId, status, completedAt) { return apiCall('move_card.php', { id, personId, status, completedAt }); }
function reorderPeopleOnServer(orderedIds) { return apiCall('reorder_people.php', { order: orderedIds }); }
function toggleChecklistItemOnServer(cardId, itemIndex) { return apiCall('toggle_checklist_item.php', { cardId, itemIndex }); }
function addCommentOnServer(cardId, author, text) { return apiCall('add_comment.php', { cardId, author, text }); }

// Marcar um item de checklist e comentar são mudanças pequenas dentro de um
// post-it, mas usam endpoints próprios — se falharem, protege do mesmo jeito
// (marca o post-it como pendente, o que impede a sincronização automática de
// sobrescrever, e deixa o retryPendingCardSaves recuperar depois com um
// salvamento completo, que já leva o checklist/comentário atual).
async function persistChecklistToggle(cardId, itemIndex, attempt = 1) {
    pendingCardSaves.add(cardId);
    const ok = await toggleChecklistItemOnServer(cardId, itemIndex);
    if (ok) {
        pendingCardSaves.delete(cardId);
        return true;
    }
    if (attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
        return persistChecklistToggle(cardId, itemIndex, attempt + 1);
    }
    return false; // fica pendente; retryPendingCardSaves tenta de novo com o post-it inteiro
}

async function persistComment(cardId, author, text, attempt = 1) {
    pendingCardSaves.add(cardId);
    const ok = await addCommentOnServer(cardId, author, text);
    if (ok) {
        pendingCardSaves.delete(cardId);
        return true;
    }
    if (attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
        return persistComment(cardId, author, text, attempt + 1);
    }
    return false; // fica pendente; retryPendingCardSaves tenta de novo com o post-it inteiro
}

async function sha256Hex(str) {
    const data = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSalt() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPasswordWithSalt(password, salt) {
    const hash = await sha256Hex(`${salt}:${password}`);
    return `${salt}:${hash}`;
}

async function verifyPassword(password, storedHash) {
    if (!storedHash) return false;

    if (storedHash.includes(':')) {
        const [salt] = storedHash.split(':');
        const recomputed = await hashPasswordWithSalt(password, salt);
        return recomputed === storedHash;
    }

    // Formato antigo (sem sal, de antes dessa proteção existir) — ainda aceita,
    // pra não travar contas que já tinham senha salva.
    const legacyHash = await sha256Hex(password);
    return legacyHash === storedHash;
}

// Conta admin fixa: admin@mse.com.br / admin123 (hash salgado pré-calculado)
const BOOTSTRAP_ADMIN_EMAIL = 'admin@mse.com.br';
const BOOTSTRAP_ADMIN_PASSWORD_HASH = 'e8eda0d35f19623f:b087c63fcb3b0a7b5c32e7ce04ff85f58df14c514cf1068392cb92e007b3bf82';

async function ensureBootstrapAdmin() {
    let boardState = await fetchBoardStateFromServer();
    if (boardState === null) {
        // Servidor fora do ar — usa a cópia local só pra não travar a tela de login
        const raw = localStorage.getItem('mse_board_state');
        boardState = raw ? JSON.parse(raw) : {};
    }
    if (!boardState.members) boardState.members = {};
    if (!boardState.userPasswords) boardState.userPasswords = {};
    if (!boardState.knownUsers) boardState.knownUsers = [];

    let changed = false;

    if (!boardState.members[BOOTSTRAP_ADMIN_EMAIL]) {
        boardState.members[BOOTSTRAP_ADMIN_EMAIL] = 'Admin';
        boardState.userPasswords[BOOTSTRAP_ADMIN_EMAIL] = BOOTSTRAP_ADMIN_PASSWORD_HASH;
        changed = true;
    }
    if (!boardState.knownUsers.includes(BOOTSTRAP_ADMIN_EMAIL)) {
        boardState.knownUsers.push(BOOTSTRAP_ADMIN_EMAIL);
        changed = true;
    }

    if (changed) {
        await saveBoardStateToServer(boardState);
        localStorage.setItem('mse_board_state', JSON.stringify(boardState));
    }
}

// ==========================================
// SSO — login herdado do Portal MSE (via iframe com ?sso=<token>)
// ==========================================

// Mostra o login manual (some com o "Entrando…"). Só é chamado quando o SSO
// não entrou: assim a tela de login é apenas a segunda alternativa.
function revelarLoginManual() {
    const loader = document.getElementById('ssoLoading');
    if (loader) loader.style.display = 'none';
    const card = document.getElementById('loginCard');
    if (card) card.style.display = '';
}

function ssoMensagemDeErro(reason) {
    switch (reason) {
        case 'sem_acesso':
            return 'Seu acesso ao quadro ainda não foi liberado. Peça ao administrador do MSE Board para incluir o seu e-mail.';
        case 'expirado':
        case 'futuro':
            return 'O acesso automático expirou. Volte ao portal e abra o quadro novamente.';
        case 'assinatura':
        case 'formato':
        case 'payload':
            return 'Não foi possível validar o acesso automático (token inválido). Faça login normalmente.';
        case 'config':
            return 'O acesso automático não está configurado no servidor. Avise o administrador.';
        default:
            return 'Não foi possível herdar o login do portal. Faça login normalmente.';
    }
}

// Tenta usar o token ?sso=<token> para entrar sem senha.
// Retorna:
//   'none'         quando não há token na URL
//   'redirecting'  quando já vai navegar (parar o fluxo atual)
//   'ok'           login herdado com sucesso e já estamos na página do quadro
//   'error'        token presente mas inválido/sem acesso
async function tryInheritLoginFromSso() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('sso');
    if (!token) return 'none';

    // Remove o token da URL para não ficar no histórico nem ser reutilizado
    params.delete('sso');
    const query = params.toString();
    const cleanUrl = window.location.pathname + (query ? '?' + query : '') + window.location.hash;

    try {
        const res = await fetch(`${API_BASE}/sso_login.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const data = await res.json().catch(() => null);

        if (res.ok && data && data.ok) {
            localStorage.setItem('mse_user', JSON.stringify({
                id: 'sso_' + Date.now(),
                name: data.email,
                role: data.role,
                via: 'sso'
            }));

            // Estamos na tela de login? Então vamos direto pro quadro.
            if (document.getElementById('loginForm')) {
                window.location.replace('board.html');
                return 'redirecting';
            }
            // Já estamos no quadro: só limpa a URL e segue o fluxo normal.
            history.replaceState(null, '', cleanUrl);
            return 'ok';
        }

        // Token presente mas recusado
        const reason = (data && data.reason) || 'desconhecido';
        sessionStorage.setItem('mse_sso_error', reason);
        history.replaceState(null, '', cleanUrl);
        return 'error';
    } catch (err) {
        console.error('Falha no SSO:', err);
        sessionStorage.setItem('mse_sso_error', 'rede');
        history.replaceState(null, '', cleanUrl);
        return 'error';
    }
}

window.addEventListener('error', (e) => {
    console.error('Erro capturado:', e.error || e.message);
    if (typeof state !== 'undefined' && state && state.errorLog) {
        logError(
            'Erro inesperado: ' + (e.message || 'desconhecido'),
            'Tente recarregar a página. Se continuar acontecendo, avise quem administra o quadro.'
        );
    }
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Promise rejeitada:', e.reason);
    if (typeof state !== 'undefined' && state && state.errorLog) {
        logError(
            'Falha em uma operação: ' + ((e.reason && e.reason.message) || 'erro desconhecido'),
            'Tente novamente. Se persistir, recarregue a página.'
        );
    }
});

document.addEventListener('DOMContentLoaded', async () => {

    // SSO: se veio ?sso=<token> do portal, tenta herdar o login antes de tudo.
    const ssoResultado = await tryInheritLoginFromSso();
    if (ssoResultado === 'redirecting') return; // vai navegar pro quadro; para aqui

    await ensureBootstrapAdmin();

    const loginForm = document.getElementById('loginForm');
    const boardContainer = document.querySelector('.board-container');

    // ==========================================
    // 1. TELA DE LOGIN
    // ==========================================
    if (loginForm) {
        let isSignupMode = false;

        // Já existe uma sessão ativa? Então não precisa mostrar login: vai pro quadro.
        let sessaoAtual = null;
        try { sessaoAtual = JSON.parse(localStorage.getItem('mse_user')); } catch (e) {}
        if (sessaoAtual && sessaoAtual.name) {
            window.location.replace('board.html');
            return;
        }

        // Chegamos aqui = o SSO não entrou (sem token, inválido ou sem acesso).
        // Só agora revelamos o login manual, como segunda alternativa.
        revelarLoginManual();

        const rememberedRaw = localStorage.getItem('mse_remembered_creds');
        if (rememberedRaw) {
            try {
                const remembered = JSON.parse(rememberedRaw);
                document.getElementById('username').value = remembered.email;
                document.getElementById('password').value = remembered.password;
                document.getElementById('rememberMe').checked = true;
            } catch (err) {
                localStorage.removeItem('mse_remembered_creds');
            }
        }

        // Se o acesso automático (SSO) falhou, mostra o motivo aqui na tela de login.
        const ssoErro = sessionStorage.getItem('mse_sso_error');
        if (ssoErro) {
            sessionStorage.removeItem('mse_sso_error');
            const msgEl = document.getElementById('loginMessage');
            if (msgEl) {
                msgEl.textContent = ssoMensagemDeErro(ssoErro);
                msgEl.className = 'login-message is-error';
                msgEl.style.display = 'block';
            }
        }

        document.getElementById('toggleModeBtn').addEventListener('click', () => {
            isSignupMode = !isSignupMode;
            document.getElementById('confirmPasswordGroup').style.display = isSignupMode ? 'flex' : 'none';
            document.getElementById('confirmPassword').required = isSignupMode;
            document.getElementById('forgotPasswordBtn').style.display = isSignupMode ? 'none' : 'block';
            document.getElementById('loginSubmitBtn').textContent = isSignupMode ? 'Criar Conta' : 'Entrar no Sistema';
            document.getElementById('toggleModeText').textContent = isSignupMode ? 'Já tem conta?' : 'Ainda não tem conta?';
            document.getElementById('toggleModeBtn').textContent = isSignupMode ? 'Entrar' : 'Criar conta';
            document.getElementById('loginMessage').style.display = 'none';
        });

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('username').value.trim().toLowerCase();
            const password = document.getElementById('password').value;
            const msgEl = document.getElementById('loginMessage');
            msgEl.style.display = 'none';
            msgEl.className = 'login-message';

            if (!/^[^\s@]+@mse\.com\.br$/.test(email)) {
                msgEl.textContent = 'Use seu e-mail corporativo (@mse.com.br) para entrar.';
                msgEl.classList.add('is-error');
                msgEl.style.display = 'block';
                return;
            }

            const boardState = await fetchBoardStateFromServer();
            if (boardState === null) {
                msgEl.textContent = 'Não foi possível conectar ao servidor (XAMPP/MySQL). Verifique se o Apache e o MySQL estão ligados.';
                msgEl.classList.add('is-error');
                msgEl.style.display = 'block';
                return;
            }
            const isBrandNewBoard = !boardState.members;
            if (!boardState.members) boardState.members = {};
            if (!boardState.pendingApprovals) boardState.pendingApprovals = [];
            if (!boardState.userPasswords) boardState.userPasswords = {};
            if (!boardState.loginAttempts) boardState.loginAttempts = {};

            const accountExists = !!boardState.userPasswords[email];

            // Bloqueio após muitas tentativas erradas
            const attemptInfo = boardState.loginAttempts[email];
            if (!isSignupMode && attemptInfo && attemptInfo.lockedUntil && Date.now() < attemptInfo.lockedUntil) {
                const minutesLeft = Math.ceil((attemptInfo.lockedUntil - Date.now()) / 60000);
                msgEl.textContent = `Muitas tentativas erradas. Tente novamente em ${minutesLeft} minuto${minutesLeft > 1 ? 's' : ''}.`;
                msgEl.classList.add('is-error');
                msgEl.style.display = 'block';
                return;
            }

            if (isSignupMode) {
                // ===== CRIAR CONTA =====
                if (accountExists) {
                    msgEl.textContent = 'Já existe uma conta com esse e-mail. Clique em "Entrar" em vez de criar conta.';
                    msgEl.classList.add('is-error');
                    msgEl.style.display = 'block';
                    return;
                }

                const confirmPassword = document.getElementById('confirmPassword').value;
                if (password !== confirmPassword) {
                    msgEl.textContent = 'As senhas não coincidem.';
                    msgEl.classList.add('is-error');
                    msgEl.style.display = 'block';
                    return;
                }
                if (password.length < 6) {
                    msgEl.textContent = 'Use uma senha com pelo menos 6 caracteres.';
                    msgEl.classList.add('is-error');
                    msgEl.style.display = 'block';
                    return;
                }

                const salt = generateSalt();
                boardState.userPasswords[email] = await hashPasswordWithSalt(password, salt);
            } else {
                // ===== ENTRAR =====
                if (!accountExists) {
                    msgEl.textContent = 'Não existe conta com esse e-mail ainda. Clique em "Criar conta" abaixo.';
                    msgEl.classList.add('is-error');
                    msgEl.style.display = 'block';
                    return;
                }

                const passwordOk = await verifyPassword(password, boardState.userPasswords[email]);
                if (!passwordOk) {
                    const prev = boardState.loginAttempts[email] || { count: 0 };
                    prev.count = (prev.count || 0) + 1;
                    if (prev.count >= 5) {
                        prev.lockedUntil = Date.now() + 15 * 60 * 1000; // 15 minutos
                        prev.count = 0;
                    }
                    boardState.loginAttempts[email] = prev;
                    await saveBoardStateToServer(boardState);

                    msgEl.textContent = prev.lockedUntil && Date.now() < prev.lockedUntil
                        ? 'Muitas tentativas erradas. Conta bloqueada por 15 minutos.'
                        : 'Senha incorreta.';
                    msgEl.classList.add('is-error');
                    msgEl.style.display = 'block';
                    return;
                }

                // Login certo: zera o contador de tentativas
                delete boardState.loginAttempts[email];

                // Se a senha salva ainda era do formato antigo (sem sal), atualiza pro novo formato agora
                if (!boardState.userPasswords[email].includes(':')) {
                    const salt = generateSalt();
                    boardState.userPasswords[email] = await hashPasswordWithSalt(password, salt);
                }
            }

            // Lembrar senha (ou esquecer, se desmarcado)
            if (document.getElementById('rememberMe').checked) {
                localStorage.setItem('mse_remembered_creds', JSON.stringify({ email, password }));
            } else {
                localStorage.removeItem('mse_remembered_creds');
            }

            // Já aprovado: entra direto
            if (boardState.members[email]) {
                await saveBoardStateToServer(boardState);
                localStorage.setItem('mse_user', JSON.stringify({
                    id: 'usr_' + Date.now(),
                    name: email,
                    role: boardState.members[email] === 'Admin' ? 'Admin' : 'Membro'
                }));
                window.location.href = 'board.html';
                return;
            }

            // Primeiro acesso de todos (quadro nunca usado antes): vira Admin automaticamente
            if (isBrandNewBoard) {
                boardState.members[email] = 'Admin';
                await saveBoardStateToServer(boardState);
                localStorage.setItem('mse_user', JSON.stringify({
                    id: 'usr_' + Date.now(),
                    name: email,
                    role: 'Admin'
                }));
                window.location.href = 'board.html';
                return;
            }

            // Conta existe (ou acabou de ser criada) mas ainda não foi aprovada pelo Admin
            if (!boardState.pendingApprovals.includes(email)) {
                boardState.pendingApprovals.push(email);
            }
            await saveBoardStateToServer(boardState);

            msgEl.textContent = isSignupMode
                ? 'Conta criada! Agora é só aguardar a aprovação do administrador para acessar o quadro.'
                : 'Sua conta ainda está aguardando aprovação do administrador.';
            msgEl.classList.add('is-pending');
            msgEl.style.display = 'block';
        });

        document.getElementById('forgotPasswordBtn').addEventListener('click', async () => {
            const email = document.getElementById('username').value.trim().toLowerCase();
            const msgEl = document.getElementById('loginMessage');
            msgEl.style.display = 'none';
            msgEl.className = 'login-message';

            if (!/^[^\s@]+@mse\.com\.br$/.test(email)) {
                msgEl.textContent = 'Digite seu e-mail @mse.com.br no campo acima antes de solicitar a redefinição.';
                msgEl.classList.add('is-error');
                msgEl.style.display = 'block';
                return;
            }

            const boardState = await fetchBoardStateFromServer();
            if (boardState === null) {
                msgEl.textContent = 'Não foi possível conectar ao servidor (XAMPP/MySQL). Verifique se está tudo ligado.';
                msgEl.classList.add('is-error');
                msgEl.style.display = 'block';
                return;
            }
            if (!boardState.passwordResetRequests) boardState.passwordResetRequests = [];

            if (!boardState.passwordResetRequests.includes(email)) {
                boardState.passwordResetRequests.push(email);
                await saveBoardStateToServer(boardState);
            }

            msgEl.textContent = 'Pedido de redefinição enviado ao administrador. Assim que ele liberar, você poderá definir uma nova senha no próximo login.';
            msgEl.classList.add('is-pending');
            msgEl.style.display = 'block';
        });
    }

    // ==========================================
    // 2. TELA DO QUADRO
    // ==========================================
    if (boardContainer) {
        const userData = JSON.parse(localStorage.getItem('mse_user'));

        if (!userData) {
            document.body.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:center; height:100vh; text-align:center; font-family:'IBM Plex Sans', sans-serif; padding:2rem;">
                    <div>
                        <h2 style="margin-bottom:0.8rem;">Acesso não autorizado</h2>
                        <p style="color:#666; max-width:420px;">Esta página só pode ser acessada através do Portal MSE. Volte ao portal e clique novamente no MSE Board.</p>
                    </div>
                </div>
            `;
            return;
        }

        document.getElementById('userNameDisplay').textContent = userData.name;
        const userBadge = document.getElementById('userBadge');
        userBadge.textContent = userData.role;
        userBadge.classList.add(userData.role === 'Admin' ? 'badge-admin' : 'badge-membro');

        currentUserName = userData.name;

        // Botão de acesso ao login manual — só aparece pro Matheus.
        // Pra qualquer outro usuário, o botão nem existe no DOM.
        const hiddenLoginAccessEl = document.querySelector('.matheus-admin-access-btn');
        if (hiddenLoginAccessEl) {
            if (userData.name === 'matheus.batista@mse.com.br') {
                hiddenLoginAccessEl.style.display = 'block';
            } else {
                hiddenLoginAccessEl.remove();
            }
        }

        // Itens do menu (Campos Personalizados, Integrações e Webhooks,
        // Backup & Exportação, Importar do Trello, Backup no Servidor) —
        // visíveis só pro admin@mse.com.br. Pra qualquer outro usuário
        // (mesmo Admin), o item nem existe no DOM.
        if (userData.name === 'admin@mse.com.br') {
            document.querySelectorAll('.admin-only-nav-item').forEach(item => {
                item.style.display = 'flex';
            });
        } else {
            document.querySelectorAll('.admin-only-nav-item').forEach(item => item.remove());
        }

        // Rodapé do menu lateral
        document.getElementById('sidebarFootName').textContent = userData.name;
        document.getElementById('sidebarFootRole').textContent = userData.role;
        document.getElementById('sidebarFootAvatar').innerHTML = `<img src="${getAvatarUrl(userData.name, 68)}" alt="${escapeHtml(userData.name)}" style="width:100%; height:100%; object-fit:cover; border-radius:inherit;">`;

        document.getElementById('sidebarFootAvatar').addEventListener('click', () => {
            document.getElementById('myAvatarFileInput').click();
        });

        document.getElementById('myAvatarFileInput').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const dataUrl = await processSingleFile(file);
            setCustomAvatar(currentUserName, dataUrl);
            e.target.value = '';
            showToast('Sua foto de perfil foi atualizada!', 'success');
        });

        // Toggle do menu lateral
        document.getElementById('sidebarToggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('is-collapsed');
            // Ao mudar a largura da sidebar, o espaço visível do quadro muda —
            // sem resetar a rolagem, sobrava um pedacinho cortado de coluna
            // "espremido" entre a sidebar e a primeira coluna visível.
            const peopleGridEl = document.getElementById('peopleGrid');
            if (peopleGridEl) peopleGridEl.scrollLeft = 0;
        });

        // Menu lateral em telas pequenas: vira uma gaveta (some por padrão, abre com o hambúrguer)
        const sidebarEl = document.getElementById('sidebar');
        const sidebarBackdropEl = document.getElementById('sidebarBackdrop');
        const openMobileSidebar = () => {
            sidebarEl.classList.add('is-mobile-open');
        };
        const closeMobileSidebar = () => {
            sidebarEl.classList.remove('is-mobile-open');
        };
        document.getElementById('mobileSidebarToggle').addEventListener('click', openMobileSidebar);
        sidebarBackdropEl.addEventListener('click', closeMobileSidebar);

        // Ações do menu lateral
        document.querySelectorAll('.nav-item[data-action]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                closeMobileSidebar();
                const action = item.dataset.action;

                if (action === 'settings') {
                    document.getElementById('unsplashKeyInput').value = localStorage.getItem('mse_unsplash_key') || '';
                    document.getElementById('bgPhotoInput').value = '';
                    document.getElementById('settingsModal').style.display = 'flex';
                } else if (action === 'export') {
                    exportBoardData();
                } else if (action === 'import-trello') {
                    if (getMemberRole(currentUserName) !== 'Admin') {
                        showToast('Somente administradores podem importar dados do Trello.');
                    } else {
                        document.getElementById('trelloImportFile').value = '';
                        document.getElementById('trelloImportProgress').textContent = '';
                        document.getElementById('importTrelloModal').style.display = 'flex';
                    }
                } else if (action === 'server-backup') {
                    if (getMemberRole(currentUserName) !== 'Admin') {
                        showToast('Somente administradores podem gerenciar backups no servidor.');
                    } else {
                        renderBackupsList();
                        document.getElementById('serverBackupModal').style.display = 'flex';
                    }
                } else if (action === 'views') {
                    openViewsModal();
                } else if (action === 'members') {
                    if (getMemberRole(currentUserName) !== 'Admin') {
                        showToast('Somente administradores podem gerenciar membros.');
                    } else {
                        renderMembersList();
                        renderPendingApprovalsList();
                        renderPasswordResetList();
                        document.getElementById('membersModal').style.display = 'flex';
                    }
                } else if (action === 'automation') {
                    document.getElementById('autoMoveToggle').checked = !!state.settings.autoMoveOnComplete;
                    document.getElementById('automationModal').style.display = 'flex';
                } else if (action === 'fields') {
                    renderFieldsList();
                    document.getElementById('fieldsModal').style.display = 'flex';
                } else if (action === 'analytics') {
                    renderAnalytics();
                    document.getElementById('analyticsModal').style.display = 'flex';
                } else if (action === 'audit') {
                    renderAuditList();
                    document.getElementById('auditModal').style.display = 'flex';
                } else if (action === 'webhooks') {
                    document.getElementById('webhookUrlInput').value = localStorage.getItem('mse_webhook_url') || '';
                    document.getElementById('webhooksModal').style.display = 'flex';
                } else if (action === 'errors') {
                    renderErrorLogList();
                    document.getElementById('errorLogModal').style.display = 'flex';
                } else if (action === 'delivery-report') {
                    currentReportPeriod = 'day';
                    document.querySelectorAll('.report-period-btn').forEach(b => b.classList.toggle('is-current', b.dataset.period === 'day'));
                    renderDeliveryReport();
                    document.getElementById('deliveryReportModal').style.display = 'flex';
                } else if (action === 'due-alerts') {
                    renderDueAlertsList();
                    document.getElementById('dueAlertsModal').style.display = 'flex';
                } else if (action === 'preferences') {
                    openPreferencesModal();
                } else if (action === 'presentation') {
                    enterPresentationMode();
                } else if (action === 'trash') {
                    renderTrashList();
                    document.getElementById('trashModal').style.display = 'flex';
                } else if (action === 'templates') {
                    renderTemplatesList();
                    document.getElementById('templatesModal').style.display = 'flex';
                } else if (action === 'labels') {
                    renderLabelsList();
                    document.getElementById('labelsModal').style.display = 'flex';
                }
            });
        });

        document.getElementById('exitPresentationBtn').addEventListener('click', exitPresentationMode);

        // Chat / Mensagens Privadas
        document.getElementById('chatToggleBtn').addEventListener('click', () => {
            const panel = document.getElementById('chatPanel');
            const isOpen = panel.style.display === 'flex';
            if (isOpen) {
                panel.style.display = 'none';
            } else {
                renderChatChannelOptions();
                renderChatMessages();
                panel.style.display = 'flex';
                document.getElementById('chatUnreadBadge').style.display = 'none';
            }
        });

        document.getElementById('closeChatPanelBtn').addEventListener('click', () => {
            document.getElementById('chatPanel').style.display = 'none';
        });

        document.getElementById('chatChannelSelect').addEventListener('change', renderChatMessages);

        // Usuários do Quadro
        document.getElementById('onlineUsersBtn').addEventListener('click', () => {
            renderUsersList();
            document.getElementById('deleteAllUsersBtn').style.display =
                getMemberRole(currentUserName) === 'Admin' ? 'block' : 'none';
            document.getElementById('usersModal').style.display = 'flex';
        });

        document.getElementById('closeUsersModalBtn').addEventListener('click', () => {
            document.getElementById('usersModal').style.display = 'none';
        });

        document.getElementById('deleteAllUsersBtn').addEventListener('click', () => {
            const others = (state.knownUsers || []).filter(u => u !== currentUserName);
            if (others.length === 0) {
                showToast('Não há outras pessoas para excluir.');
                return;
            }

            showConfirm(`Excluir TODAS as ${others.length} outras pessoas deste quadro? Elas perdem o acesso imediatamente. Essa ação não pode ser desfeita.`, () => {
                others.forEach(email => {
                    delete state.members[email];
                    delete state.customAvatars[email];
                    delete state.userPasswords[email];
                });
                state.knownUsers = state.knownUsers.filter(u => u === currentUserName);
                saveState();
                logAudit(`Excluiu todas as outras pessoas do quadro (${others.length})`);
                renderUsersList();
                renderOnlineUsers(currentUserName);
                updatePendingApprovalsBadge();
                showToast('Todas as outras pessoas foram excluídas.', 'success');
            });
        });

        function handleSendChatMessage(attachment) {
            const input = document.getElementById('chatMessageInput');
            const text = input.value.trim();
            if (!text && !attachment) return;
            const channel = document.getElementById('chatChannelSelect').value || null;
            sendMessage(text, channel, attachment);
            input.value = '';
            renderChatChannelOptions();
            renderChatMessages();

            if (channel === MIA_AI_ID && text) {
                sendToMiaAI(text);
            }
        }

        document.getElementById('chatSendBtn').addEventListener('click', () => handleSendChatMessage());
        document.getElementById('chatMessageInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleSendChatMessage(); }
        });

        document.getElementById('chatAttachBtn').addEventListener('click', () => {
            document.getElementById('chatFileInput').click();
        });

        document.getElementById('chatFileInput').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            showToast('Enviando arquivo...');
            const isImage = file.type.startsWith('image/');
            const dataUrl = await processSingleFile(file);
            const serverUrl = await uploadFileToServer(file.name, dataUrl);

            const attachment = { name: file.name, url: serverUrl || dataUrl, isImage };
            handleSendChatMessage(attachment);
            e.target.value = '';
        });

        // Membros e Permissões
        document.getElementById('closeMembersModalBtn').addEventListener('click', () => {
            document.getElementById('membersModal').style.display = 'none';
        });

        document.getElementById('newMemberForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('newMemberName').value.trim();
            const role = document.getElementById('newMemberRole').value;
            if (!name) return;
            setMemberRole(name, role);
            document.getElementById('newMemberName').value = '';
            renderMembersList();
            renderBoard();
            if (name === currentUserName) location.reload();
        });

        // Visualizações
        document.getElementById('closeViewsModalBtn').addEventListener('click', () => {
            document.getElementById('viewsModal').style.display = 'none';
        });

        document.querySelectorAll('.view-option-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                currentView = btn.dataset.view;
                localStorage.setItem(`mse_view_${currentUserName}`, currentView);
                document.getElementById('viewsModal').style.display = 'none';
                renderBoard();
            });
        });

        // Automação
        document.getElementById('closeAutomationModalBtn').addEventListener('click', () => {
            document.getElementById('automationModal').style.display = 'none';
        });

        document.getElementById('autoMoveToggle').addEventListener('change', (e) => {
            state.settings.autoMoveOnComplete = e.target.checked;
            saveState();
        });

        // Campos Personalizados
        document.getElementById('closeFieldsModalBtn').addEventListener('click', () => {
            document.getElementById('fieldsModal').style.display = 'none';
        });

        document.getElementById('newFieldForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('newFieldName').value.trim();
            const type = document.getElementById('newFieldType').value;
            if (!name) return;
            addCustomField(name, type);
            document.getElementById('newFieldName').value = '';
            renderFieldsList();
        });

        // Analytics
        document.getElementById('closeAnalyticsModalBtn').addEventListener('click', () => {
            document.getElementById('analyticsModal').style.display = 'none';
        });

        // Auditoria
        document.getElementById('closeAuditModalBtn').addEventListener('click', () => {
            document.getElementById('auditModal').style.display = 'none';
        });

        // Webhooks
        document.getElementById('closeWebhooksModalBtn').addEventListener('click', () => {
            document.getElementById('webhooksModal').style.display = 'none';
        });

        document.getElementById('saveWebhookBtn').addEventListener('click', () => {
            const url = document.getElementById('webhookUrlInput').value.trim();
            localStorage.setItem('mse_webhook_url', url);
            document.getElementById('webhooksModal').style.display = 'none';
            showToast('Webhook salvo com sucesso!', 'success');
        });

        // Preferências
        document.getElementById('closePreferencesModalBtn').addEventListener('click', () => {
            document.getElementById('preferencesModal').style.display = 'none';
        });

        document.querySelectorAll('.theme-option-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                applyTheme(btn.dataset.themeChoice);
                markCurrentThemeButton();
            });
        });

        document.getElementById('notificationsToggle').addEventListener('change', (e) => {
            localStorage.setItem(`mse_notifications_${currentUserName}`, e.target.checked ? '1' : '0');
        });

        // Aparência
        document.querySelectorAll('.accent-swatch[data-accent]').forEach(btn => {
            btn.addEventListener('click', () => {
                applyAccentColor(btn.dataset.accent);
                markCurrentAccentSwatch();
            });
        });

        document.getElementById('customAccentInput').addEventListener('input', (e) => {
            applyAccentColor(e.target.value);
            markCurrentAccentSwatch();
        });

        document.querySelectorAll('.corner-option-btn').forEach(btn => {
            btn.addEventListener('click', () => applyCorners(btn.dataset.corners));
        });

        document.querySelectorAll('.density-option-btn').forEach(btn => {
            btn.addEventListener('click', () => applyDensity(btn.dataset.density));
        });

        document.getElementById('grainToggle').addEventListener('change', (e) => {
            applyGrain(e.target.checked);
        });

        document.getElementById('resetAppearanceBtn').addEventListener('click', () => {
            localStorage.removeItem(`mse_accent_${currentUserName}`);
            localStorage.removeItem(`mse_corners_${currentUserName}`);
            localStorage.removeItem(`mse_density_${currentUserName}`);
            localStorage.removeItem(`mse_grain_${currentUserName}`);
            loadAppearancePrefs();
            openPreferencesModal();
            showToast('Aparência restaurada ao padrão.');
        });

        // Central de Erros
        document.getElementById('closeErrorLogModalBtn').addEventListener('click', () => {
            document.getElementById('errorLogModal').style.display = 'none';
        });

        document.getElementById('clearErrorLogBtn').addEventListener('click', () => {
            state.errorLog = [];
            saveState();
            updateErrorLogBadge();
            renderErrorLogList();
            showToast('Registro de erros limpo.');
        });

        // Relatório de Entregas
        document.getElementById('closeDeliveryReportModalBtn').addEventListener('click', () => {
            document.getElementById('deliveryReportModal').style.display = 'none';
        });

        document.querySelectorAll('.report-period-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                currentReportPeriod = btn.dataset.period;
                document.querySelectorAll('.report-period-btn').forEach(b => b.classList.toggle('is-current', b === btn));
                renderDeliveryReport();
            });
        });

        document.getElementById('reportDateFrom').addEventListener('change', renderDeliveryReport);
        document.getElementById('reportDateTo').addEventListener('change', renderDeliveryReport);
        document.getElementById('reportClearPeriodBtn').addEventListener('click', () => {
            document.getElementById('reportDateFrom').value = '';
            document.getElementById('reportDateTo').value = '';
            renderDeliveryReport();
        });

        document.getElementById('taskSearchInput').addEventListener('input', renderDeliveryReport);
        document.getElementById('taskFilterPerson').addEventListener('change', renderDeliveryReport);
        document.getElementById('taskFilterLane').addEventListener('change', renderDeliveryReport);
        document.getElementById('taskFilterClearBtn').addEventListener('click', () => {
            document.getElementById('taskSearchInput').value = '';
            document.getElementById('taskFilterPerson').value = '';
            document.getElementById('taskFilterLane').value = '';
            renderDeliveryReport();
        });

        document.getElementById('exportReportCsvBtn').addEventListener('click', exportDeliveryReportCsv);
        document.getElementById('printReportBtn').addEventListener('click', () => {
            document.body.classList.add('printing-report');
            window.print();
            setTimeout(() => document.body.classList.remove('printing-report'), 500);
        });

        // Alertas de Vencimento
        document.getElementById('closeDueAlertsModalBtn').addEventListener('click', () => {
            document.getElementById('dueAlertsModal').style.display = 'none';
        });

        // Importar do Trello
        document.getElementById('closeImportTrelloModalBtn').addEventListener('click', () => {
            document.getElementById('importTrelloModal').style.display = 'none';
        });

        document.getElementById('startTrelloImportBtn').addEventListener('click', async () => {
            const fileInput = document.getElementById('trelloImportFile');
            const file = fileInput.files[0];
            const progressEl = document.getElementById('trelloImportProgress');

            if (!file) {
                showToast('Escolha o arquivo .json exportado do Trello primeiro.');
                return;
            }

            const includeArchived = document.getElementById('importArchivedToggle').checked;

            try {
                progressEl.textContent = 'Lendo arquivo...';
                const text = await file.text();
                const trelloData = JSON.parse(text);
                await importFromTrello(trelloData, includeArchived, progressEl);
            } catch (err) {
                console.error('Erro ao importar do Trello:', err);
                progressEl.textContent = 'Falha ao ler o arquivo. Confira se é mesmo um export .json do Trello.';
                logError('Falha ao importar do Trello', 'Confira se o arquivo é um export JSON válido (menu do Trello → Exportar como JSON).');
            }
        });

        // Backup no Servidor
        document.getElementById('closeServerBackupModalBtn').addEventListener('click', () => {
            document.getElementById('serverBackupModal').style.display = 'none';
        });

        document.getElementById('createBackupNowBtn').addEventListener('click', async () => {
            showToast('Gerando backup no servidor...');
            const res = await apiCall('backup.php', {});
            if (res && res.success) {
                showToast(`Backup criado: ${res.arquivo}`, 'success');
                renderBackupsList();
            } else {
                showToast('Falha ao gerar backup. Veja a Central de Erros.');
            }
        });

        // Lixeira
        document.getElementById('closeTrashModalBtn').addEventListener('click', () => {
            document.getElementById('trashModal').style.display = 'none';
        });

        // Modelos de Post-it
        document.getElementById('closeTemplatesModalBtn').addEventListener('click', () => {
            document.getElementById('templatesModal').style.display = 'none';
        });

        document.getElementById('saveAsTemplateBtn').addEventListener('click', saveCurrentFormAsTemplate);

        document.getElementById('templateSelect').addEventListener('change', (e) => {
            if (e.target.value) applyTemplateToForm(e.target.value);
        });

        // Etiquetas
        document.getElementById('closeLabelsModalBtn').addEventListener('click', () => {
            document.getElementById('labelsModal').style.display = 'none';
        });

        document.getElementById('newLabelForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('newLabelName').value.trim();
            const color = document.getElementById('newLabelColor').value;
            if (!name) return;
            addLabel(name, color);
            document.getElementById('newLabelName').value = '';
            renderLabelsList();
            renderBoard();
        });

        // Sobre este Quadro
        document.getElementById('aboutBoardBtn').addEventListener('click', () => {
            document.getElementById('boardNameInput').value = state.boardInfo.name;
            document.getElementById('boardDescInput').value = state.boardInfo.description;
            document.getElementById('aboutBoardModal').style.display = 'flex';
        });

        document.getElementById('closeAboutBoardModalBtn').addEventListener('click', () => {
            document.getElementById('aboutBoardModal').style.display = 'none';
        });

        document.getElementById('saveAboutBoardBtn').addEventListener('click', () => {
            const name = document.getElementById('boardNameInput').value.trim() || 'Quadro Geral de Equipe';
            const description = document.getElementById('boardDescInput').value.trim();
            state.boardInfo = { name, description };
            saveState();
            applyBoardInfo();
            document.getElementById('aboutBoardModal').style.display = 'none';
            showToast('Informações do quadro salvas!', 'success');
        });

        await loadState();

        // Quem NÃO está cadastrado em "Membros e Permissões" não foi convidado — só pode
        // ver o Dashboard, e nada mais (sem acessar o quadro, colunas ou post-its).
        const isInvited = !!state.members[userData.name];

        if (!isInvited) {
            if (!state.visitorLog) state.visitorLog = {};
            state.visitorLog[userData.name] = Date.now();
            saveState();
            document.body.classList.add('dashboard-only-mode');
            renderDeliveryReport();
            document.getElementById('deliveryReportModal').style.display = 'flex';
            return;
        }

        const effectiveRole = getMemberRole(userData.name);
        if (effectiveRole !== userData.role) {
            userData.role = effectiveRole;
            localStorage.setItem('mse_user', JSON.stringify(userData));
            userBadge.textContent = effectiveRole;
            userBadge.classList.remove('badge-admin', 'badge-membro');
            userBadge.classList.add(effectiveRole === 'Admin' ? 'badge-admin' : 'badge-membro');
            document.getElementById('sidebarFootRole').textContent = effectiveRole;
        }

        renderOnlineUsers(userData.name);
        applyBoardInfo();
        updatePendingApprovalsBadge();
        updateErrorLogBadge();

        // Agora que os dados salvos (incluindo fotos customizadas) já foram carregados,
        // atualiza o avatar do rodapé com a foto correta (evita voltar ao ícone genérico)
        document.getElementById('sidebarFootAvatar').innerHTML = `<img src="${getAvatarUrl(currentUserName, 68)}" alt="${escapeHtml(currentUserName)}" style="width:100%; height:100%; object-fit:cover; border-radius:inherit;">`;

        if (getMemberRole(currentUserName) === 'Admin') {
            const nApprovals = (state.pendingApprovals || []).length;
            const nResets = (state.passwordResetRequests || []).length;
            if (nApprovals > 0 || nResets > 0) {
                const parts = [];
                if (nApprovals > 0) parts.push(`${nApprovals} solicitaç${nApprovals > 1 ? 'ões' : 'ão'} de acesso`);
                if (nResets > 0) parts.push(`${nResets} pedido${nResets > 1 ? 's' : ''} de redefinição de senha`);
                showToast(`${parts.join(' e ')} aguardando você — veja em Membros e Permissões.`);
            }
        }

        currentView = localStorage.getItem(`mse_view_${currentUserName}`) || 'kanban';
        applyTheme(localStorage.getItem(`mse_theme_${currentUserName}`) || 'light');
        loadAppearancePrefs();
        applyObserverMode();
        applyBoardBackground();
        renderGradientPresets();
        renderBoard();
        startAutoRefresh();

        updateDueAlertsBadge();
        const dueAlerts = computeDueAlerts();
        const nDueTotal = dueAlerts.overdue.length + dueAlerts.dueToday.length + dueAlerts.dueTomorrow.length;
        if (nDueTotal > 0) {
            if (getMemberRole(currentUserName) === 'Admin') {
                const namesCount = {};
                [...dueAlerts.overdue, ...dueAlerts.dueToday, ...dueAlerts.dueTomorrow].forEach(c => {
                    const names = (c.assignees && c.assignees.length > 0) ? c.assignees : ['Sem responsável'];
                    names.forEach(n => {
                        const label = n === 'Sem responsável' ? n : deriveNameFromEmail(n);
                        namesCount[label] = (namesCount[label] || 0) + 1;
                    });
                });
                const namesList = Object.entries(namesCount).map(([n, c]) => `${n} (${c})`).join(', ');
                showToast(`⚠️ Tarefas atrasadas/vencendo: ${namesList} — veja em Alertas de Vencimento.`);
            } else {
                const parts = [];
                if (dueAlerts.overdue.length > 0) parts.push(`${dueAlerts.overdue.length} atrasado${dueAlerts.overdue.length > 1 ? 's' : ''}`);
                if (dueAlerts.dueToday.length > 0) parts.push(`${dueAlerts.dueToday.length} vencendo hoje`);
                if (dueAlerts.dueTomorrow.length > 0) parts.push(`${dueAlerts.dueTomorrow.length} vencendo amanhã`);
                showToast(`Você tem tarefas ${parts.join(', ')} — veja em Alertas de Vencimento.`);
            }
        }

        // Atalhos de teclado
        document.addEventListener('keydown', (e) => {
            const active = document.activeElement;
            const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
            if (isTyping) return;

            const anyModalOpen = document.querySelector('.modal[style*="flex"]');
            if (anyModalOpen) return;

            if (e.code === 'Space') {
                if (hoveredCardId) {
                    e.preventDefault();
                    toggleAssignee(hoveredCardId, userData.name);
                    renderBoard();
                }
            } else if (e.key.toLowerCase() === 'c') {
                if (hoveredCardId) {
                    e.preventDefault();
                    archiveCard(hoveredCardId);
                    hoveredCardId = null;
                    renderBoard();
                    showToast('Cartão arquivado. Veja em "Arquivados".');
                }
            } else if (e.key.toLowerCase() === 'f') {
                e.preventDefault();
                document.getElementById('searchInput').focus();
            }
        });

        // Personalização de Fundo (Configurações)

        document.getElementById('closeSettingsModalBtn').addEventListener('click', () => {
            document.getElementById('settingsModal').style.display = 'none';
        });

        document.getElementById('resetBgBtn').addEventListener('click', () => {
            localStorage.removeItem(`mse_board_bg_${currentUserName}`);
            applyBoardBackground();
            document.getElementById('settingsModal').style.display = 'none';
            showToast('Fundo restaurado ao padrão.');
        });

        document.getElementById('bgPhotoInput').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // GIFs animados costumam ser grandes, e o localStorage do navegador
            // tem um limite pequeno (geralmente uns 5 MB no total). Avisa antes
            // de tentar, pra não falhar silenciosamente.
            const maxSizeMb = 4;
            if (file.size > maxSizeMb * 1024 * 1024) {
                showToast(`Esse arquivo tem ${(file.size / 1024 / 1024).toFixed(1)} MB — o limite é ${maxSizeMb} MB (o navegador não consegue guardar arquivos maiores como fundo). Tente um GIF/imagem menor.`, 'error');
                e.target.value = '';
                return;
            }

            const dataUrl = await processSingleFile(file);
            const ok = setBoardBackground('image', dataUrl);
            if (ok) {
                document.getElementById('settingsModal').style.display = 'none';
                showToast('Fundo atualizado com sucesso!', 'success');
            } else {
                showToast('Não foi possível salvar esse fundo — o arquivo é grande demais para o navegador guardar. Tente um menor.', 'error');
            }
        });

        document.getElementById('unsplashSearchBtn').addEventListener('click', async () => {
            const key = document.getElementById('unsplashKeyInput').value.trim();
            const query = document.getElementById('unsplashSearchInput').value.trim();
            const resultsDiv = document.getElementById('unsplashResults');

            if (!key) {
                resultsDiv.innerHTML = '<p class="unsplash-note">Cole sua Access Key da Unsplash API para buscar fotos (gratuita em unsplash.com/developers).</p>';
                return;
            }
            if (!query) return;

            localStorage.setItem('mse_unsplash_key', key);
            resultsDiv.innerHTML = '<p class="unsplash-note">Buscando...</p>';

            try {
                const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=9`, {
                    headers: { Authorization: `Client-ID ${key}` }
                });
                const data = await res.json();

                if (!data.results || data.results.length === 0) {
                    resultsDiv.innerHTML = '<p class="unsplash-note">Nenhuma foto encontrada.</p>';
                    return;
                }

                resultsDiv.innerHTML = '';
                data.results.forEach(photo => {
                    const img = document.createElement('img');
                    img.src = photo.urls.small;
                    img.alt = photo.alt_description || query;
                    img.addEventListener('click', () => {
                        setBoardBackground('image', photo.urls.regular);
                        document.getElementById('settingsModal').style.display = 'none';
                        showToast('Fundo atualizado com sucesso!', 'success');
                    });
                    resultsDiv.appendChild(img);
                });
            } catch (err) {
                resultsDiv.innerHTML = '<p class="unsplash-note">Erro ao buscar. Verifique sua Access Key.</p>';
                logError(
                    'Falha ao buscar fotos no Unsplash',
                    'Confira se a Access Key colada em Configurações é válida (gere uma gratuita em unsplash.com/developers) e se você tem conexão com a internet.'
                );
            }
        });

        // Cartões Arquivados
        document.getElementById('archivedBtn').addEventListener('click', () => {
            renderArchivedList();
            document.getElementById('archivedModal').style.display = 'flex';
        });

        document.getElementById('closeArchivedModalBtn').addEventListener('click', () => {
            document.getElementById('archivedModal').style.display = 'none';
        });

        // Fecha modais clicando fora
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.style.display = 'none';
            });
        });

        const personModal = document.getElementById('personModal');
        const cardModal = document.getElementById('cardModal');

        document.getElementById('addPersonBtn').addEventListener('click', () => {
            openPersonModalForCreate(false);
        });

        document.getElementById('addDoneTabBtn').addEventListener('click', () => {
            openPersonModalForCreate(true);
        });

        document.getElementById('closePersonModalBtn').addEventListener('click', () => {
            personModal.style.display = 'none';
        });

        document.getElementById('openModalBtn').addEventListener('click', () => {
            openCardModalForCreate();
        });

        document.getElementById('closeModalBtn').addEventListener('click', () => {
            cardModal.style.display = 'none';
        });

        window.addEventListener('click', (e) => {
            if (e.target === personModal) personModal.style.display = 'none';
            if (e.target === cardModal) cardModal.style.display = 'none';
        });

        document.getElementById('newPersonForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const personName = document.getElementById('personNameInput').value.trim();
            const editingId = document.getElementById('editingPersonId').value;
            const isDone = document.getElementById('personIsDoneInput').value === 'true';
            const avatarFile = document.getElementById('personAvatarInput').files[0];

            if (personName === '') { personModal.style.display = 'none'; return; }

            let avatarUrl = null;
            if (avatarFile) {
                avatarUrl = await processSingleFile(avatarFile);
            }

            if (editingId) {
                updatePerson(editingId, { name: personName, avatarUrl });
            } else {
                addPerson(personName, avatarUrl, isDone);
            }

            renderBoard();

            if (!editingId && currentView === 'kanban') {
                const grid = document.getElementById('peopleGrid');
                grid.scrollLeft = grid.scrollWidth;
            }

            personModal.style.display = 'none';
        });

        document.getElementById('cardCoverInput').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const dataUrl = await processSingleFile(file);
            const serverUrl = await uploadFileToServer(file.name, dataUrl);
            renderCoverPreview(serverUrl || dataUrl);
        });

        document.getElementById('newCardForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const editingId = document.getElementById('editingCardId').value;
            const targetPersonId = document.getElementById('targetPersonSelect').value;
            const title = document.getElementById('cardTitle').value;
            const desc = document.getElementById('cardDesc').value;
            const color = document.getElementById('cardColor').value;
            const priority = document.getElementById('cardPriority').value;
            const dueDate = document.getElementById('cardDueDate').value;
            const startDate = document.getElementById('cardStartDate').value;
            const fileInput = document.getElementById('cardAttachments');

            const newAttachments = await processFiles(fileInput.files);
            const lines = desc.split('\n').map(l => l.trim()).filter(l => l !== '');
            const customValues = readCustomFieldValues();
            const labelIds = readSelectedLabelIds();
            const stickerId = selectedStickerId;
            const coverImage = selectedCoverImage;

            if (editingId) {
                await updateCard(editingId, { personId: targetPersonId, title, lines, color, priority, dueDate, newAttachments, customValues, labelIds, stickerId, coverImage, startDate });
            } else {
                await addCard({ personId: targetPersonId, title, lines, color, priority, dueDate, author: userData.name, attachments: newAttachments, customValues, labelIds, stickerId, coverImage, startDate });
            }

            renderBoard();
            document.getElementById('newCardForm').reset();
            renderCoverPreview(null);
            cardModal.style.display = 'none';
        });

        document.getElementById('addCommentBtn').addEventListener('click', () => {
            const editingId = document.getElementById('editingCardId').value;
            const input = document.getElementById('newCommentInput');
            const text = input.value.trim();
            if (!editingId || text === '') return;

            addComment(editingId, userData.name, text);
            input.value = '';
            renderCommentsList(editingId);
        });

        // Modal de Visualização Grande
        const viewCardModal = document.getElementById('viewCardModal');

        document.getElementById('closeViewModalBtn').addEventListener('click', () => {
            viewCardModal.style.display = 'none';
        });

        window.addEventListener('click', (e) => {
            if (e.target === viewCardModal) viewCardModal.style.display = 'none';
        });

        document.getElementById('viewEditBtn').addEventListener('click', () => {
            const cardId = viewCardModal.dataset.cardId;
            viewCardModal.style.display = 'none';
            openCardModalForEdit(cardId);
        });

        document.getElementById('viewAddCommentBtn').addEventListener('click', () => {
            const cardId = viewCardModal.dataset.cardId;
            const input = document.getElementById('viewNewCommentInput');
            const text = input.value.trim();
            if (!cardId || text === '') return;

            addComment(cardId, userData.name, text);
            input.value = '';
            renderViewCommentsList(cardId);
        });

        document.getElementById('searchInput').addEventListener('input', renderBoard);
        document.getElementById('filterPriority').addEventListener('change', renderBoard);
        document.getElementById('filterAssignee').addEventListener('change', renderBoard);
        document.getElementById('filterOverdue').addEventListener('change', renderBoard);
        document.getElementById('filterStarred').addEventListener('change', renderBoard);
        document.getElementById('clearFiltersBtn').addEventListener('click', () => {
            document.getElementById('searchInput').value = '';
            document.getElementById('filterPriority').value = '';
            document.getElementById('filterAssignee').value = '';
            document.getElementById('filterOverdue').checked = false;
            document.getElementById('filterStarred').checked = false;
            renderBoard();
        });

        // Botão de minimizar Busca e Filtros (lembra o estado entre acessos)
        const filterBarContent = document.getElementById('filterBarContent');
        const toggleFiltersIcon = document.getElementById('toggleFiltersIcon');
        if (localStorage.getItem('mse_filters_hidden') === 'true') {
            filterBarContent.classList.add('filters-hidden');
            toggleFiltersIcon.textContent = '▼';
        }
        document.getElementById('toggleFiltersBtn').addEventListener('click', () => {
            const isHidden = filterBarContent.classList.toggle('filters-hidden');
            toggleFiltersIcon.textContent = isHidden ? '▼' : '▲';
            localStorage.setItem('mse_filters_hidden', isHidden ? 'true' : 'false');
        });
    }
});

// ==========================================
// ESTADO E PERSISTÊNCIA (localStorage)
// ==========================================

const STORAGE_KEY = 'mse_board_state';
let state = { people: [], cards: [] };
let personIdCounter = 0;
let cardIdCounter = 0;

// Gera um ID praticamente impossível de colidir, mesmo com várias pessoas
// criando post-its/colunas ao mesmo tempo em navegadores diferentes.
// (Antes usava um contador local por navegador — dois usuários criando algo
// no mesmo instante podiam gerar o MESMO id, e o segundo a chegar no servidor
// sobrescrevia o primeiro sem avisar ninguém.)
function generateUniqueId(prefix) {
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${Date.now()}_${random}`;
}

// ==========================================
// ATUALIZAÇÃO AUTOMÁTICA (mantém o quadro sincronizado com outras pessoas)
// ==========================================

let autoRefreshTimer = null;
let isAutoRefreshing = false;

function isAnyModalOpen() {
    return [...document.querySelectorAll('.modal')].some(m => m.style.display === 'flex');
}

function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(refreshBoardFromServer, 6000);
}

async function refreshBoardFromServer() {
    // Não atualiza se tiver algum modal aberto (pra não atrapalhar quem tá digitando)
    // nem se estiver arrastando um post-it, nem se já tiver uma atualização rolando.
    if (isAnyModalOpen() || isAutoRefreshing) return;

    isAutoRefreshing = true;
    try {
        // Antes de buscar a versão do servidor, tenta salvar/excluir de novo
        // qualquer post-it ou pessoa/coluna que tenha falhado antes (rede caiu,
        // servidor lento, etc).
        retryPendingCardSaves();
        retryPendingCardDeletes();
        retryPendingPersonSaves();
        retryPendingPersonDeletes();

        const [freshPeopleRaw, freshCards, freshBlob] = await Promise.all([
            fetchPeopleFromServer(),
            fetchCardsFromServer(),
            fetchBoardStateFromServer()
        ]);

        if (freshPeopleRaw === null || freshCards === null) return; // servidor fora do ar — tenta de novo no próximo ciclo

        // Mesma proteção de post-its, agora pras pessoas/colunas: mantém a versão
        // local se tiver um salvamento pendente, e nunca deixa uma coluna excluída
        // reaparecer sozinha se a exclusão ainda não foi confirmada.
        const freshPeople = freshPeopleRaw
            .filter(fp => !pendingPersonDeletes.has(fp.id))
            .map(fp => {
                if (pendingPersonSaves.has(fp.id)) {
                    const localVersion = state.people.find(p => p.id === fp.id);
                    return localVersion || fp;
                }
                return fp;
            });
        state.people.forEach(p => {
            if (pendingPersonSaves.has(p.id) && !freshPeople.some(fp => fp.id === p.id)) {
                freshPeople.push(p); // coluna criada localmente, ainda não confirmada no servidor
            }
        });

        // Post-its com salvamento pendente/falho: mantém a versão local em vez da
        // que veio do servidor, pra não perder uma mudança que ainda não foi
        // confirmada como salva (ex: acabou de criar e a rede caiu na hora do save).
        // Post-its com exclusão pendente: nunca deixa reaparecer, mesmo que o
        // servidor ainda devolva ele (exclusão que falhou não "ressuscita" sozinha).
        const mergedCards = freshCards
            .filter(fc => !pendingCardDeletes.has(fc.id))
            .map(fc => {
                if (pendingCardSaves.has(fc.id)) {
                    const localVersion = state.cards.find(c => c.id === fc.id);
                    return localVersion || fc;
                }
                return fc;
            });
        state.cards.forEach(c => {
            if (pendingCardSaves.has(c.id) && !mergedCards.some(mc => mc.id === c.id)) {
                mergedCards.push(c); // post-it criado localmente, ainda não confirmado no servidor
            }
        });

        const changed =
            JSON.stringify(freshPeople) !== JSON.stringify(state.people) ||
            JSON.stringify(mergedCards) !== JSON.stringify(state.cards);

        if (changed) {
            const oldSuggestionIds = new Set(state.cards.filter(c => c.personId === 'suggestions').map(c => c.id));
            const newSuggestionCards = mergedCards.filter(c => c.personId === 'suggestions' && !oldSuggestionIds.has(c.id));

            state.people = freshPeople;
            state.cards = mergedCards;
            personIdCounter = state.people.reduce((max, p) => Math.max(max, parseInt((p.id.split('_')[1])) || 0), 0);
            cardIdCounter = state.cards.reduce((max, c) => Math.max(max, parseInt((c.id.split('_')[1])) || 0), 0);
            renderBoard();
            updateDueAlertsBadge();

            if (newSuggestionCards.length > 0) {
                showToast(`💡 ${newSuggestionCards.length} nova(s) sugestão(ões) de melhoria recebida(s)!`, 'success');
            }
        }

        if (freshBlob && Array.isArray(freshBlob.messages)) {
            checkForNewChatMessages(freshBlob.messages);
            state.messages = freshBlob.messages;
        }
        if (freshBlob && Array.isArray(freshBlob.mentions)) {
            checkForNewMentions(freshBlob.mentions);
            state.mentions = freshBlob.mentions;
        }
    } catch (err) {
        console.error('Falha na atualização automática:', err);
    } finally {
        isAutoRefreshing = false;
    }
}

let knownMessageIds = null;
let knownMentionIds = null;

function checkForNewMentions(freshMentions) {
    if (knownMentionIds === null) {
        knownMentionIds = new Set(freshMentions.map(m => m.id));
        return;
    }

    const newOnes = freshMentions.filter(m => !knownMentionIds.has(m.id));
    knownMentionIds = new Set(freshMentions.map(m => m.id));

    const relevant = newOnes.filter(m => m.mentionedUser === currentUserName);
    relevant.forEach(m => {
        showToast(`💬 ${deriveNameFromEmail(m.byUser)} mencionou você em "${m.cardTitle}"`, 'success');
    });
}

function checkForNewChatMessages(freshMessages) {
    if (knownMessageIds === null) {
        // Primeira vez que vemos as mensagens nesta sessão — só memoriza, não notifica retroativamente
        knownMessageIds = new Set(freshMessages.map(m => m.id));
        return;
    }

    const newOnes = freshMessages.filter(m => !knownMessageIds.has(m.id));
    knownMessageIds = new Set(freshMessages.map(m => m.id));

    const relevant = newOnes.filter(m =>
        m.from !== currentUserName && (!m.to || m.to === currentUserName)
    );

    if (relevant.length === 0) return;

    const chatPanelOpen = document.getElementById('chatPanel').style.display === 'flex';
    if (!chatPanelOpen) {
        document.getElementById('chatUnreadBadge').style.display = 'inline-block';
    }

    if (relevant.length === 1) {
        const m = relevant[0];
        const preview = m.text ? `"${m.text.slice(0, 60)}${m.text.length > 60 ? '…' : ''}"` : `enviou um arquivo 📎`;
        showToast(`💬 Nova mensagem de ${deriveNameFromEmail(m.from)}: ${preview}`, 'success');
    } else {
        showToast(`💬 ${relevant.length} novas mensagens no chat`, 'success');
    }

    if (chatPanelOpen) renderChatMessages();
}

async function loadState() {
    let parsed = await fetchBoardStateFromServer();

    if (parsed === null) {
        // Servidor fora do ar — usa a última cópia local salva, se existir
        showToast('Não foi possível conectar ao servidor MySQL. Usando a última cópia salva neste navegador.');
        const saved = localStorage.getItem(STORAGE_KEY);
        parsed = saved ? JSON.parse(saved) : null;
    } else {
        // Pessoas e post-its agora moram em tabelas próprias, não no blob
        const [peopleFromServer, cardsFromServer] = await Promise.all([
            fetchPeopleFromServer(),
            fetchCardsFromServer()
        ]);

        if (peopleFromServer !== null && cardsFromServer !== null) {
            parsed.people = peopleFromServer;
            parsed.cards = cardsFromServer;
        } else {
            showToast('Não foi possível buscar pessoas/tarefas das tabelas novas. Rode a migração em mse-backend/migrate.html.');
        }
    }

    if (parsed && Array.isArray(parsed.people) && Array.isArray(parsed.cards)) {
        state = parsed;
        personIdCounter = state.people.reduce((max, p) => Math.max(max, parseInt((p.id.split('_')[1])) || 0), 0);
        cardIdCounter = state.cards.reduce((max, c) => Math.max(max, parseInt((c.id.split('_')[1])) || 0), 0);

        // Migração: novas estruturas (membros, campos personalizados, automação, auditoria)
        if (!state.members) state.members = {};
        if (!state.customFields) state.customFields = [];
        if (!state.settings) state.settings = { autoMoveOnComplete: false };
        if (!state.auditLog) state.auditLog = [];
        if (!state.messages) state.messages = [];
        if (!state.knownUsers) state.knownUsers = [];
        if (!state.trash) state.trash = [];
        if (!state.templates) state.templates = [];
        if (!state.labels) state.labels = [];
        if (!state.pendingApprovals) state.pendingApprovals = [];
        if (!state.customAvatars) state.customAvatars = {};
        if (!state.userPasswords) state.userPasswords = {};
        if (!state.passwordResetRequests) state.passwordResetRequests = [];
        if (!state.mentions) state.mentions = [];
        if (!state.loginAttempts) state.loginAttempts = {};
        if (!state.boardInfo) state.boardInfo = { name: 'Quadro Geral de Equipe', description: 'Adicione pessoas e atribua tarefas com checklists e anexos' };
        if (!state.errorLog) state.errorLog = [];
        state.cards.forEach(c => { if (!c.labelIds) c.labelIds = []; if (c.starred === undefined) c.starred = false; if (c.stickerId === undefined) c.stickerId = null; if (c.coverImage === undefined) c.coverImage = null; if (c.completedAt === undefined) c.completedAt = null; if (c.startDate === undefined) c.startDate = null; if (c.observacao === undefined) c.observacao = ''; });
        if (currentUserName && !state.knownUsers.includes(currentUserName)) state.knownUsers.push(currentUserName);

        // Migração: cartões antigos ganham a raia "Fazendo" por padrão.
        // "Em Espera" não existe mais — quem estava lá volta pra "Fazendo".
        state.cards.forEach(c => {
            if (!c.status || c.status === 'waiting') c.status = 'todo';
        });

        isObserver = getMemberRole(currentUserName) === 'Observador';
        saveState();
        return;
    }

    // Sem quadro ainda — pode já existir um blob parcial (membros/pendências) criado pelo login
    state = parsed || {};
    state.members = state.members || {};
    state.pendingApprovals = state.pendingApprovals || [];
    state.customAvatars = state.customAvatars || {};
    state.userPasswords = state.userPasswords || {};
    state.passwordResetRequests = state.passwordResetRequests || [];
    state.customFields = [];
    state.settings = { autoMoveOnComplete: false };
    state.auditLog = [];
    state.messages = [];
    state.knownUsers = currentUserName ? [currentUserName] : [];
    state.trash = [];
    state.templates = [];
    state.labels = [];
    state.boardInfo = { name: 'Quadro Geral de Equipe', description: 'Adicione pessoas e atribua tarefas com checklists e anexos' };
    state.errorLog = [];
    state.people = [];
    state.cards = [];

    const p1 = addPerson('João (Dev)');
    const p2 = addPerson('Ana (Engenharia)');
    addPerson('Concluído', null, true);
    const suggestionsPerson = { id: 'suggestions', name: '💡 Sugestões Mia', avatarUrl: null, isDone: false };
    state.people.push(suggestionsPerson);
    persistPerson(suggestionsPerson);

    addCard({
        personId: p1, title: 'Revisão Estrutural',
        lines: ['Conferir laudo da fundação', 'Validar carga de vento', 'Enviar aprovação pro CREA'],
        color: 'blue', priority: 'alta', dueDate: '', author: 'Admin', attachments: []
    });

    addCard({
        personId: p2, title: 'Inspeção no Hangar',
        lines: ['Verificar pilares da fileira B', 'Analisar cobertura metálica'],
        color: 'yellow', priority: 'media', dueDate: '', author: 'Carlos', attachments: []
    });

    isObserver = getMemberRole(currentUserName) === 'Observador';
}

function saveState() {
    // Cópia local, usada só como reserva se o servidor cair
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
        console.error('Falha ao salvar a cópia local:', err);
    }

    // Envia para o servidor (MySQL) em segundo plano, sem travar a interface
    saveBoardStateToServer(state).then(ok => {
        if (!ok) {
            if (!state.errorLog) state.errorLog = [];
            state.errorLog.unshift({
                ts: Date.now(),
                message: 'Falha ao salvar no servidor MySQL',
                howToFix: 'Verifique se o Apache e o MySQL estão ligados no XAMPP e se o backend está no endereço configurado em API_BASE (script.js).'
            });
            if (state.errorLog.length > 100) state.errorLog.length = 100;
            updateErrorLogBadge();
        }
    });
}

// ==========================================
// CHAT / MENSAGENS PRIVADAS
// ==========================================

const MIA_AI_ID = 'mia_ai';

function getKnownUsers() {
    return (state.knownUsers || []).filter(name => name !== currentUserName && name !== BOOTSTRAP_ADMIN_EMAIL);
}

function sendMessage(text, to, attachment) {
    if (!state.messages) state.messages = [];
    state.messages.push({
        id: `msg_${Date.now()}`,
        from: currentUserName,
        to: to || null,
        text,
        attachment: attachment || null,
        ts: Date.now()
    });
    saveState();
}

// Manda a mensagem pra Mia de verdade (agente do GPT Maker, via API oficial)
// e adiciona a resposta dela na conversa quando chegar. O GPT Maker guarda o
// histórico da conversa sozinho (por contextId = e-mail do colaborador) e já
// dispara a criação da tarefa automaticamente quando a intenção rodar.
async function sendToMiaAI(userText) {
    try {
        const res = await fetch(`${API_BASE}/mia_chat.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': API_SECRET },
            body: JSON.stringify({
                message: userText,
                author: currentUserName,
                authorName: deriveNameFromEmail(currentUserName),
                chatPicture: getAvatarUrl(currentUserName, 100)
            })
        });
        const data = await res.json();

        if (!data || !data.success) {
            showToast((data && data.error) ? data.error : 'A Mia não conseguiu responder agora.', 'error');
            return;
        }

        if (!state.messages) state.messages = [];
        state.messages.push({
            id: `msg_${Date.now()}_mia`,
            from: MIA_AI_ID,
            to: currentUserName,
            text: data.reply,
            attachment: null,
            ts: Date.now()
        });
        saveState();
        renderChatMessages();
    } catch (err) {
        console.error('Falha ao falar com a Mia:', err);
        showToast('Não foi possível falar com a Mia agora. Verifique sua internet.', 'error');
    }
}

function getConversation(withUser) {
    const messages = state.messages || [];
    if (!withUser) {
        return messages.filter(m => !m.to);
    }
    return messages.filter(m =>
        (m.from === currentUserName && m.to === withUser) ||
        (m.from === withUser && m.to === currentUserName)
    );
}

function renderChatChannelOptions() {
    const select = document.getElementById('chatChannelSelect');
    const previousValue = select.value;
    select.innerHTML = `<option value="">💬 Geral (todos)</option><option value="${MIA_AI_ID}">🤖 Mia (Sugestões)</option>`;

    getKnownUsers().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });

    if ([...select.options].some(o => o.value === previousValue)) {
        select.value = previousValue;
    }
}

function renderChatMessages() {
    const select = document.getElementById('chatChannelSelect');
    const channel = select.value || null;
    const messages = getConversation(channel);
    const container = document.getElementById('chatMessages');

    if (messages.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:0.82rem; text-align:center; margin-top:1rem;">Nenhuma mensagem ainda.</p>';
        return;
    }

    container.innerHTML = messages.map(m => {
        const mine = m.from === currentUserName;
        const time = new Date(m.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        let attachmentHtml = '';
        if (m.attachment) {
            if (m.attachment.isImage) {
                attachmentHtml = `<a href="${m.attachment.url}" target="_blank"><img src="${m.attachment.url}" class="chat-attachment-img" alt="${escapeHtml(m.attachment.name)}"></a>`;
            } else {
                attachmentHtml = `<a href="${m.attachment.url}" target="_blank" class="chat-attachment-file">📎 ${escapeHtml(m.attachment.name)}</a>`;
            }
        }

        return `
            <div class="chat-bubble ${mine ? 'chat-bubble-mine' : 'chat-bubble-theirs'}">
                ${!mine && !channel ? `<div class="chat-bubble-meta">${escapeHtml(m.from)}</div>` : ''}
                ${m.text ? `<div>${escapeHtml(m.text)}</div>` : ''}
                ${attachmentHtml}
                <div class="chat-bubble-meta" style="margin-top:0.15rem; margin-bottom:0;">${time}</div>
            </div>
        `;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

// ==========================================
// LIXEIRA
// ==========================================

function restoreFromTrash(trashId) {
    const item = state.trash.find(t => t.id === trashId);
    if (!item) return;

    const personExists = state.people.some(p => p.id === item.personId);
    const targetPersonId = personExists ? item.personId : (state.people.find(p => !p.isDone) || state.people[0])?.id;

    const restored = { ...item };
    delete restored.deletedAt;
    delete restored.deleteReason;
    restored.personId = targetPersonId;

    state.cards.push(restored);
    state.trash = state.trash.filter(t => t.id !== trashId);
    persistCard(restored);
    saveState();
    logAudit(`Restaurou da lixeira a tarefa "${item.title}"`);
}

function deleteFromTrashPermanently(trashId) {
    state.trash = state.trash.filter(t => t.id !== trashId);
    saveState();
}

// ==========================================
// CENTRAL DE ERROS
// ==========================================

function logError(message, howToFix) {
    if (!state.errorLog) state.errorLog = [];
    state.errorLog.unshift({ ts: Date.now(), message, howToFix: howToFix || 'Tente novamente. Se persistir, recarregue a página.' });
    if (state.errorLog.length > 100) state.errorLog.length = 100;
    saveState();
    updateErrorLogBadge();
}

function updateErrorLogBadge() {
    const badge = document.getElementById('errorLogBadge');
    if (!badge) return;
    const count = (state.errorLog || []).length;
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

function renderErrorLogList() {
    const list = document.getElementById('errorLogList');
    if (!state.errorLog || state.errorLog.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhum erro registrado. Tudo funcionando normalmente.</p>';
        return;
    }

    list.innerHTML = state.errorLog.map(entry => {
        const date = new Date(entry.ts);
        const dateStr = date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="audit-item">
                <div class="audit-item-meta">
                    <span class="audit-item-user" style="color:#bf3a3a;">${escapeHtml(entry.message)}</span>
                    <span>${dateStr}</span>
                </div>
                <div style="color:var(--text-muted); font-size:0.8rem; margin-top:0.3rem;">💡 ${escapeHtml(entry.howToFix)}</div>
            </div>
        `;
    }).join('');
}

function renderTrashList() {
    const list = document.getElementById('trashList');
    if (!state.trash || state.trash.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">A lixeira está vazia.</p>';
        return;
    }

    list.innerHTML = '';
    state.trash.slice().reverse().forEach(item => {
        const date = new Date(item.deletedAt);
        const dateStr = date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        const row = document.createElement('div');
        row.className = 'archived-item';
        row.innerHTML = `
            <div class="archived-item-info">
                <h4>${escapeHtml(item.title)}</h4>
                <p>${escapeHtml(item.deleteReason || '')} — ${dateStr}</p>
            </div>
            <div class="archived-item-actions">
                <button type="button" class="btn-secondary" data-action="restore">Restaurar</button>
                <button type="button" class="btn-secondary" data-action="delete">Excluir de vez</button>
            </div>
        `;
        row.querySelector('[data-action="restore"]').addEventListener('click', () => {
            restoreFromTrash(item.id);
            renderTrashList();
            renderBoard();
            showToast('Tarefa restaurada!', 'success');
        });
        row.querySelector('[data-action="delete"]').addEventListener('click', () => {
            showConfirm('Excluir esta tarefa definitivamente? Essa ação não pode ser desfeita.', () => {
                deleteFromTrashPermanently(item.id);
                renderTrashList();
            });
        });
        list.appendChild(row);
    });
}

// ==========================================
// MODELOS DE POST-IT
// ==========================================

let templateIdCounter = 0;

function saveCurrentFormAsTemplate() {
    const title = document.getElementById('cardTitle').value.trim();
    const desc = document.getElementById('cardDesc').value;
    const color = document.getElementById('cardColor').value;
    const priority = document.getElementById('cardPriority').value;

    if (!title) {
        showToast('Preencha ao menos o título antes de salvar como modelo.');
        return;
    }

    templateIdCounter++;
    state.templates.push({
        id: `tpl_${Date.now()}_${templateIdCounter}`,
        title,
        lines: desc.split('\n').map(l => l.trim()).filter(l => l !== ''),
        color,
        priority
    });
    saveState();
    populateTemplateSelect();
    showToast('Modelo salvo com sucesso!', 'success');
}

function applyTemplateToForm(templateId) {
    const tpl = state.templates.find(t => t.id === templateId);
    if (!tpl) return;
    document.getElementById('cardTitle').value = tpl.title;
    document.getElementById('cardDesc').value = tpl.lines.join('\n');
    document.getElementById('cardColor').value = tpl.color;
    document.getElementById('cardPriority').value = tpl.priority;
}

function populateTemplateSelect() {
    const select = document.getElementById('templateSelect');
    if (!select) return;
    select.innerHTML = '<option value="">Nenhum</option>';
    state.templates.forEach(tpl => {
        const option = document.createElement('option');
        option.value = tpl.id;
        option.textContent = tpl.title;
        select.appendChild(option);
    });
}

function removeTemplate(templateId) {
    state.templates = state.templates.filter(t => t.id !== templateId);
    saveState();
    populateTemplateSelect();
}

function renderTemplatesList() {
    const list = document.getElementById('templatesList');
    if (!state.templates || state.templates.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhum modelo salvo ainda. Abra "Nova Tarefa" e clique em "Salvar como Modelo".</p>';
        return;
    }

    list.innerHTML = '';
    state.templates.forEach(tpl => {
        const row = document.createElement('div');
        row.className = 'member-row';
        row.innerHTML = `
            <span class="member-row-name">${escapeHtml(tpl.title)}</span>
            <div class="member-row-actions">
                <button type="button" class="btn-secondary" data-action="use">Usar</button>
                <button type="button" class="remove-row-btn" title="Remover">&times;</button>
            </div>
        `;
        row.querySelector('[data-action="use"]').addEventListener('click', () => {
            document.getElementById('templatesModal').style.display = 'none';
            openCardModalForCreate();
            applyTemplateToForm(tpl.id);
        });
        row.querySelector('.remove-row-btn').addEventListener('click', () => {
            removeTemplate(tpl.id);
            renderTemplatesList();
        });
        list.appendChild(row);
    });
}

// ==========================================
// ETIQUETAS
// ==========================================

let labelIdCounter = 0;

function addLabel(name, color) {
    labelIdCounter++;
    const id = `label_${Date.now()}_${labelIdCounter}`;
    state.labels.push({ id, name, color });
    saveState();
    logAudit(`Criou a etiqueta "${name}"`);
}

function removeLabel(id) {
    const label = state.labels.find(l => l.id === id);
    state.labels = state.labels.filter(l => l.id !== id);
    state.cards.forEach(c => { if (c.labelIds) c.labelIds = c.labelIds.filter(lid => lid !== id); });
    saveState();
    if (label) logAudit(`Removeu a etiqueta "${label.name}"`);
}

function renderLabelsList() {
    const list = document.getElementById('labelsList');
    if (state.labels.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhuma etiqueta ainda.</p>';
        return;
    }

    list.innerHTML = '';
    state.labels.forEach(label => {
        const row = document.createElement('div');
        row.className = 'member-row';
        row.innerHTML = `
            <span class="label-swatch-row">
                <span class="label-swatch-dot" style="background:${label.color}"></span>
                <span class="member-row-name">${escapeHtml(label.name)}</span>
            </span>
            <button type="button" class="remove-row-btn" title="Remover">&times;</button>
        `;
        row.querySelector('.remove-row-btn').addEventListener('click', () => {
            removeLabel(label.id);
            renderLabelsList();
        });
        list.appendChild(row);
    });
}

// ==========================================
// FIGURINHAS (STICKERS)
// ==========================================

const STICKERS = [
    { id: 'attention', emoji: '⚠️', label: 'Atenção' },
    { id: 'approved', emoji: '✅', label: 'Aprovado' },
    { id: 'well_done', emoji: '👏', label: 'Muito Bem' },
    { id: 'redo', emoji: '🔁', label: 'Refazer' }
];

let selectedStickerId = null;
let selectedCoverImage = null;

function renderCoverPreview(coverImage) {
    selectedCoverImage = coverImage || null;
    const container = document.getElementById('cardCoverPreview');
    if (!container) return;

    if (selectedCoverImage) {
        container.innerHTML = `
            <span class="cover-preview-thumb-wrap">
                <img src="${selectedCoverImage}" alt="Capa">
                <button type="button" class="cover-preview-remove" title="Remover capa">&times;</button>
            </span>
        `;
        container.querySelector('.cover-preview-remove').addEventListener('click', () => {
            renderCoverPreview(null);
            document.getElementById('cardCoverInput').value = '';
        });
    } else {
        container.innerHTML = '';
    }
}

function renderStickerPicker(currentStickerId) {
    const container = document.getElementById('stickerPicker');
    if (!container) return;
    selectedStickerId = currentStickerId || null;

    container.innerHTML = STICKERS.map(s => `
        <div class="sticker-option ${selectedStickerId === s.id ? 'is-selected' : ''}" data-sticker-id="${s.id}">
            <span class="sticker-emoji">${s.emoji}</span>
            <span class="sticker-label">${s.label}</span>
        </div>
    `).join('') + `
        <div class="sticker-option ${!selectedStickerId ? 'is-selected' : ''}" data-sticker-id="">
            <span class="sticker-emoji">—</span>
            <span class="sticker-label">Nenhuma</span>
        </div>
    `;

    container.querySelectorAll('.sticker-option').forEach(opt => {
        opt.addEventListener('click', () => {
            selectedStickerId = opt.dataset.stickerId || null;
            container.querySelectorAll('.sticker-option').forEach(o => o.classList.remove('is-selected'));
            opt.classList.add('is-selected');
        });
    });
}

function getStickerById(id) {
    return STICKERS.find(s => s.id === id) || null;
}

function renderLabelPicker(selectedIds) {
    const container = document.getElementById('labelPickerContainer');
    if (!container) return;
    selectedIds = selectedIds || [];

    if (state.labels.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="input-group">
            <label>Etiquetas</label>
            <div class="label-picker-list">
                ${state.labels.map(label => `
                    <label class="label-picker-item">
                        <input type="checkbox" class="label-picker-checkbox" value="${label.id}" ${selectedIds.includes(label.id) ? 'checked' : ''}>
                        <span class="label-swatch-dot" style="background:${label.color}"></span>
                        ${escapeHtml(label.name)}
                    </label>
                `).join('')}
            </div>
        </div>
    `;
}

function readSelectedLabelIds() {
    return [...document.querySelectorAll('.label-picker-checkbox:checked')].map(cb => cb.value);
}

// ==========================================
// FAVORITAR POST-IT
// ==========================================

function toggleStar(cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    card.starred = !card.starred;
    persistCard(card);
}

function applyBoardInfo() {
    const titleEl = document.getElementById('boardTitleDisplay');
    const descEl = document.getElementById('boardDescDisplay');
    if (titleEl) titleEl.textContent = state.boardInfo.name;
    if (descEl) descEl.textContent = state.boardInfo.description;
}

function getMemberRole(name) {
    if (!name || !state.members) return 'Observador';
    return state.members[name] || 'Observador';
}

function setMemberRole(name, role) {
    state.members[name] = role;
    saveState();
    logAudit(`Definiu "${name}" como ${role}`);
}

function removeMember(name) {
    delete state.members[name];
    saveState();
}

function applyObserverMode() {
    isObserver = getMemberRole(currentUserName) === 'Observador';
    document.body.classList.toggle('observer-mode', isObserver);
}

// ==========================================
// GRAVATAR (foto de perfil a partir do e-mail)
// ==========================================

function md5(inputString) {
    // MD5 verificado (constantes geradas via floor(abs(sin(i+1)) * 2^32), algoritmo padrão RFC 1321).
    const K = [];
    for (let i = 0; i < 64; i++) {
        K.push(Math.floor(Math.abs(Math.sin(i + 1)) * Math.pow(2, 32)) | 0);
    }
    const S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];

    function rotl(n, s) { return (n << s) | (n >>> (32 - s)); }
    function utf8Encode(str) { return unescape(encodeURIComponent(str)); }

    const str = utf8Encode(inputString);
    const len = str.length * 8;
    const nblk = ((len + 64 >> 9) | 0) + 1;
    const M = new Array(nblk * 16).fill(0);

    for (let i = 0; i < str.length; i++) {
        M[i >> 2] |= str.charCodeAt(i) << ((i % 4) * 8);
    }
    M[len >> 5] |= 0x80 << (len % 32);
    M[nblk * 16 - 2] = len;

    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

    for (let blk = 0; blk < nblk; blk++) {
        const chunk = M.slice(blk * 16, blk * 16 + 16);
        let A = a0, B = b0, C = c0, D = d0;

        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) { F = (B & C) | (~B & D); g = i; }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * i) % 16; }

            F = (F + A + K[i] + chunk[g]) | 0;
            A = D; D = C; C = B;
            B = (B + rotl(F, S[i])) | 0;
        }

        a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }

    function toHexLE(n) {
        let s = '';
        for (let i = 0; i < 4; i++) {
            s += ('0' + ((n >>> (i * 8)) & 0xff).toString(16)).slice(-2);
        }
        return s;
    }

    return [a0, b0, c0, d0].map(toHexLE).join('');
}

function gravatarUrl(email, size) {
    size = size || 80;
    const hash = md5((email || '').trim().toLowerCase());
    return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=${size}`;
}

function deriveNameFromEmail(email) {
    if (!email) return '';
    const local = email.split('@')[0] || email;
    return local
        .split(/[.\-_]+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
}

function getAvatarUrl(email, size) {
    if (state.customAvatars && state.customAvatars[email]) {
        return state.customAvatars[email];
    }
    return gravatarUrl(email, size);
}

function setCustomAvatar(email, dataUrl) {
    if (!state.customAvatars) state.customAvatars = {};
    state.customAvatars[email] = dataUrl;
    saveState();
    logAudit(`Atualizou a foto de perfil de "${email}"`);
    refreshAllAvatarUI();
}

function refreshAllAvatarUI() {
    renderOnlineUsers(currentUserName);

    const footAvatarEl = document.getElementById('sidebarFootAvatar');
    if (footAvatarEl && currentUserName) {
        footAvatarEl.innerHTML = `<img src="${getAvatarUrl(currentUserName, 68)}" alt="${escapeHtml(currentUserName)}" style="width:100%; height:100%; object-fit:cover; border-radius:inherit;">`;
    }

    const usersModal = document.getElementById('usersModal');
    if (usersModal && usersModal.style.display === 'flex') {
        renderUsersList();
    }
}

function updatePendingApprovalsBadge() {
    const badge = document.getElementById('pendingApprovalsBadge');
    if (!badge) return;
    const isAdmin = getMemberRole(currentUserName) === 'Admin';
    const count = (state.pendingApprovals || []).length + (state.passwordResetRequests || []).length;

    if (isAdmin && count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

function renderPasswordResetList() {
    const container = document.getElementById('passwordResetList');
    if (!state.passwordResetRequests) state.passwordResetRequests = [];
    state.mentions = state.mentions || [];

    if (state.passwordResetRequests.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhum pedido de redefinição.</p>';
        return;
    }

    container.innerHTML = '';
    state.passwordResetRequests.forEach(email => {
        const row = document.createElement('div');
        row.className = 'member-row';
        row.innerHTML = `
            <span class="member-row-name">${escapeHtml(email)}</span>
            <div class="member-row-actions">
                <button type="button" class="btn-secondary" data-action="reset">Redefinir</button>
            </div>
        `;
        row.querySelector('[data-action="reset"]').addEventListener('click', () => {
            delete state.userPasswords[email];
            state.passwordResetRequests = state.passwordResetRequests.filter(e => e !== email);
            saveState();
            renderPasswordResetList();
            updatePendingApprovalsBadge();
            logAudit(`Redefiniu a senha de "${email}"`);
            showToast(`Senha de ${email} liberada — a pessoa define uma nova no próximo login.`, 'success');
        });
        container.appendChild(row);
    });
}

function renderPendingApprovalsList() {
    const container = document.getElementById('pendingApprovalsList');
    if (!state.pendingApprovals) state.pendingApprovals = [];

    if (state.pendingApprovals.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhuma solicitação pendente.</p>';
        return;
    }

    container.innerHTML = '';
    state.pendingApprovals.forEach(email => {
        const row = document.createElement('div');
        row.className = 'member-row';
        row.innerHTML = `
            <span class="member-row-name">${escapeHtml(email)}</span>
            <div class="member-row-actions">
                <button type="button" class="btn-secondary" data-action="approve">Aprovar</button>
                <button type="button" class="remove-row-btn" title="Recusar">&times;</button>
            </div>
        `;
        row.querySelector('[data-action="approve"]').addEventListener('click', () => {
            setMemberRole(email, 'Editor');
            state.pendingApprovals = state.pendingApprovals.filter(e => e !== email);
            saveState();
            renderPendingApprovalsList();
            renderMembersList();
            updatePendingApprovalsBadge();
            renderBoard();
            showToast(`${email} aprovado(a) como Editor.`, 'success');
        });
        row.querySelector('.remove-row-btn').addEventListener('click', () => {
            state.pendingApprovals = state.pendingApprovals.filter(e => e !== email);
            saveState();
            renderPendingApprovalsList();
            updatePendingApprovalsBadge();
            showToast(`Solicitação de ${email} recusada.`);
        });
        container.appendChild(row);
    });
}

function renderMembersList() {
    const list = document.getElementById('membersList');
    const names = Object.keys(state.members).filter(name => name !== BOOTSTRAP_ADMIN_EMAIL || name === currentUserName);

    if (names.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhum membro convidado ainda — quem não estiver aqui só vê o Dashboard, sem acesso ao quadro.</p>';
    } else {
        list.innerHTML = '';
        names.forEach(name => {
            const row = document.createElement('div');
            row.className = 'member-row';
            row.innerHTML = `
                <span class="member-row-name">${escapeHtml(name)}${name === currentUserName ? ' (você)' : ''}</span>
                <div class="member-row-actions">
                    <select class="member-role-select">
                        <option value="Editor">Editor</option>
                        <option value="Admin">Admin</option>
                        <option value="Observador">Observador</option>
                    </select>
                    <button type="button" class="remove-row-btn" title="Remover">&times;</button>
                </div>
            `;
            row.querySelector('.member-role-select').value = state.members[name];
            row.querySelector('.member-role-select').addEventListener('change', (e) => {
                setMemberRole(name, e.target.value);
                if (name === currentUserName) location.reload();
            });
            row.querySelector('.remove-row-btn').addEventListener('click', () => {
                showConfirm(`Remover "${name}" do quadro? Essa pessoa perde o acesso imediatamente (volta a só ver o Dashboard).`, () => {
                    removeMember(name);
                    renderMembersList();
                    if (name === currentUserName) location.reload();
                });
            });
            list.appendChild(row);
        });
    }

    // Visitantes que abriram o quadro (via SSO) mas ainda não foram convidados —
    // hoje eles só enxergam o Dashboard. Um clique aqui já convida com o papel escolhido.
    const visitorsList = document.getElementById('uninvitedVisitorsList');
    if (!visitorsList) return;

    const visitorEmails = Object.keys(state.visitorLog || {}).filter(email => !state.members[email]);

    if (visitorEmails.length === 0) {
        visitorsList.innerHTML = '<p style="color:var(--text-muted); font-size:0.8rem;">Ninguém esperando convite no momento.</p>';
        return;
    }

    visitorsList.innerHTML = '';
    visitorEmails
        .sort((a, b) => state.visitorLog[b] - state.visitorLog[a])
        .forEach(email => {
            const lastSeen = new Date(state.visitorLog[email]).toLocaleDateString('pt-BR');
            const row = document.createElement('div');
            row.className = 'member-row';
            row.innerHTML = `
                <span class="member-row-name">${escapeHtml(email)}<br><span style="color:var(--text-muted); font-size:0.72rem;">Só viu o Dashboard — último acesso ${lastSeen}</span></span>
                <div class="member-row-actions">
                    <select class="invite-visitor-role-select">
                        <option value="Observador">Convidar: Observador</option>
                        <option value="Editor">Convidar: Editor</option>
                        <option value="Admin">Convidar: Admin</option>
                    </select>
                </div>
            `;
            row.querySelector('.invite-visitor-role-select').addEventListener('change', (e) => {
                setMemberRole(email, e.target.value);
                showToast(`${email} convidado como ${e.target.value}!`, 'success');
                renderMembersList();
            });
            visitorsList.appendChild(row);
        });
}

// ==========================================
// DASHBOARD & ANALYTICS
// ==========================================

function computeAnalytics() {
    const activeCards = state.cards.filter(c => !c.archived);
    const total = activeCards.length;
    const doneIds = state.people.filter(p => p.isDone).map(p => p.id);
    const done = activeCards.filter(c => doneIds.includes(c.personId)).length;
    const overdue = activeCards.filter(c => isOverdue(c) && !doneIds.includes(c.personId)).length;

    const avgProgress = total > 0
        ? Math.round(activeCards.reduce((sum, c) => sum + getProgress(c).percent, 0) / total)
        : 0;

    const byPriority = { alta: 0, media: 0, baixa: 0 };
    activeCards.forEach(c => { if (byPriority[c.priority] !== undefined) byPriority[c.priority]++; });

    const byPerson = {};
    state.people.filter(p => !p.isDone).forEach(p => { byPerson[p.name] = 0; });
    activeCards.forEach(c => {
        const person = state.people.find(p => p.id === c.personId);
        if (person && !person.isDone) byPerson[person.name] = (byPerson[person.name] || 0) + 1;
    });

    return { total, done, overdue, avgProgress, byPriority, byPerson };
}

// ==========================================
// RELATÓRIO DE ENTREGAS (Admin) — prazos e produtividade
// ==========================================

let currentReportPeriod = 'day';

function getReportDateRange() {
    const fromEl = document.getElementById('reportDateFrom');
    const toEl = document.getElementById('reportDateTo');
    const from = fromEl && fromEl.value ? new Date(fromEl.value + 'T00:00:00').getTime() : null;
    const to = toEl && toEl.value ? new Date(toEl.value + 'T23:59:59').getTime() : null;
    return { from, to };
}

function inReportDateRange(completedAt, range) {
    if (range.from && completedAt < range.from) return false;
    if (range.to && completedAt > range.to) return false;
    return true;
}

function computeDeliveryStats() {
    const range = getReportDateRange();
    const completed = state.cards.filter(c => c.completedAt && inReportDateRange(c.completedAt, range));
    let onTime = 0, late = 0, noDueDate = 0;

    completed.forEach(c => {
        if (!c.dueDate) { noDueDate++; return; }
        const due = new Date(c.dueDate + 'T23:59:59').getTime();
        if (c.completedAt <= due) onTime++; else late++;
    });

    const withDueDate = onTime + late;
    return {
        total: completed.length,
        onTime,
        late,
        noDueDate,
        onTimePct: withDueDate > 0 ? Math.round((onTime / withDueDate) * 100) : 0,
        latePct: withDueDate > 0 ? Math.round((late / withDueDate) * 100) : 0
    };
}

function groupCompletionsByPeriod(period) {
    const completed = state.cards.filter(c => c.completedAt);
    const buckets = [];
    const now = new Date();

    if (period === 'day') {
        for (let i = 6; i >= 0; i--) {
            const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
            const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
            const label = start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            const count = completed.filter(c => c.completedAt >= start.getTime() && c.completedAt < end.getTime()).length;
            buckets.push({ label, count });
        }
    } else if (period === 'week') {
        for (let i = 7; i >= 0; i--) {
            const ref = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7);
            const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - ref.getDay());
            const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
            const label = `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')}`;
            const count = completed.filter(c => c.completedAt >= start.getTime() && c.completedAt < end.getTime()).length;
            buckets.push({ label, count });
        }
    } else {
        for (let i = 5; i >= 0; i--) {
            const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
            const label = start.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
            const count = completed.filter(c => c.completedAt >= start.getTime() && c.completedAt < end.getTime()).length;
            buckets.push({ label, count });
        }
    }

    return buckets;
}

// Anel de score circular (0-100%), no padrão do design system MSE Capex Seguro
function dashRing(pct, { size = 46, stroke = 5 } = {}) {
    const r = (size - stroke) / 2 - 1;
    const C = 2 * Math.PI * r;
    const off = C * (1 - Math.max(0, Math.min(1, pct / 100)));
    const color = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--gold)' : 'var(--red)';
    return `<div class="podium-ring" style="width:${size}px;height:${size}px">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#e7eaef" stroke-width="${stroke}"/>
            <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
                stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
        </svg>
        <div class="pr-txt"><span class="pr-n">${pct}%</span></div>
    </div>`;
}

function computeDeliveryStatsByPerson() {
    const range = getReportDateRange();
    const completed = state.cards.filter(c => c.completedAt && inReportDateRange(c.completedAt, range));
    const byPerson = {};

    completed.forEach(c => {
        const person = state.people.find(p => p.id === c.personId);
        const personId = person ? person.id : '__sem_coluna__';
        const isLate = c.dueDate && c.completedAt > new Date(c.dueDate + 'T23:59:59').getTime();
        const hasDueDate = !!c.dueDate;

        if (!byPerson[personId]) {
            byPerson[personId] = {
                total: 0, onTime: 0, late: 0,
                displayName: person ? person.name : 'Sem coluna',
                avatarKey: person ? (person.memberEmail || person.avatarUrl || null) : null
            };
        }
        byPerson[personId].total++;
        if (hasDueDate) {
            if (isLate) byPerson[personId].late++;
            else byPerson[personId].onTime++;
        }
    });

    return Object.entries(byPerson)
        .map(([personId, s]) => {
            const withDueDate = s.onTime + s.late;
            return {
                personId,
                name: s.displayName,
                avatarKey: s.avatarKey,
                total: s.total,
                onTime: s.onTime,
                late: s.late,
                onTimePct: withDueDate > 0 ? Math.round((s.onTime / withDueDate) * 100) : null
            };
        })
        .sort((a, b) => {
            // Quem tem % calculado vem primeiro, do melhor pro pior. Sem prazo definido fica por último.
            if (a.onTimePct === null && b.onTimePct === null) return b.total - a.total;
            if (a.onTimePct === null) return 1;
            if (b.onTimePct === null) return -1;
            return b.onTimePct - a.onTimePct;
        });
}

function exportDeliveryReportCsv() {
    const stats = computeDeliveryStats();
    const byPerson = computeDeliveryStatsByPerson();
    const buckets = groupCompletionsByPeriod(currentReportPeriod);

    let csv = 'Relatório de Entregas - MSE Board\n\n';
    csv += 'Resumo Geral\n';
    csv += `Total Concluídos;${stats.total}\n`;
    csv += `No Prazo (%);${stats.onTimePct}\n`;
    csv += `Atrasados (%);${stats.latePct}\n\n`;

    csv += 'Concluídos por Período\n';
    csv += 'Período;Quantidade\n';
    buckets.forEach(b => { csv += `${b.label};${b.count}\n`; });
    csv += '\n';

    csv += 'Desempenho por Pessoa\n';
    csv += 'Nome;Concluídos;No Prazo;Atrasados;% No Prazo\n';
    byPerson.forEach(p => {
        csv += `${p.name};${p.total};${p.onTime};${p.late};${p.onTimePct === null ? 'sem prazo' : p.onTimePct + '%'}\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-entregas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function renderDeliveryReport() {
    const stats = computeDeliveryStats();
    document.getElementById('reportTotalDone').textContent = stats.total;
    document.getElementById('reportOnTimePct').textContent = `${stats.onTimePct}%`;
    document.getElementById('reportLatePct').textContent = `${stats.latePct}%`;

    const range = getReportDateRange();
    const noteEl = document.getElementById('reportPeriodNote');
    if (range.from || range.to) {
        const fromLabel = range.from ? new Date(range.from).toLocaleDateString('pt-BR') : '…';
        const toLabel = range.to ? new Date(range.to).toLocaleDateString('pt-BR') : '…';
        noteEl.textContent = `Entregas de ${fromLabel} até ${toLabel}`;
    } else {
        noteEl.textContent = 'Todas as entregas registradas';
    }

    const buckets = groupCompletionsByPeriod(currentReportPeriod);
    const max = Math.max(1, ...buckets.map(b => b.count));

    const rows = buckets.map(b => `
        <div class="chart-row">
            <span class="chart-row-label">${escapeHtml(b.label)}</span>
            <div class="chart-row-track"><div class="chart-row-fill" style="width:${(b.count / max) * 100}%"></div></div>
            <span class="chart-row-count">${b.count}</span>
        </div>
    `).join('');

    document.getElementById('reportChart').innerHTML = rows;

    // ---------- Ranking em tabela, com foto de perfil ----------
    const byPerson = computeDeliveryStatsByPerson();
    const tableBody = document.getElementById('reportByPerson');

    // ---------- Pódios: Mais Pontuais / Mais Atrasos ----------
    const withPct = byPerson.filter(p => p.onTimePct !== null);
    const bestThree = [...withPct].sort((a, b) => b.onTimePct - a.onTimePct).slice(0, 3);
    const worstThree = [...withPct].sort((a, b) => a.onTimePct - b.onTimePct).slice(0, 3);

    function buildPodiumEntry(p, isWorst) {
        const avatarSrc = p.avatarKey
            ? (p.avatarKey.includes('@') ? getAvatarUrl(p.avatarKey, 64) : p.avatarKey)
            : null;
        const avatarHtml = avatarSrc
            ? `<img src="${avatarSrc}" class="podium-entry-avatar" alt="">`
            : `<span class="podium-entry-avatar podium-entry-avatar-fallback">${getInitials(p.name)}</span>`;
        const subLabel = isWorst ? `${p.late} atrasada${p.late > 1 ? 's' : ''} de ${p.onTime + p.late}` : `${p.onTime} de ${p.onTime + p.late} no prazo`;
        return `
            <div class="podium-entry">
                ${dashRing(p.onTimePct, { size: 44, stroke: 5 })}
                ${avatarHtml}
                <div class="podium-entry-info">
                    <div class="podium-entry-name">${escapeHtml(p.name)}</div>
                    <div class="podium-entry-sub">${subLabel}</div>
                </div>
            </div>
        `;
    }

    const podiumBestEl = document.getElementById('reportPodiumBest');
    const podiumWorstEl = document.getElementById('reportPodiumWorst');

    podiumBestEl.innerHTML = bestThree.length > 0
        ? bestThree.map(p => buildPodiumEntry(p, false)).join('')
        : '<div class="dashboard-podium-empty">SEM DADOS SUFICIENTES NESSE PERÍODO</div>';

    podiumWorstEl.innerHTML = worstThree.length > 0
        ? worstThree.map(p => buildPodiumEntry(p, true)).join('')
        : '<div class="dashboard-podium-empty">SEM DADOS SUFICIENTES NESSE PERÍODO</div>';

    if (byPerson.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:1.5rem; font-family:var(--font-mono);">AINDA NÃO HÁ ENTREGAS CONCLUÍDAS COM RESPONSÁVEL ATRIBUÍDO NESSE PERÍODO.</td></tr>`;
    } else {
        tableBody.innerHTML = byPerson.map((p, idx) => {
            const pctColor = p.onTimePct === null ? 'var(--text-muted)' : (p.onTimePct >= 70 ? 'var(--green)' : p.onTimePct >= 40 ? 'var(--gold)' : 'var(--red)');
            const pctLabel = p.onTimePct === null ? '—' : `${p.onTimePct}%`;
            const onTimeWidth = p.onTimePct === null ? 0 : p.onTimePct;
            const lateWidth = p.onTimePct === null ? 0 : (100 - p.onTimePct);

            const rankBadgeClass = idx === 0 ? 'dash-rank-gold' : idx === 1 ? 'dash-rank-silver' : idx === 2 ? 'dash-rank-bronze' : 'dash-rank-plain';

            const avatarSrc = p.avatarKey
                ? (p.avatarKey.includes('@') ? getAvatarUrl(p.avatarKey, 60) : p.avatarKey)
                : null;
            const avatarHtml = avatarSrc
                ? `<img src="${avatarSrc}" class="dash-table-avatar" alt="">`
                : `<span class="dash-table-avatar dash-table-avatar-fallback">${getInitials(p.name)}</span>`;
            const displayName = p.name;

            return `
                <tr>
                    <td><span class="dash-rank-badge ${rankBadgeClass}">${idx + 1}</span></td>
                    <td>
                        <div class="dash-person-cell">
                            ${avatarHtml}
                            <span>${escapeHtml(displayName)}</span>
                        </div>
                    </td>
                    <td class="dash-ontime-num">${p.onTime}</td>
                    <td class="dash-late-num">${p.late}</td>
                    <td class="dash-total-num">${p.total}</td>
                    <td>
                        <div class="dash-proportion-bar">
                            <div class="dash-proportion-ontime" style="width:${onTimeWidth}%;"></div>
                            <div class="dash-proportion-late" style="width:${lateWidth}%;"></div>
                        </div>
                    </td>
                    <td><span class="dash-pct-label" style="color:${pctColor};">${pctLabel}</span></td>
                </tr>
            `;
        }).join('');
    }

    // ---------- Tarefas por pessoa, em formato de planilha (todas as raias) ----------
    const activeContainer = document.getElementById('reportActiveTasksByPerson');
    const byColumn = {};
    const laneLabels = { afazer: 'A Fazer', todo: 'Fazendo', testing: 'Em Teste', paused: 'Pausado', done: 'Concluída' };

    // Filtros da tabela (busca por texto, pessoa, raia)
    const taskSearchTerm = (document.getElementById('taskSearchInput')?.value || '').toLowerCase().trim();
    const taskFilterPersonId = document.getElementById('taskFilterPerson')?.value || '';
    const taskFilterLane = document.getElementById('taskFilterLane')?.value || '';

    // Popula o dropdown de pessoas (só na primeira vez / se mudou)
    const personFilterSelect = document.getElementById('taskFilterPerson');
    if (personFilterSelect) {
        const currentValue = personFilterSelect.value;
        const peopleWithCards = [...new Set(state.cards.filter(c => !c.archived).map(c => c.personId))]
            .map(pid => state.people.find(p => p.id === pid))
            .filter(Boolean)
            .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        personFilterSelect.innerHTML = '<option value="">Todas</option>' +
            peopleWithCards.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
        if ([...personFilterSelect.options].some(o => o.value === currentValue)) {
            personFilterSelect.value = currentValue;
        }
    }

    state.cards.filter(c => !c.archived).forEach(card => {
        const person = state.people.find(p => p.id === card.personId);
        const personId = person ? person.id : '__sem_coluna__';

        // Aplica os filtros — pula o cartão se não bater
        if (taskFilterPersonId && personId !== taskFilterPersonId) return;
        if (taskFilterLane && (card.status || 'todo') !== taskFilterLane) return;
        if (taskSearchTerm) {
            const haystack = `${card.title} ${person ? person.name : ''}`.toLowerCase();
            if (!haystack.includes(taskSearchTerm)) return;
        }

        if (!byColumn[personId]) {
            byColumn[personId] = {
                displayName: person ? person.name : 'Sem coluna',
                cards: []
            };
        }
        byColumn[personId].cards.push(card);
    });

    const columnIds = Object.keys(byColumn).sort((a, b) => {
        if (a === '__sem_coluna__') return 1;
        if (b === '__sem_coluna__') return -1;
        return byColumn[a].displayName.localeCompare(byColumn[b].displayName, 'pt-BR');
    });

    if (columnIds.length === 0) {
        activeContainer.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:1.5rem; font-family:var(--font-mono);">NENHUMA TAREFA ENCONTRADA COM ESSE FILTRO.</td></tr>`;
        return;
    }

    activeContainer.innerHTML = columnIds.map(personId => {
        const group = byColumn[personId];
        const cards = group.cards.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'pt-BR'));

        const personHeaderRow = `
            <tr class="dash-person-group-row">
                <td colspan="7">${escapeHtml(group.displayName)} <span class="dash-person-group-count">${cards.length} tarefa${cards.length > 1 ? 's' : ''}</span></td>
            </tr>
        `;

        const taskRows = cards.map(c => {
            const progress = getProgress(c);
            const startLabel = c.startDate ? formatDateBR(c.startDate) : (c.createdAt ? new Date(c.createdAt).toLocaleDateString('pt-BR') : '—');
            const endLabel = c.dueDate ? formatDateBR(c.dueDate) : 'sem prazo';
            const laneLabel = laneLabels[c.status || 'todo'] || 'Fazendo';

            let barColor;
            if (c.status === 'done') barColor = 'var(--green)';
            else if (c.dueDate && isOverdue(c)) barColor = 'var(--red)';
            else if (c.dueDate && isDueSoon(c)) barColor = 'var(--gold)';
            else barColor = 'var(--accent)';

            return `
                <tr class="dash-task-row" onclick="document.getElementById('deliveryReportModal').style.display='none'; openViewModal('${c.id}')">
                    <td class="dash-task-title-cell">${escapeHtml(c.title)}</td>
                    <td><span class="dash-lane-tag dash-lane-${c.status || 'todo'}">${laneLabel}</span></td>
                    <td class="dash-mono-cell">${startLabel}</td>
                    <td class="dash-mono-cell">${endLabel}</td>
                    <td class="dash-mono-cell">${progress.percent}%</td>
                    <td>
                        <div class="dash-task-progress-track dash-table-progress-track">
                            <div class="dash-task-progress-fill" style="width:${progress.percent}%; background:${barColor};"></div>
                        </div>
                    </td>
                    <td class="dash-obs-cell">
                        <textarea class="dash-obs-box" placeholder="Escrever observação..." onclick="event.stopPropagation()" onblur="saveDashboardObservation('${c.id}', this.value)">${escapeHtml(c.observacao || '')}</textarea>
                    </td>
                </tr>
            `;
        }).join('');

        return personHeaderRow + taskRows;
    }).join('');
}

function saveDashboardObservation(cardId, value) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    if (card.observacao === value) return; // nada mudou, evita salvar à toa
    card.observacao = value;
    persistCard(card);
    showToast('Observação salva!', 'success');
}

function renderAnalytics() {
    const stats = computeAnalytics();
    const container = document.getElementById('analyticsContent');

    const maxPriority = Math.max(1, ...Object.values(stats.byPriority));
    const maxPerson = Math.max(1, ...Object.values(stats.byPerson));

    const priorityRows = Object.entries(stats.byPriority).map(([key, count]) => {
        const label = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }[key];
        return `
            <div class="chart-row">
                <span class="chart-row-label">${label}</span>
                <div class="chart-row-track"><div class="chart-row-fill" style="width:${(count / maxPriority) * 100}%"></div></div>
                <span class="chart-row-count">${count}</span>
            </div>
        `;
    }).join('');

    const personRows = Object.entries(stats.byPerson).map(([name, count]) => `
        <div class="chart-row">
            <span class="chart-row-label">${escapeHtml(name)}</span>
            <div class="chart-row-track"><div class="chart-row-fill" style="width:${(count / maxPerson) * 100}%"></div></div>
            <span class="chart-row-count">${count}</span>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-value">${stats.total}</div><div class="stat-label">Tarefas ativas</div></div>
            <div class="stat-card"><div class="stat-value">${stats.done}</div><div class="stat-label">Concluídos</div></div>
            <div class="stat-card"><div class="stat-value">${stats.overdue}</div><div class="stat-label">Atrasados</div></div>
            <div class="stat-card"><div class="stat-value">${stats.avgProgress}%</div><div class="stat-label">Progresso médio</div></div>
        </div>
        <div class="chart-section">
            <h4>Por Prioridade</h4>
            ${priorityRows}
        </div>
        <div class="chart-section">
            <h4>Por Pessoa</h4>
            ${personRows || '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhuma pessoa cadastrada ainda.</p>'}
        </div>
    `;
}

// ==========================================
// TEMA (CLARO / ESCURO)
// ==========================================

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(`mse_theme_${currentUserName}`, theme);
}

function markCurrentThemeButton() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    document.querySelectorAll('.theme-option-btn').forEach(btn => {
        btn.classList.toggle('is-current', btn.dataset.themeChoice === current);
    });
}

// ==========================================
// APARÊNCIA PERSONALIZÁVEL (cor, cantos, densidade, textura)
// ==========================================

function darkenHex(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    let r = Math.max(0, (num >> 16) - amount);
    let g = Math.max(0, ((num >> 8) & 0x00FF) - amount);
    let b = Math.max(0, (num & 0x0000FF) - amount);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function applyAccentColor(hex, persist) {
    document.documentElement.style.setProperty('--accent', hex);
    document.documentElement.style.setProperty('--accent-hover', darkenHex(hex, 32));
    if (persist !== false) localStorage.setItem(`mse_accent_${currentUserName}`, hex);
}

const CORNER_PRESETS = {
    sharp: { s: '2px', m: '4px', l: '6px' },
    soft: { s: '6px', m: '10px', l: '16px' },
    round: { s: '10px', m: '16px', l: '24px' }
};

function applyCorners(preset, persist) {
    const p = CORNER_PRESETS[preset] || CORNER_PRESETS.soft;
    document.documentElement.style.setProperty('--radius-s', p.s);
    document.documentElement.style.setProperty('--radius-m', p.m);
    document.documentElement.style.setProperty('--radius-l', p.l);
    if (persist !== false) localStorage.setItem(`mse_corners_${currentUserName}`, preset);
    document.querySelectorAll('.corner-option-btn').forEach(btn => {
        btn.classList.toggle('is-current', btn.dataset.corners === preset);
    });
}

const DENSITY_PRESETS = {
    compact: { cardPad: '0.6rem', colPad: '0.7rem', gap: '0.6rem' },
    cozy: { cardPad: '0.9rem', colPad: '1rem', gap: '0.9rem' },
    spacious: { cardPad: '1.3rem', colPad: '1.4rem', gap: '1.3rem' }
};

function applyDensity(preset, persist) {
    const p = DENSITY_PRESETS[preset] || DENSITY_PRESETS.cozy;
    document.documentElement.style.setProperty('--density-card-pad', p.cardPad);
    document.documentElement.style.setProperty('--density-col-pad', p.colPad);
    document.documentElement.style.setProperty('--density-gap', p.gap);
    if (persist !== false) localStorage.setItem(`mse_density_${currentUserName}`, preset);
    document.querySelectorAll('.density-option-btn').forEach(btn => {
        btn.classList.toggle('is-current', btn.dataset.density === preset);
    });
}

function applyGrain(on, persist) {
    document.body.classList.toggle('grain-on', on);
    if (persist !== false) localStorage.setItem(`mse_grain_${currentUserName}`, on ? '1' : '0');
}

function loadAppearancePrefs() {
    applyAccentColor(localStorage.getItem(`mse_accent_${currentUserName}`) || '#F02A2B', false);
    applyCorners(localStorage.getItem(`mse_corners_${currentUserName}`) || 'soft', false);
    applyDensity(localStorage.getItem(`mse_density_${currentUserName}`) || 'cozy', false);
    applyGrain(localStorage.getItem(`mse_grain_${currentUserName}`) === '1', false);
}

function markCurrentAccentSwatch() {
    const current = (localStorage.getItem(`mse_accent_${currentUserName}`) || '#F02A2B').toLowerCase();
    document.querySelectorAll('.accent-swatch[data-accent]').forEach(btn => {
        btn.classList.toggle('is-current', btn.dataset.accent.toLowerCase() === current);
    });
}

function openPreferencesModal() {
    markCurrentThemeButton();
    markCurrentAccentSwatch();
    document.querySelectorAll('.corner-option-btn').forEach(btn => {
        btn.classList.toggle('is-current', btn.dataset.corners === (localStorage.getItem(`mse_corners_${currentUserName}`) || 'soft'));
    });
    document.querySelectorAll('.density-option-btn').forEach(btn => {
        btn.classList.toggle('is-current', btn.dataset.density === (localStorage.getItem(`mse_density_${currentUserName}`) || 'cozy'));
    });
    document.getElementById('grainToggle').checked = localStorage.getItem(`mse_grain_${currentUserName}`) === '1';
    const notifPref = localStorage.getItem(`mse_notifications_${currentUserName}`);
    document.getElementById('notificationsToggle').checked = notifPref !== '0';
    document.getElementById('preferencesModal').style.display = 'flex';
}

// ==========================================
// VISUALIZAÇÕES DO QUADRO
// ==========================================

function openViewsModal() {
    document.querySelectorAll('.view-option-btn').forEach(btn => {
        btn.classList.toggle('is-current', btn.dataset.view === currentView);
    });
    document.getElementById('viewsModal').style.display = 'flex';
}

// ==========================================
// MODO APRESENTAÇÃO
// ==========================================

function enterPresentationMode() {
    document.body.classList.add('presentation-mode');
    document.getElementById('exitPresentationBtn').style.display = 'block';
}

function exitPresentationMode() {
    document.body.classList.remove('presentation-mode');
    document.getElementById('exitPresentationBtn').style.display = 'none';
}

let customFieldIdCounter = 0;

function addCustomField(name, type) {
    customFieldIdCounter++;
    const id = `field_${Date.now()}_${customFieldIdCounter}`;
    state.customFields.push({ id, name, type });
    saveState();
    logAudit(`Criou o campo personalizado "${name}"`);
}

function removeCustomField(id) {
    const field = state.customFields.find(f => f.id === id);
    state.customFields = state.customFields.filter(f => f.id !== id);
    state.cards.forEach(c => { if (c.customValues) delete c.customValues[id]; });
    saveState();
    if (field) logAudit(`Removeu o campo personalizado "${field.name}"`);
}

function renderFieldsList() {
    const list = document.getElementById('fieldsList');
    if (state.customFields.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhum campo personalizado ainda.</p>';
        return;
    }

    const typeLabels = { texto: 'Texto', numero: 'Número', moeda: 'Moeda (R$)', data: 'Data' };

    list.innerHTML = '';
    state.customFields.forEach(field => {
        const row = document.createElement('div');
        row.className = 'field-row';
        row.innerHTML = `
            <span>
                <span class="field-row-name">${escapeHtml(field.name)}</span><br>
                <span class="field-row-type">${typeLabels[field.type] || field.type}</span>
            </span>
            <div class="field-row-actions">
                <button type="button" class="remove-row-btn" title="Remover">&times;</button>
            </div>
        `;
        row.querySelector('.remove-row-btn').addEventListener('click', () => {
            removeCustomField(field.id);
            renderFieldsList();
        });
        list.appendChild(row);
    });
}

function renderCustomFieldsInputs(existingValues) {
    const container = document.getElementById('customFieldsContainer');
    if (!container) return;
    existingValues = existingValues || {};

    if (state.customFields.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = state.customFields.map(field => {
        const inputType = field.type === 'data' ? 'date' : (field.type === 'numero' || field.type === 'moeda') ? 'number' : 'text';
        const value = existingValues[field.id] || '';
        const label = field.type === 'moeda' ? `${field.name} (R$)` : field.name;
        return `
            <div class="input-group">
                <label>${escapeHtml(label)}</label>
                <input type="${inputType}" class="custom-field-input" data-field-id="${field.id}" value="${escapeHtml(String(value))}" step="${field.type === 'moeda' ? '0.01' : '1'}">
            </div>
        `;
    }).join('');
}

function readCustomFieldValues() {
    const values = {};
    document.querySelectorAll('.custom-field-input').forEach(input => {
        if (input.value !== '') values[input.dataset.fieldId] = input.value;
    });
    return values;
}

function fireWebhook(event, payload) {
    const url = localStorage.getItem('mse_webhook_url');
    if (!url) return;

    fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() })
    }).catch(() => {
        logError(
            'Falha ao enviar webhook',
            'Verifique se a URL do webhook em Integrações e Webhooks está correta e se o serviço de destino está no ar.'
        );
    });
}

// ==========================================
// FUNDO PERSONALIZÁVEL DO QUADRO
// ==========================================

const GRADIENT_PRESETS = [
    { name: 'Puro (padrão)', css: '#FAF8F5' },
    { name: 'Vermelho Suave', css: 'linear-gradient(135deg, #FAF8F5 0%, #F3D9D5 100%)' },
    { name: 'Dourado Sutil', css: 'linear-gradient(135deg, #FAF8F5 0%, #F0E4C8 100%)' },
    { name: 'Mármore', css: 'linear-gradient(135deg, #FDFCFA 0%, #EDEAE3 50%, #F5F1E8 100%)' },
    { name: 'Champagne', css: 'linear-gradient(135deg, #FAF8F5 0%, #E9DCC3 100%)' },
    { name: 'Carvão Suave', css: 'linear-gradient(135deg, #FAF8F5 0%, #DCD6CC 100%)' },
    { name: 'Aurora Vermelha', css: 'radial-gradient(circle at top right, #F9DAD8 0%, #FAF8F5 60%)' },
    { name: 'Vermelho Profundo', css: 'linear-gradient(160deg, #FAF8F5 0%, #ECC0BC 55%, #F02A2B 150%)' }
];

function renderGradientPresets() {
    const container = document.getElementById('gradientPresets');
    container.innerHTML = '';
    GRADIENT_PRESETS.forEach(preset => {
        const swatch = document.createElement('div');
        swatch.className = 'gradient-swatch';
        swatch.style.background = preset.css;
        swatch.title = preset.name;
        swatch.addEventListener('click', () => {
            setBoardBackground('gradient', preset.css);
            document.getElementById('settingsModal').style.display = 'none';
            showToast('Fundo atualizado com sucesso!', 'success');
        });
        container.appendChild(swatch);
    });
}

function setBoardBackground(type, value) {
    try {
        localStorage.setItem(`mse_board_bg_${currentUserName}`, JSON.stringify({ type, value }));
    } catch (err) {
        console.error('Falha ao salvar o fundo (provavelmente arquivo grande demais):', err);
        return false;
    }
    applyBoardBackground();
    return true;
}

function applyBoardBackground() {
    const saved = localStorage.getItem(`mse_board_bg_${currentUserName}`);
    if (!saved) {
        document.body.style.background = '';
        return;
    }
    const bg = JSON.parse(saved);
    if (bg.type === 'gradient') {
        document.body.style.background = bg.value;
        document.body.style.backgroundAttachment = 'fixed';
    } else if (bg.type === 'image') {
        document.body.style.background = `linear-gradient(rgba(250,248,245,0.55), rgba(250,248,245,0.55)), url('${bg.value}') center/cover fixed`;
    }
}

// ==========================================
// BACKUP & EXPORTAÇÃO DE DADOS
// ==========================================

// ==========================================
// BACKUP NO SERVIDOR
// ==========================================

async function fetchBackupsList() {
    try {
        const res = await fetch(`${API_BASE}/list_backups.php`, { headers: { 'X-API-Key': API_SECRET } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
    } catch (err) {
        console.error('Falha ao listar backups:', err);
        return null;
    }
}

async function renderBackupsList() {
    const container = document.getElementById('backupsList');
    container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Carregando...</p>';

    const backups = await fetchBackupsList();
    if (backups === null) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Não foi possível carregar a lista de backups.</p>';
        return;
    }
    if (backups.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhum backup ainda. Clique em "Criar Backup Agora".</p>';
        return;
    }

    container.innerHTML = backups.map(b => `
        <div class="member-row">
            <span class="member-row-name">${escapeHtml(b.filename)}<br><span style="color:var(--text-muted); font-size:0.72rem;">${b.date} — ${b.sizeKb} KB</span></span>
            <button type="button" class="btn-secondary restore-backup-btn" data-filename="${escapeHtml(b.filename)}">Restaurar</button>
        </div>
    `).join('');

    container.querySelectorAll('.restore-backup-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const filename = btn.dataset.filename;
            showConfirm(`Restaurar "${filename}"? Isso vai SOBRESCREVER todos os dados atuais do quadro (tarefas, pessoas, membros). Essa ação não pode ser desfeita.`, async () => {
                showToast('Restaurando backup...');
                const res = await apiCall('restore_backup.php', { filename });
                if (res && res.success) {
                    showToast('Backup restaurado! Recarregando a página...', 'success');
                    setTimeout(() => location.reload(), 1500);
                } else {
                    showToast('Falha ao restaurar backup. Veja a Central de Erros.');
                }
            });
        });
    });
}

// ==========================================
// IMPORTAR DO TRELLO
// ==========================================

async function importFromTrello(trelloData, includeArchived, progressEl) {
    if (!trelloData.lists || !trelloData.cards) {
        progressEl.textContent = 'Esse arquivo não parece ser um export de quadro do Trello (faltam "lists" e "cards").';
        return;
    }

    const lists = trelloData.lists.filter(l => includeArchived || !l.closed);
    const listIdToPersonId = {};

    progressEl.textContent = `Criando ${lists.length} coluna(s)...`;

    for (const list of lists) {
        const newPersonId = addPerson(list.name || 'Sem nome', null, false);
        listIdToPersonId[list.id] = newPersonId;
        await new Promise(r => setTimeout(r, 30)); // pequena pausa pra não afogar o servidor
    }

    const cardsToImport = trelloData.cards.filter(c => {
        if (!listIdToPersonId[c.idList]) return false; // lista foi pulada (arquivada e includeArchived=false)
        if (!includeArchived && c.closed) return false;
        return true;
    });

    progressEl.textContent = `Importando ${cardsToImport.length} tarefa(s)...`;
    let done = 0;

    for (const trelloCard of cardsToImport) {
        const personId = listIdToPersonId[trelloCard.idList];

        // Junta itens de checklist do Trello (se tiver) como linhas do post-it
        let lines = [];
        if (Array.isArray(trelloData.checklists)) {
            const cardChecklists = trelloData.checklists.filter(cl => cl.idCard === trelloCard.id);
            cardChecklists.forEach(cl => {
                (cl.checkItems || []).forEach(item => lines.push(item.name));
            });
        }
        if (lines.length === 0 && trelloCard.desc) {
            lines = trelloCard.desc.split('\n').map(l => l.trim()).filter(Boolean);
        }

        const dueDate = trelloCard.due ? new Date(trelloCard.due).toISOString().slice(0, 10) : '';

        const newCardId = addCard({
            personId,
            title: trelloCard.name || 'Sem título',
            lines,
            color: 'yellow',
            priority: 'media',
            dueDate,
            author: `Importado do Trello por ${deriveNameFromEmail(currentUserName)}`,
            attachments: [],
            customValues: {},
            labelIds: [],
            stickerId: null,
            coverImage: null
        });

        // Restaura o estado (marcado/desmarcado) real dos itens do checklist do Trello
        if (Array.isArray(trelloData.checklists) && lines.length > 0) {
            const card = state.cards.find(c => c.id === newCardId);
            if (card) {
                const cardChecklists = trelloData.checklists.filter(cl => cl.idCard === trelloCard.id);
                let idx = 0;
                cardChecklists.forEach(cl => {
                    (cl.checkItems || []).forEach(item => {
                        if (card.checklist[idx]) {
                            card.checklist[idx].checked = item.state === 'complete';
                        }
                        idx++;
                    });
                });
                if (trelloCard.closed) card.archived = true;
                persistCard(card);
            }
        }

        done++;
        if (done % 5 === 0 || done === cardsToImport.length) {
            progressEl.textContent = `Importando tarefas... (${done}/${cardsToImport.length})`;
        }
        await new Promise(r => setTimeout(r, 20));
    }

    renderBoard();
    logAudit(`Importou ${lists.length} colunas e ${cardsToImport.length} tarefas do Trello`);
    progressEl.textContent = `✅ Pronto! ${lists.length} coluna(s) e ${cardsToImport.length} tarefa(s) importadas.`;
    showToast('Importação do Trello concluída!', 'success');
}

function exportBoardData() {
    const payload = {
        exportedAt: new Date().toISOString(),
        people: state.people,
        cards: state.cards
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mse-board-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showToast('Backup exportado em JSON com sucesso!', 'success');
}

// ==========================================
// PROCESSAMENTO DE ARQUIVOS ANEXADOS
// ==========================================

async function uploadFileToServer(filename, dataUrl) {
    try {
        const res = await apiCall('upload_file.php', { filename, dataUrl });
        if (res && res.success) return res.url;
        return null; // falha — quem chamar decide usar o base64 como reserva
    } catch (err) {
        console.error('Falha ao enviar arquivo pro servidor:', err);
        return null;
    }
}

function processFiles(files) {
    return Promise.all(Array.from(files).map(async (file) => {
        const isImage = file.type.startsWith('image/');
        const dataUrl = await processSingleFile(file);

        const serverUrl = await uploadFileToServer(file.name, dataUrl);
        if (serverUrl) {
            return { name: file.name, url: serverUrl, isImage: isImage };
        }

        // Servidor indisponível — guarda como base64 mesmo (menos ideal, mas não perde o anexo)
        logError(
            'Falha ao enviar anexo pro servidor',
            'O arquivo foi salvo direto no banco como reserva. Verifique se o Apache/MySQL estão ligados e se a pasta uploads/ tem permissão de escrita.'
        );
        return { name: file.name, url: dataUrl, isImage: isImage };
    }));
}

function processSingleFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });
}

// ==========================================
// CRUD: PESSOAS
// ==========================================

function addPerson(name, avatarUrl, isDone) {
    const id = generateUniqueId('p');
    const person = { id, name, avatarUrl: avatarUrl || null, isDone: !!isDone };
    state.people.push(person);
    persistPerson(person);
    logAudit(`Criou a coluna "${name}"`);
    return id;
}

function updatePerson(personId, { name, avatarUrl }) {
    const person = state.people.find(p => p.id === personId);
    if (!person) return;
    const oldName = person.name;
    person.name = name;
    if (avatarUrl) person.avatarUrl = avatarUrl;
    persistPerson(person);
    if (oldName !== name) logAudit(`Renomeou a coluna "${oldName}" para "${name}"`);
}

function removePersonAvatar(personId) {
    const person = state.people.find(p => p.id === personId);
    if (!person) return;
    person.avatarUrl = null;
    persistPerson(person);
}

function deletePerson(personId) {
    const person = state.people.find(p => p.id === personId);
    const cardsToTrash = state.cards.filter(c => c.personId === personId);
    cardsToTrash.forEach(c => moveCardToTrash(c, `Coluna "${person ? person.name : ''}" excluída`));
    cardsToTrash.forEach(c => {
        pendingCardDeletes.add(c.id);
        persistCardDelete(c.id);
    });
    state.people = state.people.filter(p => p.id !== personId);
    state.cards = state.cards.filter(c => c.personId !== personId);
    pendingPersonDeletes.add(personId);
    persistPersonDelete(personId);
    saveState();
    if (person) logAudit(`Excluiu a coluna "${person.name}"`);
}

// ==========================================
// CRUD: POST-ITS (CARDS)
// ==========================================

function addCard({ personId, title, lines, color, priority, dueDate, author, attachments, customValues, labelIds, stickerId, coverImage, startDate }) {
    const id = generateUniqueId('c');

    const card = {
        id, personId, title, color,
        priority: priority || 'media',
        dueDate: dueDate || '',
        startDate: startDate || null,
        author,
        status: 'afazer',
        checklist: lines.map(text => ({ text, checked: false })),
        attachments: attachments || [],
        comments: [],
        assignees: [],
        archived: false,
        starred: false,
        labelIds: labelIds || [],
        stickerId: stickerId || null,
        coverImage: coverImage || null,
        customValues: customValues || {},
        createdAt: Date.now(),
        completedAt: null
    };

    state.cards.push(card);
    persistCard(card);
    logAudit(`Criou a tarefa "${title}"`);
    fireWebhook('card_created', { title });
    return id;
}

async function updateCard(cardId, { personId, title, lines, color, priority, dueDate, newAttachments, customValues, labelIds, stickerId, coverImage, startDate }) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;

    const newChecklist = lines.map((text, i) => {
        const prevItem = card.checklist[i];
        const checked = (prevItem && prevItem.text === text) ? prevItem.checked : false;
        return { text, checked };
    });

    card.personId = personId;
    card.title = title;
    card.color = color;
    card.priority = priority;
    card.dueDate = dueDate;
    card.startDate = startDate || null;
    card.checklist = newChecklist;
    card.attachments = [...card.attachments, ...newAttachments];
    if (customValues) card.customValues = customValues;
    if (labelIds) card.labelIds = labelIds;
    card.stickerId = stickerId || null;
    card.coverImage = coverImage || null;

    // Espera o salvamento terminar de verdade no servidor antes de seguir — evita que a
    // atualização automática (a cada 6s) busque um dado antigo e sobrescreva essa edição.
    await persistCard(card);
    logAudit(`Editou a tarefa "${title}"`);
}

function moveCardToTrash(card, reason) {
    if (!state.trash) state.trash = [];
    state.trash.push({ ...card, deletedAt: Date.now(), deleteReason: reason || '' });
    saveState();
}

// Post-its que foram excluídos na tela mas ainda não confirmaram a exclusão no
// servidor. Enquanto o id estiver aqui, a sincronização automática NUNCA deixa
// esse post-it reaparecer, mesmo que o servidor ainda o devolva (exclusão com
// falha de rede não vira um post-it "ressuscitando" sozinho).
const pendingCardDeletes = new Set();

async function persistCardDelete(cardId, attempt = 1) {
    const ok = await deleteCardFromServer(cardId);
    if (ok) {
        pendingCardDeletes.delete(cardId);
        return true;
    }
    if (attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
        return persistCardDelete(cardId, attempt + 1);
    }
    if (typeof logError === 'function') {
        logError(
            'Não foi possível confirmar a exclusão de uma tarefa no servidor.',
            'Verifique sua internet/conexão. O sistema vai tentar excluir de novo sozinho.'
        );
    }
    return false;
}

async function retryPendingCardDeletes() {
    if (pendingCardDeletes.size === 0) return;
    for (const id of Array.from(pendingCardDeletes)) {
        persistCardDelete(id);
    }
}

function deleteCardById(cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (card) moveCardToTrash(card, 'Excluído do quadro');
    state.cards = state.cards.filter(c => c.id !== cardId);
    pendingCardDeletes.add(cardId);
    persistCardDelete(cardId);
    if (card) logAudit(`Excluiu a tarefa "${card.title}" (foi para a lixeira)`);
}

function removeAttachment(cardId, attachmentIndex) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    card.attachments.splice(attachmentIndex, 1);
    persistCard(card);
}

function toggleChecklistItem(cardId, itemIndex) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    card.checklist[itemIndex].checked = !card.checklist[itemIndex].checked;
    persistChecklistToggle(cardId, itemIndex);
    checkAutomationAutoMove(card);
}

function checkAutomationAutoMove(card) {
    if (!state.settings.autoMoveOnComplete) return;
    const progress = getProgress(card);
    if (progress.total === 0 || progress.percent !== 100) return;

    const currentPerson = state.people.find(p => p.id === card.personId);
    if (currentPerson && currentPerson.isDone) return;
    if (card.status === 'done') return;

    card.status = 'done';
    persistCard(card);
    logAudit(`Automação moveu "${card.title}" para a raia Concluído (checklist 100%)`);
    showToast(`"${card.title}" foi movido automaticamente para Concluído`, 'success');
}

function moveCard(cardId, newPersonId, newStatus) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    card.personId = newPersonId;
    if (newStatus) card.status = newStatus;

    const targetPerson = state.people.find(p => p.id === newPersonId);
    const isNowDone = (targetPerson && targetPerson.isDone) || newStatus === 'done';

    if (isNowDone) {
        if (!card.completedAt) card.completedAt = Date.now();
    } else {
        card.completedAt = null;
    }

    persistCardMove(cardId, newPersonId, newStatus, card.completedAt);

    if (isNowDone) {
        fireWebhook('card_completed', { title: card.title });
    }
}

function extractMentionTokens(text) {
    const matches = text.match(/@([a-zA-ZÀ-ÿ0-9._-]+)/g) || [];
    return matches.map(m => m.slice(1).toLowerCase());
}

function addComment(cardId, author, text) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    card.comments.push({ author, text, date: Date.now() });
    persistComment(cardId, author, text);

    const tokens = extractMentionTokens(text);
    if (tokens.length > 0) {
        const allUsers = state.knownUsers || [];
        if (!state.mentions) state.mentions = [];

        tokens.forEach(token => {
            const matchedUser = allUsers.find(u => {
                const fullName = deriveNameFromEmail(u).toLowerCase().replace(/\s/g, '');
                const firstName = deriveNameFromEmail(u).toLowerCase().split(' ')[0];
                const emailPrefix = u.split('@')[0].toLowerCase();
                return fullName === token || firstName === token || emailPrefix === token || u.toLowerCase() === token;
            });
            if (matchedUser && matchedUser !== author) {
                state.mentions.push({
                    id: `mention_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    cardId,
                    cardTitle: card.title,
                    mentionedUser: matchedUser,
                    byUser: author,
                    ts: Date.now()
                });
            }
        });
        saveState();
    }
}

function toggleAssignee(cardId, userName) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    if (!card.assignees) card.assignees = [];
    const idx = card.assignees.indexOf(userName);
    if (idx === -1) {
        card.assignees.push(userName);
        showToast(`Você foi atribuído a "${card.title}"`, 'success');
    } else {
        card.assignees.splice(idx, 1);
        showToast(`Você foi removido de "${card.title}"`);
    }
    persistCard(card);
}

function archiveCard(cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    card.archived = true;
    persistCard(card);
    logAudit(`Arquivou a tarefa "${card.title}"`);
}

function restoreCard(cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    card.archived = false;
    persistCard(card);
    logAudit(`Restaurou a tarefa "${card.title}"`);
}

function deleteCardPermanently(cardId) {
    state.cards = state.cards.filter(c => c.id !== cardId);
    pendingCardDeletes.add(cardId);
    persistCardDelete(cardId);
}

function renderArchivedList() {
    const list = document.getElementById('archivedList');
    const archived = state.cards.filter(c => c.archived);

    if (archived.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.88rem;">Nenhum cartão arquivado.</p>';
        return;
    }

    list.innerHTML = '';
    archived.forEach(card => {
        const item = document.createElement('div');
        item.className = 'archived-item';
        item.innerHTML = `
            <div class="archived-item-info">
                <h4>${escapeHtml(card.title)}</h4>
                <p>👤 ${escapeHtml(card.author)}</p>
            </div>
            <div class="archived-item-actions">
                <button type="button" class="btn-secondary" data-action="restore">Restaurar</button>
                <button type="button" class="btn-secondary" data-action="delete">Excluir</button>
            </div>
        `;
        item.querySelector('[data-action="restore"]').addEventListener('click', () => {
            restoreCard(card.id);
            renderArchivedList();
            renderBoard();
        });
        item.querySelector('[data-action="delete"]').addEventListener('click', () => {
            showConfirm('Excluir permanentemente este cartão? Essa ação não pode ser desfeita.', () => {
                deleteCardPermanently(card.id);
                renderArchivedList();
                renderBoard();
            });
        });
        list.appendChild(item);
    });
}

// ==========================================
// RENDERIZAÇÃO DO QUADRO (a partir do estado)
// ==========================================

function getFilters() {
    return {
        text: (document.getElementById('searchInput').value || '').toLowerCase().trim(),
        priority: document.getElementById('filterPriority').value,
        overdueOnly: document.getElementById('filterOverdue').checked,
        starredOnly: document.getElementById('filterStarred').checked,
        assignee: document.getElementById('filterAssignee') ? document.getElementById('filterAssignee').value : ''
    };
}

function isOverdue(card) {
    if (!card.dueDate) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return new Date(card.dueDate + 'T00:00:00') < today;
}

function isDueSoon(card) {
    if (!card.dueDate) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(card.dueDate + 'T00:00:00');
    const diffDays = (due - today) / 86400000;
    return diffDays >= 0 && diffDays <= 2;
}

// ==========================================
// ALERTAS DE VENCIMENTO
// ==========================================

function isActiveCard(card) {
    if (card.archived) return false;
    const person = state.people.find(p => p.id === card.personId);
    if (person && person.isDone) return false;
    if (card.status === 'done') return false;
    return true;
}

function computeDueAlerts() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(today); dayAfter.setDate(dayAfter.getDate() + 2);
    const isAdmin = getMemberRole(currentUserName) === 'Admin';

    const overdue = [], dueToday = [], dueTomorrow = [];

    state.cards.filter(isActiveCard).forEach(card => {
        if (!card.dueDate) return;
        if (!isAdmin && !(card.assignees || []).includes(currentUserName)) return;
        const due = new Date(card.dueDate + 'T00:00:00');
        if (due < today) overdue.push(card);
        else if (due.getTime() === today.getTime()) dueToday.push(card);
        else if (due.getTime() === tomorrow.getTime()) dueTomorrow.push(card);
    });

    return { overdue, dueToday, dueTomorrow };
}

function updateDueAlertsBadge() {
    const badge = document.getElementById('dueAlertsBadge');
    if (!badge) return;
    const { overdue, dueToday, dueTomorrow } = computeDueAlerts();
    const count = overdue.length + dueToday.length + dueTomorrow.length;
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

function renderDueAlertsList() {
    const { overdue, dueToday, dueTomorrow } = computeDueAlerts();
    const container = document.getElementById('dueAlertsContent');

    function buildSection(title, cards, colorVar) {
        if (cards.length === 0) return '';
        const items = cards.map(c => {
            const person = state.people.find(p => p.id === c.personId);
            const assigneeNames = (c.assignees && c.assignees.length > 0)
                ? c.assignees.map(a => deriveNameFromEmail(a)).join(', ')
                : 'Sem responsável';
            const startDate = c.createdAt ? new Date(c.createdAt).toLocaleDateString('pt-BR') : '—';
            return `
                <div class="audit-item" style="cursor:pointer;" onclick="document.getElementById('dueAlertsModal').style.display='none'; openViewModal('${c.id}')">
                    <div class="audit-item-meta">
                        <span class="audit-item-user" style="color:${colorVar};">${escapeHtml(c.title)}</span>
                        <span>👤 ${escapeHtml(assigneeNames)} — ${person ? escapeHtml(person.name) : ''}</span>
                    </div>
                    <div style="color:var(--text-muted); font-size:0.76rem; margin-top:0.2rem;">
                        🟢 Início: ${startDate} &nbsp;→&nbsp; 📅 Prazo: ${formatDateBR(c.dueDate)}
                    </div>
                </div>
            `;
        }).join('');
        return `<div class="chart-section"><h4 style="color:${colorVar};">${title} (${cards.length})</h4>${items}</div>`;
    }

    const html =
        buildSection('Atrasados', overdue, 'var(--red)') +
        buildSection('Vence Hoje', dueToday, 'var(--gold)') +
        buildSection('Vence Amanhã', dueTomorrow, 'var(--text-primary)');

    container.innerHTML = html || '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhuma tarefa atrasada ou vencendo nos próximos dias. 🎉</p>';
}

function formatDateBR(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

function cardMatchesFilters(card, filters) {
    if (filters.priority && card.priority !== filters.priority) return false;
    if (filters.overdueOnly && !isOverdue(card)) return false;
    if (filters.starredOnly && !card.starred) return false;

    if (filters.text) {
        const haystack = [
            card.title,
            card.author,
            ...(card.assignees || []),
            ...card.checklist.map(i => i.text)
        ].join(' ').toLowerCase();
        if (!haystack.includes(filters.text)) return false;
    }

    if (filters.assignee && !(card.assignees || []).includes(filters.assignee)) return false;

    return true;
}

function populateAssigneeFilter() {
    const select = document.getElementById('filterAssignee');
    if (!select) return;

    const currentValue = select.value;
    const allAssignees = new Set();
    state.cards.forEach(c => (c.assignees || []).forEach(a => allAssignees.add(a)));

    const sorted = [...allAssignees].sort((a, b) => deriveNameFromEmail(a).localeCompare(deriveNameFromEmail(b)));

    select.innerHTML = '<option value="">Responsável: Todos</option>' +
        sorted.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(deriveNameFromEmail(a))}</option>`).join('');

    if (sorted.includes(currentValue)) select.value = currentValue;
}

function renderBoard() {
    populateAssigneeFilter();
    const grid = document.getElementById('peopleGrid');
    const altContainer = document.getElementById('alternateViewContainer');

    if (currentView !== 'kanban') {
        grid.style.display = 'none';
        altContainer.style.display = 'block';

        if (currentView === 'table') renderTableView(altContainer);
        else if (currentView === 'timeline') renderTimelineView(altContainer);
        else if (currentView === 'calendar') renderCalendarView(altContainer);

        updateArchivedCount();
        return;
    }

    grid.style.display = 'flex';
    altContainer.style.display = 'none';

    grid.innerHTML = '';
    const filters = getFilters();

    // Colunas normais primeiro, abas de "Concluído" por último
    const orderedPeople = [
        ...state.people.filter(p => !p.isDone),
        ...state.people.filter(p => p.isDone)
    ];

    orderedPeople.forEach(person => {
        grid.appendChild(buildColumn(person));

        if (person.isDone) {
            const container = document.getElementById(`cards_${person.id}`);
            const cardsForPerson = sortByPosition(state.cards.filter(c => c.personId === person.id && !c.archived && cardMatchesFilters(c, filters)));
            cardsForPerson.forEach(card => container.appendChild(buildPostItElement(card)));
        } else {
            ['afazer', 'todo', 'testing', 'paused', 'done'].forEach(status => {
                const container = document.getElementById(`cards_${person.id}__${status}`);
                if (!container) return;
                const cardsForLane = sortByPosition(state.cards.filter(c =>
                    c.personId === person.id && !c.archived &&
                    (c.status || 'todo') === status &&
                    cardMatchesFilters(c, filters)
                ));
                cardsForLane.forEach(card => container.appendChild(buildPostItElement(card)));

                // "Em Espera" e "Concluído" minimizam sozinhos quando estão vazios,
                // dando mais espaço pra "A Fazer" mostrar mais post-its de uma vez.
                // Se o usuário já minimizou/expandiu essa raia manualmente (botão ▾),
                // a escolha dele tem prioridade sobre esse comportamento automático.
                const laneEl = container.closest('.lane');
                if (laneEl) {
                    const prefKey = `${person.id}__${status}`;
                    const manualPrefs = getLaneCollapsePrefs();
                    if (Object.prototype.hasOwnProperty.call(manualPrefs, prefKey)) {
                        laneEl.classList.toggle('lane-collapsed', manualPrefs[prefKey]);
                    } else if (status !== 'todo') {
                        laneEl.classList.toggle('lane-collapsed', cardsForLane.length === 0);
                    }
                }
            });
        }
    });

    updateCardCounts();
    updateArchivedCount();
}

// ==========================================
// VISUALIZAÇÃO: TABELA
// ==========================================

function renderTableView(container) {
    const filters = getFilters();
    const cards = state.cards.filter(c => !c.archived && cardMatchesFilters(c, filters));
    const personName = (id) => {
        const p = state.people.find(p => p.id === id);
        return p ? p.name : '—';
    };

    const rows = cards.map(card => {
        const progress = getProgress(card);
        const priorityLabel = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }[card.priority] || '';
        const dueLabel = card.dueDate ? card.dueDate.split('-').reverse().join('/') : '—';
        return `
            <tr class="table-row-clickable" data-card-id="${card.id}">
                <td>${escapeHtml(card.title)}</td>
                <td>${escapeHtml(personName(card.personId))}</td>
                <td><span class="tag tag-priority-${card.priority}">${priorityLabel}</span></td>
                <td>${dueLabel}</td>
                <td>${progress.percent}%</td>
                <td>${escapeHtml(card.author)}</td>
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <table class="data-table">
            <thead>
                <tr><th>Título</th><th>Coluna</th><th>Prioridade</th><th>Prazo</th><th>Progresso</th><th>Autor</th></tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="6" style="color:var(--text-muted);">Nenhuma tarefa ainda.</td></tr>'}</tbody>
        </table>
    `;

    container.querySelectorAll('.table-row-clickable').forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => openViewModal(row.dataset.cardId));
    });
}

// ==========================================
// VISUALIZAÇÃO: CRONOGRAMA
// ==========================================

function renderTimelineView(container) {
    const filters = getFilters();
    const cards = state.cards.filter(c => !c.archived && cardMatchesFilters(c, filters));
    const withDate = cards.filter(c => c.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const withoutDate = cards.filter(c => !c.dueDate);

    function buildRow(card) {
        const progress = getProgress(card);
        const dueLabel = card.dueDate ? card.dueDate.split('-').reverse().join('/') : 'Sem prazo';
        return `
            <div class="timeline-row" data-card-id="${card.id}">
                <span class="tag tag-priority-${card.priority}">${{ alta: 'Alta', media: 'Média', baixa: 'Baixa' }[card.priority]}</span>
                <span class="timeline-row-title">${escapeHtml(card.title)}</span>
                <span style="font-size:0.78rem; color:var(--text-muted); width:80px;">${dueLabel}</span>
                <span style="font-size:0.78rem; font-weight:700; width:40px; text-align:right;">${progress.percent}%</span>
            </div>
        `;
    }

    let html = '<div class="timeline-list">';
    if (withDate.length > 0) {
        html += '<p class="timeline-group-label">Com prazo definido</p>';
        html += withDate.map(buildRow).join('');
    }
    if (withoutDate.length > 0) {
        html += '<p class="timeline-group-label">Sem prazo</p>';
        html += withoutDate.map(buildRow).join('');
    }
    if (cards.length === 0) {
        html += '<p style="color:var(--text-muted);">Nenhuma tarefa ainda.</p>';
    }
    html += '</div>';

    container.innerHTML = html;
    container.querySelectorAll('.timeline-row').forEach(row => {
        row.addEventListener('click', () => openViewModal(row.dataset.cardId));
    });
}

// ==========================================
// VISUALIZAÇÃO: CALENDÁRIO
// ==========================================

function renderCalendarView(container) {
    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth();
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const cardsByDate = {};
    const filters = getFilters();
    state.cards.filter(c => !c.archived && c.dueDate && cardMatchesFilters(c, filters)).forEach(c => {
        (cardsByDate[c.dueDate] = cardsByDate[c.dueDate] || []).push(c);
    });

    let cells = '';
    for (let i = 0; i < startWeekday; i++) cells += '<div class="calendar-day is-empty"></div>';

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayCards = cardsByDate[dateStr] || [];
        const isToday = dateStr === todayStr;
        cells += `
            <div class="calendar-day ${isToday ? 'is-today' : ''}">
                <div class="calendar-day-number">${day}</div>
                ${dayCards.map(c => `<div class="calendar-chip" data-card-id="${c.id}" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</div>`).join('')}
            </div>
        `;
    }

    container.innerHTML = `
        <div class="calendar-header">
            <button type="button" class="calendar-nav-btn" id="calPrevBtn">&larr;</button>
            <h3>${monthNames[month]} ${year}</h3>
            <button type="button" class="calendar-nav-btn" id="calNextBtn">&rarr;</button>
        </div>
        <div class="calendar-grid">
            <div class="calendar-weekday">Dom</div><div class="calendar-weekday">Seg</div><div class="calendar-weekday">Ter</div>
            <div class="calendar-weekday">Qua</div><div class="calendar-weekday">Qui</div><div class="calendar-weekday">Sex</div><div class="calendar-weekday">Sáb</div>
            ${cells}
        </div>
    `;

    container.querySelector('#calPrevBtn').addEventListener('click', () => {
        currentCalendarMonth = new Date(year, month - 1, 1);
        renderCalendarView(container);
    });
    container.querySelector('#calNextBtn').addEventListener('click', () => {
        currentCalendarMonth = new Date(year, month + 1, 1);
        renderCalendarView(container);
    });
    container.querySelectorAll('.calendar-chip').forEach(chip => {
        chip.addEventListener('click', () => openViewModal(chip.dataset.cardId));
    });
}

function updateArchivedCount() {
    const count = state.cards.filter(c => c.archived).length;
    const badge = document.getElementById('archivedCount');
    if (badge) badge.textContent = count > 0 ? count : '';
}

// ==========================================
// REGISTRO DE AUDITORIA
// ==========================================

function logAudit(description) {
    if (!state.auditLog) state.auditLog = [];
    state.auditLog.unshift({
        ts: Date.now(),
        user: currentUserName,
        description
    });
    if (state.auditLog.length > 200) state.auditLog.length = 200;
    saveState();
}

function renderAuditList() {
    const list = document.getElementById('auditList');
    if (!state.auditLog || state.auditLog.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Nenhuma alteração registrada ainda.</p>';
        return;
    }

    list.innerHTML = state.auditLog.slice(0, 100).map(entry => {
        const date = new Date(entry.ts);
        const dateStr = date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="audit-item">
                <div class="audit-item-meta">
                    <span class="audit-item-user">${escapeHtml(entry.user || 'Desconhecido')}</span>
                    <span>${dateStr}</span>
                </div>
                <div>${escapeHtml(entry.description)}</div>
            </div>
        `;
    }).join('');
}

function getInitials(name) {
    const parts = name.trim().split(/\s+/);
    return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

// ---------- Minimizar raia manualmente (botão ▾ no header de cada raia) ----------
// Lembra a escolha do usuário por pessoa+raia entre acessos (mesmo padrão do
// botão "Busca e Filtros", que usa localStorage).
function getLaneCollapsePrefs() {
    try {
        return JSON.parse(localStorage.getItem('mse_lane_collapse_prefs') || '{}');
    } catch (e) {
        return {};
    }
}

function toggleLaneCollapse(personId, status) {
    const laneEl = document.getElementById(`lanewrap_${personId}__${status}`);
    if (!laneEl) return;

    const collapsed = !laneEl.classList.contains('lane-collapsed');
    laneEl.classList.toggle('lane-collapsed', collapsed);

    const prefs = getLaneCollapsePrefs();
    prefs[`${personId}__${status}`] = collapsed;
    localStorage.setItem('mse_lane_collapse_prefs', JSON.stringify(prefs));
}

function buildColumn(person) {
    const personId = person.id;
    const isDone = !!person.isDone;
    const column = document.createElement('div');
    column.className = isDone ? 'column column-done' : 'column';
    column.id = `col_${personId}`;
    column.draggable = true;
    column.dataset.personId = personId;

    column.addEventListener('dragstart', (e) => {
        if (e.target !== column) return; // deixa o drag do post-it (ou qualquer coisa interna) seguir normal
        if (column.dataset.dragFromHandle !== 'true') {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData('application/x-mse-column', personId);
        e.dataTransfer.effectAllowed = 'move';
        column.classList.add('column-dragging');
    });
    column.addEventListener('dragend', () => {
        delete column.dataset.dragFromHandle;
        column.classList.remove('column-dragging');
        document.querySelectorAll('.column.column-drop-target').forEach(c => c.classList.remove('column-drop-target'));
    });
    column.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('application/x-mse-column')) {
            e.preventDefault();
            column.classList.add('column-drop-target');
        }
    });
    column.addEventListener('dragleave', () => column.classList.remove('column-drop-target'));
    column.addEventListener('drop', (e) => {
        if (!e.dataTransfer.types.includes('application/x-mse-column')) return;
        e.preventDefault();
        column.classList.remove('column-drop-target');
        const draggedId = e.dataTransfer.getData('application/x-mse-column');
        if (draggedId && draggedId !== personId) reorderColumns(draggedId, personId);
    });

    const deleteBtn = `<button class="delete-person-btn" title="Excluir Coluna" onclick="event.stopPropagation(); handleDeletePerson('${personId}')">🗑️</button>`;

    let avatarHtml;
    if (isDone) {
        avatarHtml = `<span class="column-avatar-fallback column-avatar-done" onclick="openPersonModalForEdit('${personId}')">✓</span>`;
    } else if (person.avatarUrl) {
        avatarHtml = `<img src="${person.avatarUrl}" class="column-avatar" alt="${escapeHtml(person.name)}" onclick="openPersonModalForEdit('${personId}')">`;
    } else {
        avatarHtml = `<span class="column-avatar-fallback" onclick="openPersonModalForEdit('${personId}')">${getInitials(person.name)}</span>`;
    }

    const dragHandle = `<span class="column-drag-handle" title="Arraste aqui pra reordenar a coluna">⠿</span>`;
    const headerClickable = `<div class="column-person-header">${dragHandle}${avatarHtml}<h3 class="inline-editable" ondblclick="startInlineEditColumnName(event, '${personId}')">${escapeHtml(person.name)}</h3></div>`;

    let bodyHtml;
    if (isDone) {
        bodyHtml = `<div class="cards-container" id="cards_${personId}" ondragover="allowDrop(event)" ondrop="drop(event)"></div>`;
    } else {
        const lanes = [
            { key: 'todo', label: 'Fazendo' },
            { key: 'afazer', label: 'A Fazer' },
            { key: 'testing', label: 'Em Teste' },
            { key: 'paused', label: 'Pausado' },
            { key: 'done', label: 'Concluída' }
        ];
        bodyHtml = lanes.map(lane => `
            <div class="lane lane-${lane.key}" id="lanewrap_${personId}__${lane.key}" ondragover="allowDrop(event)" ondrop="drop(event)">
                <div class="lane-header">
                    <span class="lane-header-title">
                        <button type="button" class="lane-toggle-btn" onclick="toggleLaneCollapse('${personId}', '${lane.key}')" title="Minimizar/expandir raia">▾</button>
                        <span>${lane.label}</span>
                    </span>
                    <span class="lane-count" id="count_${personId}__${lane.key}">0</span>
                </div>
                <div class="cards-container lane-container" id="cards_${personId}__${lane.key}" ondragover="allowDrop(event)" ondrop="drop(event)"></div>
            </div>
        `).join('');
    }

    column.innerHTML = `
        <div class="column-header">
            ${headerClickable}
            <div class="column-header-actions">
                <span class="card-count" id="count_${personId}">0</span>
                ${deleteBtn}
            </div>
        </div>
        ${bodyHtml}
    `;

    const handleEl = column.querySelector('.column-drag-handle');
    if (handleEl) {
        handleEl.addEventListener('mousedown', () => { column.dataset.dragFromHandle = 'true'; });
    }

    return column;
}

function reorderColumns(draggedId, targetId) {
    const draggedIdx = state.people.findIndex(p => p.id === draggedId);
    const targetIdx = state.people.findIndex(p => p.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    const [draggedPerson] = state.people.splice(draggedIdx, 1);
    const newTargetIdx = state.people.findIndex(p => p.id === targetId);
    state.people.splice(newTargetIdx, 0, draggedPerson);

    renderBoard();
    reorderPeopleOnServer(state.people.map(p => p.id));
    logAudit(`Reordenou as colunas do quadro`);
}

function handleDeletePerson(personId) {
    const person = state.people.find(p => p.id === personId);
    if (!person) return;

    showConfirm(`Tem certeza que deseja excluir "${person.name}" e suas tarefas? Essa ação não pode ser desfeita.`, () => {
        deletePerson(personId);
        renderBoard();
    });
}

// ==========================================
// DIÁLOGO DE CONFIRMAÇÃO E NOTIFICAÇÕES (TOASTS)
// ==========================================

function showConfirm(message, onConfirm, title) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmModalTitle').textContent = title || 'Tem certeza?';
    document.getElementById('confirmModalMessage').textContent = message;
    modal.style.display = 'flex';

    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');

    const cleanup = () => {
        modal.style.display = 'none';
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', handleCancel);
    };
    const handleOk = () => { cleanup(); onConfirm(); };
    const handleCancel = () => { cleanup(); };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
}

function showToast(message, type) {
    const notifPref = localStorage.getItem(`mse_notifications_${currentUserName}`);
    if (notifPref === '0') return;

    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast${type ? ' toast-' + type : ''}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function getProgress(card) {
    const total = card.checklist.length;
    const done = card.checklist.filter(i => i.checked).length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { done, total, percent };
}

function buildProgressBarHtml(progress) {
    if (progress.total === 0) return '';
    return `
        <div class="progress-wrap">
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${progress.percent}%"></div></div>
            <span class="progress-label">${progress.percent}% (${progress.done}/${progress.total})</span>
        </div>
    `;
}

function buildPostItElement(card) {
    const el = document.createElement('div');
    el.className = `postit ${card.color}`;
    el.id = card.id;
    if (!isObserver) {
        el.setAttribute('draggable', 'true');
        el.addEventListener('dragstart', dragStart);
        el.addEventListener('dragend', dragEnd);
    }
    el.addEventListener('mouseenter', () => { hoveredCardId = card.id; });
    el.addEventListener('mouseleave', () => { if (hoveredCardId === card.id) hoveredCardId = null; });

    const progress = getProgress(card);
    const priorityLabel = { baixa: 'Baixa', media: 'Média', alta: 'Alta' }[card.priority] || '';
    const percentLabel = progress.total > 0 ? `${progress.percent}%` : '—';

    const cardLabels = (card.labelIds || []).map(id => state.labels.find(l => l.id === id)).filter(Boolean);
    const labelsHtml = cardLabels.length > 0
        ? `<div class="postit-labels">${cardLabels.map(l => `<span class="label-swatch-dot" style="background:${l.color}" title="${escapeHtml(l.name)}"></span>`).join('')}</div>`
        : '';

    const sticker = getStickerById(card.stickerId);
    const stickerHtml = sticker ? `<span class="postit-sticker-stamp" title="${escapeHtml(sticker.label)}">${sticker.emoji}</span>` : '';
    const coverHtml = card.coverImage ? `<img src="${card.coverImage}" class="postit-cover" alt="Capa">` : '';

    let datesHtml = '';
    if (card.startDate || card.dueDate) {
        const startLabel = card.startDate ? formatDateBR(card.startDate) : '—';
        const dueLabel = card.dueDate ? formatDateBR(card.dueDate) : '—';
        let dueColor = '';
        if (card.dueDate) {
            if (isOverdue(card)) dueColor = 'color:var(--red); font-weight:700;';
            else if (isDueSoon(card)) dueColor = 'color:var(--gold); font-weight:700;';
            else dueColor = 'color:var(--green); font-weight:700;';
        }
        datesHtml = `<div class="postit-dates">🟢 ${startLabel} &nbsp;→&nbsp; <span style="${dueColor}">📅 ${dueLabel}</span></div>`;
    }

    el.innerHTML = `
        ${coverHtml}
        ${stickerHtml}
        <div class="postit-compact-top">
            <h4 class="inline-editable" onclick="event.stopPropagation();" ${isObserver ? '' : `ondblclick="startInlineEditCardTitle(event, '${card.id}')"`}>${escapeHtml(card.title)}</h4>
            <div style="display:flex; align-items:center; gap:0.35rem; flex-shrink:0;">
                <button class="postit-star-btn ${card.starred ? 'is-starred' : ''}" title="Favoritar" onclick="event.stopPropagation(); handleToggleStar('${card.id}')">★</button>
                <button class="delete-card-btn" onclick="event.stopPropagation(); handleDeleteCard('${card.id}')">&times;</button>
            </div>
        </div>
        ${labelsHtml}
        ${datesHtml}
        <div class="postit-compact-meta">
            <span class="tag tag-priority-${card.priority}">${priorityLabel}</span>
            <span class="postit-compact-percent">${percentLabel}</span>
        </div>
    `;

    el.addEventListener('click', () => openViewModal(card.id));

    return el;
}

function handleToggleStar(cardId) {
    toggleStar(cardId);
    renderBoard();
}

function startInlineEditCardTitle(event, cardId) {
    event.stopPropagation();
    const el = event.currentTarget;
    el.contentEditable = 'true';
    el.classList.add('editing');
    el.focus();
    document.execCommand('selectAll', false, null);

    const finish = (commit) => {
        el.contentEditable = 'false';
        el.classList.remove('editing');
        el.removeEventListener('blur', onBlur);
        el.removeEventListener('keydown', onKeydown);
        if (commit) {
            const newTitle = el.textContent.trim();
            if (newTitle) {
                const card = state.cards.find(c => c.id === cardId);
                if (card) { card.title = newTitle; persistCard(card); }
            }
        }
        renderBoard();
    };
    const onBlur = () => finish(true);
    const onKeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKeydown);
}

function startInlineEditColumnName(event, personId) {
    event.stopPropagation();
    const el = event.currentTarget;
    el.contentEditable = 'true';
    el.classList.add('editing');
    el.focus();
    document.execCommand('selectAll', false, null);

    const finish = (commit) => {
        el.contentEditable = 'false';
        el.classList.remove('editing');
        el.removeEventListener('blur', onBlur);
        el.removeEventListener('keydown', onKeydown);
        if (commit) {
            const newName = el.textContent.trim();
            if (newName) {
                const person = state.people.find(p => p.id === personId);
                if (person) { person.name = newName; persistPerson(person); }
            }
        }
        renderBoard();
    };
    const onBlur = () => finish(true);
    const onKeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKeydown);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Ordena post-its pela posição manual (arrastar pra reordenar). Post-its
// sem posição definida (criados antes dessa funcionalidade existir) caem
// pelo horário de criação, então continuam aparecendo numa ordem estável.
function sortByPosition(cards) {
    return [...cards].sort((a, b) => {
        const posA = typeof a.position === 'number' ? a.position : (a.createdAt || 0);
        const posB = typeof b.position === 'number' ? b.position : (b.createdAt || 0);
        return posA - posB;
    });
}

// Transforma links (http://, https://, www.) dentro de um texto já escapado
// em links clicáveis, que abrem em nova aba.
function linkifyText(str) {
    const escaped = escapeHtml(str);
    return escaped.replace(
        /((https?:\/\/|www\.)[^\s<]+)/gi,
        (match) => {
            const href = match.startsWith('http') ? match : `https://${match}`;
            return `<a href="${href}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();">${match}</a>`;
        }
    );
}

function handleToggleChecklist(cardId, itemIndex) {
    toggleChecklistItem(cardId, itemIndex);
    renderBoard();
}

function handleDeleteCard(cardId) {
    deleteCardById(cardId);
    renderBoard();
}

// ==========================================
// MODAL DE POST-IT: CRIAR / EDITAR
// ==========================================

function populatePersonSelect(selectedId) {
    const select = document.getElementById('targetPersonSelect');
    select.innerHTML = '';

    state.people.forEach(person => {
        const option = document.createElement('option');
        option.value = person.id;
        option.textContent = person.isDone ? `✅ ${person.name}` : `👤 ${person.name}`;
        if (person.id === selectedId) option.selected = true;
        select.appendChild(option);
    });
}

// ==========================================
// MODAL DE PESSOA: CRIAR / EDITAR
// ==========================================

function openPersonModalForCreate(isDoneTab) {
    document.getElementById('personModalTitle').textContent = isDoneTab ? 'Nova Aba de Concluído' : 'Adicionar Membro da Equipe';
    document.getElementById('personFormSubmitBtn').textContent = isDoneTab ? 'Criar Aba' : 'Criar Coluna de Tarefas';
    document.getElementById('editingPersonId').value = '';
    document.getElementById('personIsDoneInput').value = isDoneTab ? 'true' : '';
    document.getElementById('personNameInput').value = isDoneTab ? 'Concluído' : '';
    document.getElementById('personNameInput').placeholder = isDoneTab ? 'Ex: Concluído - Equipe Estrutural' : 'Ex: Roberto (Engenharia)';
    document.getElementById('personAvatarInput').value = '';
    document.getElementById('personAvatarPreview').innerHTML = '';
    document.getElementById('personModal').style.display = 'flex';
    document.getElementById('personNameInput').focus();
    document.getElementById('personNameInput').select();
}

function openPersonModalForEdit(personId) {
    const person = state.people.find(p => p.id === personId);
    if (!person) return;

    document.getElementById('personModalTitle').textContent = person.isDone ? 'Editar Aba de Concluído' : 'Editar Membro da Equipe';
    document.getElementById('personFormSubmitBtn').textContent = 'Salvar Alterações';
    document.getElementById('editingPersonId').value = person.id;
    document.getElementById('personIsDoneInput').value = person.isDone ? 'true' : '';
    document.getElementById('personNameInput').value = person.name;
    document.getElementById('personNameInput').placeholder = 'Ex: Roberto (Engenharia)';
    document.getElementById('personAvatarInput').value = '';
    renderPersonAvatarPreview(person);
    document.getElementById('personModal').style.display = 'flex';
}

function renderPersonAvatarPreview(person) {
    const preview = document.getElementById('personAvatarPreview');
    if (person.avatarUrl) {
        preview.innerHTML = `<img src="${person.avatarUrl}" alt="${escapeHtml(person.name)}"><button type="button" id="removeAvatarBtn">Remover foto</button>`;
        document.getElementById('removeAvatarBtn').addEventListener('click', () => {
            removePersonAvatar(person.id);
            renderPersonAvatarPreview(state.people.find(p => p.id === person.id));
            renderBoard();
        });
    } else {
        preview.innerHTML = '';
    }
}

function openCardModalForCreate() {
    document.getElementById('cardModalTitle').textContent = '📌 Criar Nova Tarefa';
    document.getElementById('cardFormSubmitBtn').textContent = 'Adicionar Tarefa';
    document.getElementById('editingCardId').value = '';
    document.getElementById('newCardForm').reset();
    document.getElementById('existingAttachmentsList').innerHTML = '';
    document.getElementById('commentsSection').style.display = 'none';
    document.getElementById('templateSelectGroup').style.display = 'flex';
    populateTemplateSelect();
    populatePersonSelect(null);
    renderCustomFieldsInputs();
    renderLabelPicker();
    renderStickerPicker();
    renderCoverPreview(null);
    document.getElementById('cardCoverInput').value = '';
    document.getElementById('cardModal').style.display = 'flex';
}

function openCardModalForEdit(cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;

    document.getElementById('cardModalTitle').textContent = '✏️ Editar Tarefa';
    document.getElementById('cardFormSubmitBtn').textContent = 'Salvar Alterações';
    document.getElementById('editingCardId').value = card.id;
    document.getElementById('templateSelectGroup').style.display = 'none';

    populatePersonSelect(card.personId);
    document.getElementById('cardTitle').value = card.title;
    document.getElementById('cardDesc').value = card.checklist.map(i => i.text).join('\n');
    document.getElementById('cardColor').value = card.color;
    document.getElementById('cardPriority').value = card.priority;
    document.getElementById('cardDueDate').value = card.dueDate || '';
    document.getElementById('cardStartDate').value = card.startDate || '';
    document.getElementById('cardAttachments').value = '';

    renderExistingAttachments(card);
    renderCustomFieldsInputs(card.customValues);
    renderLabelPicker(card.labelIds);
    renderStickerPicker(card.stickerId);
    document.getElementById('cardCoverInput').value = '';
    renderCoverPreview(card.coverImage);

    document.getElementById('commentsSection').style.display = 'block';
    renderCommentsList(card.id);

    document.getElementById('cardModal').style.display = 'flex';
}

function openViewModal(cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;

    const modal = document.getElementById('viewCardModal');
    modal.dataset.cardId = cardId;

    const coverEl = document.getElementById('viewCardCover');
    if (card.coverImage) {
        coverEl.src = card.coverImage;
        coverEl.style.display = 'block';
    } else {
        coverEl.style.display = 'none';
    }

    document.getElementById('viewCardColorDot').className = `view-color-dot ${card.color}`;
    document.getElementById('viewCardTitle').textContent = card.title;

    const stickerEl = document.getElementById('viewCardSticker');
    const sticker = getStickerById(card.stickerId);
    if (sticker) {
        stickerEl.textContent = sticker.emoji;
        stickerEl.title = sticker.label;
        stickerEl.style.display = 'inline-block';
    } else {
        stickerEl.style.display = 'none';
    }

    const starBtn = document.getElementById('viewStarBtn');
    starBtn.classList.toggle('is-starred', !!card.starred);
    starBtn.onclick = () => {
        toggleStar(card.id);
        starBtn.classList.toggle('is-starred');
        renderBoard();
    };

    const cardLabels = (card.labelIds || []).map(id => state.labels.find(l => l.id === id)).filter(Boolean);
    document.getElementById('viewCardLabels').innerHTML = cardLabels.map(l =>
        `<span class="label-chip" style="background:${l.color}">${escapeHtml(l.name)}</span>`
    ).join('');

    // Tags: prioridade + prazo
    let tagsHtml = '';
    const priorityLabel = { baixa: '🟢 Baixa', media: '🟡 Média', alta: '🔴 Alta' }[card.priority] || '';
    tagsHtml += `<span class="tag tag-priority-${card.priority}">${priorityLabel}</span>`;

    if (card.dueDate) {
        let dueClass = 'tag-due';
        if (isOverdue(card)) dueClass = 'tag-due-overdue';
        else if (isDueSoon(card)) dueClass = 'tag-due-soon';
        const [y, m, d] = card.dueDate.split('-');
        tagsHtml += `<span class="tag ${dueClass}">📅 ${d}/${m}/${y}</span>`;
    }
    if (card.startDate) {
        const [ys, ms, ds] = card.startDate.split('-');
        tagsHtml += `<span class="tag" style="background:var(--bg); color:var(--text-primary);">🟢 Início: ${ds}/${ms}/${ys}</span>`;
    }
    document.getElementById('viewCardTags').innerHTML = tagsHtml;

    document.getElementById('viewCardProgress').innerHTML = buildProgressBarHtml(getProgress(card));

    // Checklist (clicável direto na visualização)
    const checklistContainer = document.getElementById('viewCardChecklist');
    checklistContainer.innerHTML = '';
    card.checklist.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'checklist-item';
        row.innerHTML = `
            <input type="checkbox" ${item.checked ? 'checked' : ''} ${isObserver ? 'disabled' : ''}>
            <span>${linkifyText(item.text)}</span>
        `;
        row.querySelector('input').addEventListener('change', () => {
            toggleChecklistItem(card.id, index);
            document.getElementById('viewCardProgress').innerHTML = buildProgressBarHtml(getProgress(state.cards.find(c => c.id === card.id)));
            renderBoard();
        });
        checklistContainer.appendChild(row);
    });

    // Campos Personalizados
    const customFieldsSection = document.getElementById('viewCardCustomFieldsSection');
    const customFieldsContainer = document.getElementById('viewCardCustomFields');
    const cardCustomValues = card.customValues || {};
    const fieldsWithValues = state.customFields.filter(f => cardCustomValues[f.id] !== undefined && cardCustomValues[f.id] !== '');

    if (fieldsWithValues.length > 0) {
        customFieldsSection.style.display = 'block';
        customFieldsContainer.innerHTML = fieldsWithValues.map(f => {
            let displayValue = cardCustomValues[f.id];
            if (f.type === 'moeda') displayValue = `R$ ${parseFloat(displayValue).toFixed(2)}`;
            return `<span class="tag tag-due">${escapeHtml(f.name)}: ${escapeHtml(String(displayValue))}</span>`;
        }).join('');
    } else {
        customFieldsSection.style.display = 'none';
    }

    // Anexos
    const attachSection = document.getElementById('viewCardAttachmentsSection');
    const attachContainer = document.getElementById('viewCardAttachments');
    if (card.attachments && card.attachments.length > 0) {
        attachSection.style.display = 'block';
        attachContainer.innerHTML = card.attachments.map(att => {
            if (att.isImage) {
                return `<a href="${att.url}" target="_blank" title="Clique para ampliar: ${escapeHtml(att.name)}"><img src="${att.url}" class="attachment-img" alt="${escapeHtml(att.name)}"></a>`;
            }
            return `<a href="${att.url}" target="_blank" download="${escapeHtml(att.name)}" class="attachment-doc" title="${escapeHtml(att.name)}">📄 ${escapeHtml(att.name)}</a>`;
        }).join('');
    } else {
        attachSection.style.display = 'none';
    }

    document.getElementById('viewCardAuthor').textContent = `👤 ${card.author}`;
    if (card.assignees && card.assignees.length > 0) {
        document.getElementById('viewCardAuthor').textContent += ` — Atribuído(s): ${card.assignees.join(', ')}`;
    }

    renderViewCommentsList(cardId);

    modal.style.display = 'flex';
}

function renderViewCommentsList(cardId) {
    const card = state.cards.find(c => c.id === cardId);
    const list = document.getElementById('viewCommentsList');
    if (!card) { list.innerHTML = ''; return; }

    if (card.comments.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">Nenhum comentário ainda.</p>';
        return;
    }

    list.innerHTML = card.comments.map(c => {
        const date = new Date(c.date);
        const dateStr = date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="comment-item">
                <div class="comment-meta">
                    <span class="comment-author">${escapeHtml(c.author)}</span>
                    <span>${dateStr}</span>
                </div>
                <div>${linkifyText(c.text)}</div>
            </div>
        `;
    }).join('');

    list.scrollTop = list.scrollHeight;
}

function renderExistingAttachments(card) {
    const container = document.getElementById('existingAttachmentsList');
    container.innerHTML = '';

    card.attachments.forEach((att, index) => {
        const chip = document.createElement('span');
        chip.className = 'existing-attachment-chip';
        chip.innerHTML = `📎 ${escapeHtml(att.name)} <button type="button" title="Remover anexo">&times;</button>`;
        chip.querySelector('button').addEventListener('click', () => {
            removeAttachment(card.id, index);
            renderExistingAttachments(state.cards.find(c => c.id === card.id));
        });
        container.appendChild(chip);
    });
}

function renderCommentsList(cardId) {
    const card = state.cards.find(c => c.id === cardId);
    const list = document.getElementById('commentsList');
    if (!card) { list.innerHTML = ''; return; }

    if (card.comments.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); font-size:0.82rem;">Nenhum comentário ainda.</p>';
        return;
    }

    list.innerHTML = card.comments.map(c => {
        const date = new Date(c.date);
        const dateStr = date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="comment-item">
                <div class="comment-meta">
                    <span class="comment-author">${escapeHtml(c.author)}</span>
                    <span>${dateStr}</span>
                </div>
                <div>${linkifyText(c.text)}</div>
            </div>
        `;
    }).join('');

    list.scrollTop = list.scrollHeight;
}

// ==========================================
// DRAG & DROP & CONTADORES
// ==========================================

function dragStart(e) {
    e.dataTransfer.setData('text/plain', e.target.id);
    const angle = (Math.random() > 0.5 ? 1 : -1) * (2 + Math.random());
    e.target.style.transform = `rotate(${angle.toFixed(2)}deg)`;
    e.target.classList.add('dragging');
}

function dragEnd(e) {
    e.target.style.transform = '';
    e.target.classList.remove('dragging');
}

function allowDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('drag-over');
}

document.addEventListener('dragleave', (e) => {
    if (e.target.classList.contains('cards-container') || e.target.classList.contains('lane')) {
        e.target.classList.remove('drag-over');
    }
});

function drop(e) {
    e.preventDefault();
    e.stopPropagation();
    const container = e.currentTarget;
    container.classList.remove('drag-over');

    const cardId = e.dataTransfer.getData('text/plain');
    const raw = container.id.replace('cards_', '').replace('lanewrap_', '');
    let newPersonId = raw;
    let newStatus = null;

    if (raw.includes('__')) {
        const parts = raw.split('__');
        newPersonId = parts[0];
        newStatus = parts[1];
    }

    // Descobre entre quais post-its (já existentes nessa raia) o card foi
    // soltado, comparando a posição vertical do mouse com cada um deles.
    const siblings = [...container.querySelectorAll('.postit')].filter(el => el.id !== cardId);
    let insertBeforeCard = null;
    for (const el of siblings) {
        const rect = el.getBoundingClientRect();
        const middle = rect.top + rect.height / 2;
        if (e.clientY < middle) {
            insertBeforeCard = el.id;
            break;
        }
    }

    const card = state.cards.find(c => c.id === cardId);
    if (card) {
        const laneCards = sortByPosition(
            state.cards.filter(c => c.id !== cardId && c.personId === newPersonId && !c.archived &&
                (newStatus ? (c.status || 'todo') === newStatus : true))
        );
        const insertIndex = insertBeforeCard ? laneCards.findIndex(c => c.id === insertBeforeCard) : laneCards.length;
        const prevCard = insertIndex > 0 ? laneCards[insertIndex - 1] : null;
        const nextCard = insertIndex < laneCards.length ? laneCards[insertIndex] : null;
        const prevPos = prevCard ? (typeof prevCard.position === 'number' ? prevCard.position : (prevCard.createdAt || 0)) : null;
        const nextPos = nextCard ? (typeof nextCard.position === 'number' ? nextCard.position : (nextCard.createdAt || 0)) : null;

        if (prevPos !== null && nextPos !== null) {
            card.position = (prevPos + nextPos) / 2;
        } else if (nextPos !== null) {
            card.position = nextPos - 1;
        } else if (prevPos !== null) {
            card.position = prevPos + 1;
        } else {
            card.position = Date.now();
        }
        persistCard(card);
    }

    moveCard(cardId, newPersonId, newStatus);
    renderBoard();
}

function updateCardCounts() {
    document.querySelectorAll('#peopleGrid .column').forEach(col => {
        const personId = col.id.replace('col_', '');
        const laneContainers = col.querySelectorAll('.lane-container');

        if (laneContainers.length > 0) {
            let total = 0;
            laneContainers.forEach(container => {
                const count = container.children.length;
                total += count;
                const countSpan = document.getElementById(container.id.replace('cards_', 'count_'));
                if (countSpan) countSpan.textContent = count;
            });
            const totalSpan = document.getElementById(`count_${personId}`);
            if (totalSpan) totalSpan.textContent = total;
        } else {
            const container = col.querySelector('.cards-container');
            const countSpan = col.querySelector('.card-count');
            if (container && countSpan) {
                countSpan.textContent = container.children.length;
            }
        }
    });
}

function renderOnlineUsers(currentUser) {
    const list = document.getElementById('onlineUsersList');
    if (!list) return;

    const users = ((state.knownUsers && state.knownUsers.length > 0) ? state.knownUsers : [currentUser])
        .filter(u => u !== BOOTSTRAP_ADMIN_EMAIL || u === currentUser);
    list.innerHTML = '';

    users.slice(0, 5).forEach(user => {
        const avatar = document.createElement('div');
        avatar.className = 'user-avatar';
        avatar.title = user === currentUser ? `${user} (você)` : user;
        avatar.innerHTML = `<img src="${getAvatarUrl(user, 40)}" alt="${escapeHtml(user)}" style="width:100%; height:100%; object-fit:cover; border-radius:inherit;">`;
        list.appendChild(avatar);
    });

    if (users.length > 5) {
        const more = document.createElement('div');
        more.className = 'user-avatar';
        more.title = `+${users.length - 5} outros`;
        more.textContent = `+${users.length - 5}`;
        list.appendChild(more);
    }
}

function renderUsersList() {
    const list = document.getElementById('usersList');
    const users = (state.knownUsers && state.knownUsers.length > 0 ? state.knownUsers : [currentUserName])
        .filter(u => u !== BOOTSTRAP_ADMIN_EMAIL || u === currentUserName);
    const isAdmin = getMemberRole(currentUserName) === 'Admin';

    list.innerHTML = '';
    users.forEach(user => {
        const role = getMemberRole(user);
        const displayName = deriveNameFromEmail(user);
        const row = document.createElement('div');
        row.className = 'member-row';
        row.innerHTML = `
            <span class="member-row-name user-list-identity">
                <span class="user-avatar user-list-avatar-wrap" title="Editar foto">
                    <img src="${getAvatarUrl(user, 40)}" alt="${escapeHtml(user)}" class="user-list-avatar-img">
                    <span class="user-list-avatar-edit">✎</span>
                    <input type="file" accept="image/*" class="user-avatar-file-input" style="display:none;">
                </span>
                <span class="user-list-text">
                    <span class="user-list-name">${escapeHtml(displayName)}${user === currentUserName ? ' (você)' : ''}</span>
                    <span class="user-list-email">${escapeHtml(user)}</span>
                </span>
            </span>
            <div class="member-row-actions">
                <span class="tag tag-priority-media" style="text-transform:none;">${escapeHtml(role)}</span>
                ${isAdmin ? `<button type="button" class="remove-row-btn" title="Excluir pessoa">&times;</button>` : ''}
            </div>
        `;

        const avatarWrap = row.querySelector('.user-list-avatar-wrap');
        const fileInput = row.querySelector('.user-avatar-file-input');
        avatarWrap.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files[0];
            if (!file) return;
            const dataUrl = await processSingleFile(file);
            setCustomAvatar(user, dataUrl);
            showToast('Foto de perfil atualizada em todos os lugares!', 'success');
        });

        if (isAdmin) {
            const removeBtn = row.querySelector('.remove-row-btn');
            removeBtn.addEventListener('click', () => {
                showConfirm(`Excluir "${displayName}" (${user}) deste quadro? A pessoa perde o acesso imediatamente.`, () => {
                    state.knownUsers = state.knownUsers.filter(u => u !== user);
                    delete state.members[user];
                    delete state.customAvatars[user];
                    delete state.userPasswords[user];
                    saveState();
                    logAudit(`Excluiu a pessoa "${user}" do quadro`);
                    renderUsersList();
                    renderOnlineUsers(currentUserName);
                    showToast(`${displayName} foi removido(a) do quadro.`, 'success');
                });
            });
        }

        list.appendChild(row);
    });
}
