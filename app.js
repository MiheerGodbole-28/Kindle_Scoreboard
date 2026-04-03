// ========================================
// SUPABASE CONFIGURATION
// Replace these two values with your own
// from: Supabase → Project Settings → API
// ========================================
const SUPABASE_URL = 'https://vovtrxohcbwrjejywshn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZvdnRyeG9oY2J3cmplanl3c2huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NjQ2OTYsImV4cCI6MjA4NzM0MDY5Nn0.6jXzrcZcxJ8kXvWwfxuRu7LJ2-RwjWpqDfxrCcjKj6U';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========================================
// GLOBAL STATE
// ========================================
let currentUser           = null;
let isAdmin               = false;
let currentMatchId        = null;
let openPrevMatchId       = null;   // tracks which previous-match card is expanded
let currentScoringMatch   = null;
let lastBalls             = [];   // undo stack

// Supabase realtime subscription references
let liveMatchesSubscription  = null;
let currentMatchSubscription = null;
let commentaryLoaded         = false;

// ========================================
// INITIALIZATION
// ========================================
document.addEventListener('DOMContentLoaded', async function () {
    console.log('VPL Cricket App — Supabase');

    // Restore existing session on page load
    const { data: { session } } = await db.auth.getSession();
    if (session) {
        currentUser = session.user;
        isAdmin     = true;
        showAdminUI();
        stopLiveListeners();
        loadAllData();
    } else {
        hideAdminUI();
        startLiveListeners();
    }

    // Listen for future sign-in / sign-out events
    db.auth.onAuthStateChange((_event, session) => {
        if (session) {
            currentUser = session.user;
            isAdmin     = true;
            showAdminUI();
            stopLiveListeners();
            loadAllData();
        } else {
            currentUser = null;
            isAdmin     = false;
            hideAdminUI();
            startLiveListeners();
        }
    });

    setupEventListeners();
});

// ========================================
// EVENT LISTENERS
// ========================================
function setupEventListeners() {
    document.querySelectorAll('.nav-btn').forEach(btn =>
        btn.addEventListener('click', function () { switchTab(this.getAttribute('data-tab')); })
    );

    const mobileToggle = document.getElementById('mobileMenuToggle');
    if (mobileToggle) mobileToggle.addEventListener('click', toggleMobileMenu);

    document.getElementById('loginBtn').addEventListener('click', openLoginModal);
    document.getElementById('logoutBtn').addEventListener('click', logout);

    const closeModalBtn = document.querySelector('.close-modal');
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeLoginModal);

    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('addTeamForm').addEventListener('submit', handleAddTeam);
    document.getElementById('addPlayerForm').addEventListener('submit', handleAddPlayer);
    document.getElementById('addMatchForm').addEventListener('submit', handleAddMatch);

    document.getElementById('scoringMatchSelect').addEventListener('change', handleScoringMatchSelect);
    document.getElementById('confirmTossBtn').addEventListener('click', confirmToss);
    document.getElementById('startInningsBtn').addEventListener('click', startInnings);
    document.getElementById('endInningsBtn').addEventListener('click', endInnings);
    document.getElementById('endMatchBtn').addEventListener('click', endMatch);
    document.getElementById('confirmBatsmenBtn').addEventListener('click', confirmBatsmen);
    document.getElementById('confirmBowlerBtn').addEventListener('click', confirmBowler);
    document.getElementById('strikeChangeBtn').addEventListener('click', changeStrike);
    document.getElementById('changeBowlerBtn').addEventListener('click', showChangeBowler);
    document.getElementById('wicketBtn').addEventListener('click', showWicketModal);
    document.getElementById('cancelWicketBtn').addEventListener('click', closeWicketModal);
    document.getElementById('wicketForm').addEventListener('submit', handleWicket);
    document.getElementById('undoBtn').addEventListener('click', undoLastBall);

    // No-ball modal — cancel button
    document.getElementById('cancelNoBallBtn').addEventListener('click', closeNoBallModal);

    // No-ball modal — each run selection button confirms immediately on click
    document.querySelectorAll('.nb-run-btn').forEach(btn =>
        btn.addEventListener('click', function () {
            confirmNoBall(parseInt(this.getAttribute('data-nbr')));
        })
    );

    const commentaryBtn = document.getElementById('loadCommentaryBtn');
    if (commentaryBtn) commentaryBtn.addEventListener('click', toggleCommentary);

    // FIX 1: Exclude .nb-run-btn so clicking a no-ball run button does NOT
    // also fire this handler with data-runs=NaN (nb buttons only have data-nbr).
    document.querySelectorAll('.run-btn:not(.nb-run-btn)').forEach(btn =>
        btn.addEventListener('click', function () {
            recordBall(parseInt(this.getAttribute('data-runs')), false, null);
        })
    );

    document.querySelectorAll('.extra-btn').forEach(btn =>
        btn.addEventListener('click', function () { handleExtra(this.getAttribute('data-extra')); })
    );

    window.addEventListener('click', function (e) {
        if (e.target === document.getElementById('loginModal'))    closeLoginModal();
        if (e.target === document.getElementById('wicketModal'))   closeWicketModal();
        if (e.target === document.getElementById('noBallModal'))   closeNoBallModal();
    });
}

// ========================================
// UI UTILITIES
// ========================================
function toggleMobileMenu() {
    document.getElementById('mainNav').classList.toggle('mobile-open');
    document.getElementById('mobileMenuToggle').classList.toggle('active');
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const tab = document.getElementById(tabName + 'Tab');
    if (tab) tab.classList.add('active');

    const btn = document.querySelector(`[data-tab="${tabName}"]`);
    if (btn) btn.classList.add('active');

    document.getElementById('mainNav').classList.remove('mobile-open');
    document.getElementById('mobileMenuToggle').classList.remove('active');

    // Detach per-match listener when leaving the live tab
    if (tabName !== 'live' && currentMatchSubscription) {
        currentMatchSubscription.unsubscribe();
        currentMatchSubscription = null;
        currentMatchId = null;
    }

    if      (tabName === 'live')      loadLiveMatchesOnce();
    else if (tabName === 'points')    loadPointsTable();
    else if (tabName === 'stats')     loadStats();
    else if (tabName === 'previous')  loadPreviousMatches();
    else if (tabName === 'viewteams') loadPublicTeams();
    else if (tabName === 'teams')     loadTeamsManagement();
    else if (tabName === 'matches')   loadMatchesManagement();
    else if (tabName === 'scoring')   loadScoringInterface();
}

function showAdminUI() {
    document.getElementById('loginBtn')?.classList.add('hidden');
    document.getElementById('logoutBtn')?.classList.remove('hidden');
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    const ind = document.getElementById('refreshIndicator');
    if (ind) ind.classList.add('hidden');
}

function hideAdminUI() {
    document.getElementById('loginBtn')?.classList.remove('hidden');
    document.getElementById('logoutBtn')?.classList.add('hidden');
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    const ind = document.getElementById('refreshIndicator');
    if (ind) { ind.innerHTML = '🟢 Live'; ind.classList.remove('hidden'); }
}

function openLoginModal()  { document.getElementById('loginModal').classList.remove('hidden'); }
function closeLoginModal() {
    document.getElementById('loginModal').classList.add('hidden');
    document.getElementById('loginForm')?.reset();
    const msg = document.getElementById('loginMessage');
    if (msg) msg.textContent = '';
}

// ========================================
// AUTH
// ========================================
async function handleLogin(e) {
    e.preventDefault();
    const email     = document.getElementById('loginEmail').value;
    const password  = document.getElementById('loginPassword').value;
    const messageEl = document.getElementById('loginMessage');

    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
        messageEl.className = 'form-message form-message--error';
        messageEl.textContent = 'Login failed: ' + error.message;
    } else {
        messageEl.className = 'form-message form-message--success';
        messageEl.textContent = 'Login successful!';
        setTimeout(closeLoginModal, 1000);
    }
}

async function logout() {
    stopLiveListeners();
    await db.auth.signOut();
    switchTab('live');
    startLiveListeners();
    alert('Logged out successfully.');
}

// ========================================
// REALTIME LISTENERS (public view)
// ========================================
function startLiveListeners()  { attachLiveMatchesListener(); }
function stopLiveListeners() {
    if (liveMatchesSubscription)  { liveMatchesSubscription.unsubscribe();  liveMatchesSubscription  = null; }
    if (currentMatchSubscription) { currentMatchSubscription.unsubscribe(); currentMatchSubscription = null; }
}

function attachLiveMatchesListener() {
    if (liveMatchesSubscription) { liveMatchesSubscription.unsubscribe(); liveMatchesSubscription = null; }

    // Initial load
    _fetchAndRenderLiveMatches();

    // Refire whenever any match row changes
    liveMatchesSubscription = db
        .channel('live-matches-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
            _fetchAndRenderLiveMatches();
        })
        .subscribe();
}

// ========================================
// DATA LOADING
// ========================================
function loadAllData() {
    loadLiveMatchesOnce();
    loadPointsTable();
    if (isAdmin) {
        loadTeamsManagement();
        loadMatchesManagement();
        loadScoringInterface();
    }
}

async function loadLiveMatchesOnce() {
    if (!isAdmin) {
        attachLiveMatchesListener();
        return;
    }
    _fetchAndRenderLiveMatches();
}

async function _fetchAndRenderLiveMatches() {
    const { data, error } = await db
        .from('matches')
        .select('*')
        .in('status', ['live', 'upcoming'])
        .order('date_time', { ascending: true });
    if (error) { console.error('Error loading live matches:', error); return; }
    renderLiveMatchesList(data || []);
}

// ========================================
// UTILITY FUNCTIONS
// ========================================
function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function calculateStrikeRate(runs, balls) {
    if (!balls) return '0.00';
    return ((runs / balls) * 100).toFixed(2);
}

function calculateEconomy(runs, balls) {
    if (!balls) return '0.00';
    return (runs / (balls / 6)).toFixed(2);
}

function formatOvers(balls) {
    return `${Math.floor(balls / 6)}.${balls % 6}`;
}

function showMessage(msg) { alert(msg); }

// ========================================
// TEAM MANAGEMENT
// ========================================
async function handleAddTeam(e) {
    e.preventDefault();
    const name       = document.getElementById('teamName').value.trim();
    const short_name = document.getElementById('teamShortName').value.trim().toUpperCase();

    const { error } = await db.from('teams').insert({ name, short_name, players: [] });
    if (error) { showMessage('Error adding team: ' + error.message); return; }
    showMessage('Team added successfully!');
    document.getElementById('addTeamForm').reset();
    loadTeamsManagement();
}

async function handleAddPlayer(e) {
    e.preventDefault();

    // Remember selected team before any resets
    const teamId     = document.getElementById('playerTeamSelect').value;
    const playerName = document.getElementById('playerName').value.trim();

    // Fetch current players array then append
    const { data: teamData, error: fetchErr } = await db
        .from('teams').select('players').eq('id', teamId).single();
    if (fetchErr) { showMessage('Error fetching team: ' + fetchErr.message); return; }

    const updatedPlayers = [
        ...(teamData.players || []),
        { id: Date.now().toString(), name: playerName }
    ];

    const { error } = await db.from('teams').update({ players: updatedPlayers }).eq('id', teamId);
    if (error) { showMessage('Error adding player: ' + error.message); return; }
    showMessage('Player added successfully!');

    // Only reset the player name field — keep team selector on current team
    document.getElementById('playerName').value = '';

    // Reload team data but restore the team selection after
    await loadTeamsManagement();

    // Re-select the previously chosen team
    const sel = document.getElementById('playerTeamSelect');
    if (sel) sel.value = teamId;
}

async function loadTeamsManagement() {
    const { data: teams, error } = await db.from('teams').select('*').order('name');
    if (error) { console.error('Error loading teams:', error); return; }

    const playerTeamSel  = document.getElementById('playerTeamSelect');
    const matchTeam1Sel  = document.getElementById('matchTeam1');
    const matchTeam2Sel  = document.getElementById('matchTeam2');

    // Save current selection before rebuilding
    const prevTeamId = playerTeamSel.value;

    playerTeamSel.innerHTML = '<option value="">-- Select Team --</option>';
    matchTeam1Sel.innerHTML  = '<option value="">-- Select Team 1 --</option>';
    matchTeam2Sel.innerHTML  = '<option value="">-- Select Team 2 --</option>';

    const teamsList = document.getElementById('teamsList');
    teamsList.innerHTML = '';

    (teams || []).forEach(team => {
        playerTeamSel.add(new Option(team.name, team.id));
        matchTeam1Sel.add(new Option(team.name, team.id));
        matchTeam2Sel.add(new Option(team.name, team.id));

        const item = document.createElement('div');
        item.className = 'team-item';
        item.innerHTML = `
            <h4>${team.name} (${team.short_name})</h4>
            <div class="players-list">
                <strong>Players:</strong>
                ${team.players?.length
                    ? team.players.map(p => `<div class="player-name">• ${p.name}</div>`).join('')
                    : '<div class="player-name">No players added yet</div>'
                }
            </div>`;
        teamsList.appendChild(item);
    });

    // Restore previous team selection if it still exists
    if (prevTeamId) playerTeamSel.value = prevTeamId;
}

// ========================================
// PUBLIC TEAMS VIEW
// ========================================
async function loadPublicTeams() {
    const publicTeamsList = document.getElementById('publicTeamsList');
    if (!publicTeamsList) return;
    publicTeamsList.innerHTML = '';

    const { data: teams, error } = await db.from('teams').select('*').order('name');
    if (error) {
        publicTeamsList.innerHTML = `<div class="no-teams-message"><h3>❌ Error Loading Teams</h3><p>${error.message}</p></div>`;
        return;
    }

    if (!teams || teams.length === 0) {
        publicTeamsList.innerHTML = `<div class="no-teams-message"><h3>⚠️ No Teams Yet</h3><p>Teams will appear here once they are created.</p></div>`;
        return;
    }

    teams.forEach(team => {
        const card = document.createElement('div');
        card.className = 'public-team-card';

        const playersHTML = team.players?.length
            ? team.players.map(p => `
                <div class="public-player-item">
                    <span class="public-player-name">${p.name}</span>
                </div>`).join('')
            : '<div class="public-player-item"><span class="public-player-name" style="color:var(--white-40);font-style:italic;">No players yet</span></div>';

        card.innerHTML = `
            <div class="public-team-header">
                <div class="public-team-name">${team.name}</div>
                <div class="public-team-short">${team.short_name}</div>
            </div>
            <div class="public-players-section">
                <h4>Squad (${team.players?.length || 0} players)</h4>
                <div class="public-player-list">${playersHTML}</div>
            </div>`;
        publicTeamsList.appendChild(card);
    });
}

// ========================================
// MATCH MANAGEMENT
// ========================================
async function handleAddMatch(e) {
    e.preventDefault();
    const team1Id    = document.getElementById('matchTeam1').value;
    const team2Id    = document.getElementById('matchTeam2').value;
    const totalOvers = parseInt(document.getElementById('matchOvers').value);
    const dateTime   = document.getElementById('matchDateTime').value;
    const venue      = document.getElementById('matchVenue').value.trim();

    if (team1Id === team2Id) { showMessage('Please select different teams!'); return; }

    const { data: teams, error: teamErr } = await db
        .from('teams').select('*').in('id', [team1Id, team2Id]);
    if (teamErr) { showMessage('Error fetching teams: ' + teamErr.message); return; }

    const team1 = teams.find(t => t.id === team1Id);
    const team2 = teams.find(t => t.id === team2Id);

    const { error } = await db.from('matches').insert({
        team1:           { id: team1.id, name: team1.name, shortName: team1.short_name },
        team2:           { id: team2.id, name: team2.name, shortName: team2.short_name },
        total_overs:     totalOvers,
        date_time:       new Date(dateTime).toISOString(),
        venue,
        status:          'upcoming',
        current_innings: 0,
        innings:         []
    });

    if (error) { showMessage('Error creating match: ' + error.message); return; }
    showMessage('Match created successfully!');
    document.getElementById('addMatchForm').reset();
    loadMatchesManagement();
}

async function loadMatchesManagement() {
    const { data: matches, error } = await db
        .from('matches').select('*').order('date_time', { ascending: false });
    if (error) { console.error('Error loading matches:', error); return; }

    const list = document.getElementById('matchesList');
    list.innerHTML = '';

    if (!matches?.length) { list.innerHTML = '<p>No matches created yet</p>'; return; }

    matches.forEach(m => {
        const item = document.createElement('div');
        item.className = 'match-item';
        const badge =
            m.status === 'live'      ? '<span class="match-status live">LIVE</span>' :
            m.status === 'completed' ? '<span class="match-status completed">COMPLETED</span>' :
                                       '<span class="match-status upcoming">UPCOMING</span>';
        item.innerHTML = `
            <h4>${m.team1.name} vs ${m.team2.name}</h4>
            ${badge}
            <p><strong>Venue:</strong> ${m.venue}</p>
            <p><strong>Date:</strong> ${formatDate(m.date_time)}</p>
            <p><strong>Overs:</strong> ${m.total_overs}</p>`;
        list.appendChild(item);
    });
}

// ========================================
// LIVE MATCHES LIST
// ========================================
function renderLiveMatchesList(matches) {
    const container = document.getElementById('liveMatchesList');
    const details   = document.getElementById('matchDetails');

    // If the details panel is currently sitting inside the grid (inline open),
    // lift it out before we wipe innerHTML so we don't lose it from the DOM.
    if (container.contains(details)) {
        container.parentNode.appendChild(details);
    }

    container.innerHTML = '';

    if (!matches.length) {
        container.innerHTML = '<p class="no-matches-msg">No live or upcoming matches</p>';
        return;
    }

    matches.forEach(m => {
        const card = document.createElement('div');
        card.className = `match-card ${m.status === 'live' ? 'live' : ''}`;
        card.dataset.matchId = m.id;

        // Mark card as open if its details are currently showing
        if (m.id === currentMatchId && !details.classList.contains('hidden')) {
            card.classList.add('match-card--open');
        }

        card.onclick = () => _toggleLiveDetails(m.id, card);

        const badge = m.status === 'live'
            ? '<span class="match-status live">● LIVE</span>'
            : '<span class="match-status upcoming">UPCOMING</span>';

        let t1Score = '-', t2Score = '-';
        if (m.innings?.length > 0) {
            const i1 = m.innings[0];
            t1Score = `${i1.runs}/${i1.wickets} (${formatOvers(i1.balls)})`;
            if (m.innings.length > 1) {
                const i2 = m.innings[1];
                t2Score = `${i2.runs}/${i2.wickets} (${formatOvers(i2.balls)})`;
            }
        }

        card.innerHTML = `
            ${badge}
            <h4>${m.team1.name} vs ${m.team2.name}</h4>
            <div class="team-row">
                <span class="team-name">${m.team1.shortName}</span>
                <span class="team-score">${t1Score}</span>
            </div>
            <div class="team-row">
                <span class="team-name">${m.team2.shortName}</span>
                <span class="team-score">${t2Score}</span>
            </div>
            <p class="match-venue">${m.venue}</p>`;
        container.appendChild(card);
    });

    // Re-attach the open details panel inline after its card (survives re-render)
    if (currentMatchId && !details.classList.contains('hidden')) {
        const openCard = container.querySelector(`[data-match-id="${currentMatchId}"]`);
        if (openCard) openCard.insertAdjacentElement('afterend', details);
    }
}

// ────────────────────────────────────────────────────────────
// Toggle live match details inline below the clicked card
// ────────────────────────────────────────────────────────────
function _toggleLiveDetails(matchId, cardEl) {
    const details   = document.getElementById('matchDetails');
    const container = document.getElementById('liveMatchesList');

    // Tapping the already-open card → close it
    if (currentMatchId === matchId && !details.classList.contains('hidden')) {
        details.classList.add('hidden');
        container.parentNode.appendChild(details); // park outside grid
        if (currentMatchSubscription) { currentMatchSubscription.unsubscribe(); currentMatchSubscription = null; }
        currentMatchId = null;
        // Remove open highlight from all cards
        container.querySelectorAll('.match-card--open').forEach(c => c.classList.remove('match-card--open'));
        return;
    }

    // Remove open highlight from whichever card was previously open
    container.querySelectorAll('.match-card--open').forEach(c => c.classList.remove('match-card--open'));
    cardEl.classList.add('match-card--open');

    // Move details panel right after the clicked card (inside the grid → full-width span)
    cardEl.insertAdjacentElement('afterend', details);
    details.classList.remove('hidden');

    showMatchDetails(matchId);
}

// ========================================
// MATCH DETAIL VIEW (live tab)
// ========================================
function showMatchDetails(matchId) {
    currentMatchId = matchId;

    if (currentMatchSubscription) {
        currentMatchSubscription.unsubscribe();
        currentMatchSubscription = null;
    }

    // Reset commentary
    commentaryLoaded = false;
    const commentaryBtn  = document.getElementById('loadCommentaryBtn');
    const commentaryList = document.getElementById('ballCommentary');
    commentaryList.innerHTML = '';
    commentaryList.classList.add('hidden');
    commentaryBtn.textContent = 'Show Commentary ▼';

    // Initial load
    db.from('matches').select('*').eq('id', matchId).single()
        .then(({ data, error }) => {
            if (error || !data) { showMessage('Match not found'); return; }
            renderMatchDetails(data, matchId);
        });

    // Real-time updates for this match
    currentMatchSubscription = db
        .channel(`match-detail-${matchId}`)
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
            payload => { renderMatchDetails(payload.new, matchId); }
        )
        .subscribe();
}

function renderMatchDetails(match, matchId) {
    document.getElementById('matchDetails').classList.remove('hidden');
    document.getElementById('matchTitle').textContent = `${match.team1.name} vs ${match.team2.name}`;

    const statusEl = document.getElementById('matchStatus');
    statusEl.textContent = match.status.toUpperCase();
    statusEl.className   = `match-status ${match.status}`;

    if (match.innings?.length > 0) {
        const i1 = match.innings[0];
        document.getElementById('team1Name').textContent  = i1.battingTeamName || match.team1.name;
        document.getElementById('team1Score').textContent = `${i1.runs}/${i1.wickets}`;
        document.getElementById('team1Overs').textContent = `(${formatOvers(i1.balls)} ov)`;

        if (match.innings.length > 1) {
            const i2 = match.innings[1];
            document.getElementById('team2Name').textContent  = i2.battingTeamName || match.team2.name;
            document.getElementById('team2Score').textContent = `${i2.runs}/${i2.wickets}`;
            document.getElementById('team2Overs').textContent = `(${formatOvers(i2.balls)} ov)`;
        } else {
            document.getElementById('team2Name').textContent  = match.team2.name;
            document.getElementById('team2Score').textContent = '-';
            document.getElementById('team2Overs').textContent = '';
        }
    } else {
        document.getElementById('team1Name').textContent  = match.team1.name;
        document.getElementById('team1Score').textContent = '-';
        document.getElementById('team1Overs').textContent = '';
        document.getElementById('team2Name').textContent  = match.team2.name;
        document.getElementById('team2Score').textContent = '-';
        document.getElementById('team2Overs').textContent = '';
    }

    renderPartnership(match);
    loadBattingScorecard(match);
    loadBowlingScorecard(match);
}

function renderPartnership(match) {
    const el = document.getElementById('partnershipDetails');
    if (!match.innings || match.current_innings === 0) { el.innerHTML = ''; return; }
    const inn = match.innings[match.current_innings - 1];
    if (!inn) { el.innerHTML = ''; return; }
    const striker    = inn.batsmen?.find(b => b.id === inn.striker);
    const nonStriker = inn.batsmen?.find(b => b.id === inn.nonStriker);
    el.innerHTML = (striker && nonStriker)
        ? `<span>${striker.name}* ${striker.runs}(${striker.balls})</span> &nbsp;|&nbsp; <span>${nonStriker.name} ${nonStriker.runs}(${nonStriker.balls})</span>`
        : '';
}

// ========================================
// COMMENTARY (lazy load)
// ========================================
function toggleCommentary() {
    const list = document.getElementById('ballCommentary');
    const btn  = document.getElementById('loadCommentaryBtn');
    if (list.classList.contains('hidden')) {
        list.classList.remove('hidden');
        btn.textContent = 'Hide Commentary ▲';
        if (!commentaryLoaded && currentMatchId) loadBallCommentary(currentMatchId);
    } else {
        list.classList.add('hidden');
        btn.textContent = 'Show Commentary ▼';
    }
}

async function loadBallCommentary(matchId) {
    const { data, error } = await db
        .from('balls')
        .select('*')
        .eq('match_id', matchId)
        .order('created_at', { ascending: false })
        .limit(20);

    const list = document.getElementById('ballCommentary');
    list.innerHTML = '';
    commentaryLoaded = true;

    if (error || !data?.length) { list.innerHTML = '<p>No balls bowled yet</p>'; return; }

    data.forEach(ball => {
        const item = document.createElement('div');
        item.className = 'commentary-item';
        item.innerHTML = `<div class="ball-info">${formatOvers(ball.over_ball)}</div><div class="ball-desc">${ball.description}</div>`;
        list.appendChild(item);
    });
}

// ========================================
// SCORECARDS
// ========================================
function loadBattingScorecard(match) {
    const body = document.getElementById('battingTableBody');
    body.innerHTML = '';
    if (!match.innings?.length) {
        body.innerHTML = '<tr><td colspan="7" class="no-data-cell">No batting data yet</td></tr>'; return;
    }
    const inn = match.innings[match.current_innings - 1] || match.innings[match.innings.length - 1];
    if (!inn?.batsmen?.length) {
        body.innerHTML = '<tr><td colspan="7" class="no-data-cell">No batting data yet</td></tr>'; return;
    }
    inn.batsmen.forEach(b => {
        const row = document.createElement('tr');
        if (b.isStriker) row.classList.add('striker');
        row.innerHTML = `
            <td>${b.name}</td><td>${b.runs}</td><td>${b.balls}</td>
            <td>${b.fours||0}</td><td>${b.sixes||0}</td>
            <td>${calculateStrikeRate(b.runs, b.balls)}</td>
            <td>${b.status || (b.isOut ? 'Out' : 'Not Out')}</td>`;
        body.appendChild(row);
    });
}

function loadBowlingScorecard(match) {
    const body = document.getElementById('bowlingTableBody');
    body.innerHTML = '';
    if (!match.innings?.length) {
        body.innerHTML = '<tr><td colspan="7" class="no-data-cell">No bowling data yet</td></tr>'; return;
    }
    const inn = match.innings[match.current_innings - 1] || match.innings[match.innings.length - 1];
    if (!inn?.bowlers?.length) {
        body.innerHTML = '<tr><td colspan="7" class="no-data-cell">No bowling data yet</td></tr>'; return;
    }
    inn.bowlers.forEach(b => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${b.name}</td><td>${formatOvers(b.balls)}</td>
            <td>${b.maidens||0}</td><td>${b.runs}</td><td>${b.wickets}</td>
            <td>${b.extras||0}</td><td>${calculateEconomy(b.runs, b.balls)}</td>`;
        body.appendChild(row);
    });
}

// ========================================
// POINTS TABLE
// ========================================
async function loadPointsTable() {
    const { data: teams }   = await db.from('teams').select('*');
    const { data: matches } = await db.from('matches').select('*').eq('status', 'completed');

    if (!teams) return;

    const pts = {};
    teams.forEach(t => {
        pts[t.id] = {
            name: t.name, played: 0, won: 0, lost: 0, tied: 0, points: 0,
            totalRunsScored: 0, totalBallsFaced: 0, totalRunsConceded: 0, totalBallsBowled: 0, nrr: 0
        };
    });

    (matches || []).forEach(m => {
        if (!m.innings || m.innings.length < 2) return;
        const i1 = m.innings[0], i2 = m.innings[1];
        const t1 = m.team1.id, t2 = m.team2.id;
        if (!pts[t1] || !pts[t2]) return;

        pts[t1].played++; pts[t2].played++;

        if (i1.battingTeamId === t1) {
            pts[t1].totalRunsScored   += i1.runs;  pts[t1].totalBallsFaced   += i1.balls;
            pts[t1].totalRunsConceded += i2.runs;  pts[t1].totalBallsBowled  += i2.balls;
            pts[t2].totalRunsScored   += i2.runs;  pts[t2].totalBallsFaced   += i2.balls;
            pts[t2].totalRunsConceded += i1.runs;  pts[t2].totalBallsBowled  += i1.balls;
        } else {
            pts[t2].totalRunsScored   += i1.runs;  pts[t2].totalBallsFaced   += i1.balls;
            pts[t2].totalRunsConceded += i2.runs;  pts[t2].totalBallsBowled  += i2.balls;
            pts[t1].totalRunsScored   += i2.runs;  pts[t1].totalBallsFaced   += i2.balls;
            pts[t1].totalRunsConceded += i1.runs;  pts[t1].totalBallsBowled  += i1.balls;
        }

        if (m.result) {
            if (m.result.includes('Tied') || m.result.includes('tied')) {
                pts[t1].tied++; pts[t2].tied++; pts[t1].points++; pts[t2].points++;
            } else if (m.result.includes(m.team1.name)) {
                pts[t1].won++; pts[t2].lost++; pts[t1].points += 2;
            } else if (m.result.includes(m.team2.name)) {
                pts[t2].won++; pts[t1].lost++; pts[t2].points += 2;
            }
        }
    });

    Object.values(pts).forEach(t => {
        if (t.played > 0) {
            const rrFor     = t.totalBallsFaced  > 0 ? t.totalRunsScored   / (t.totalBallsFaced  / 6) : 0;
            const rrAgainst = t.totalBallsBowled > 0 ? t.totalRunsConceded / (t.totalBallsBowled / 6) : 0;
            t.nrr = rrFor - rrAgainst;
        }
    });

    const sorted = Object.values(pts).sort((a, b) => b.points - a.points || b.nrr - a.nrr);
    const body = document.getElementById('pointsTableBody');
    body.innerHTML = '';
    sorted.forEach((t, i) => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${i+1}</td><td>${t.name}</td><td>${t.played}</td><td>${t.won}</td><td>${t.lost}</td><td>${t.tied}</td><td>${t.nrr.toFixed(3)}</td><td><strong>${t.points}</strong></td>`;
        body.appendChild(row);
    });
}

// ========================================
// PREVIOUS MATCHES
// ========================================
async function loadPreviousMatches() {
    const { data: matches, error } = await db
        .from('matches').select('*').eq('status', 'completed')
        .order('completed_at', { ascending: false });
    if (error) { console.error(error); return; }

    const list = document.getElementById('previousMatchesList');

    // Lift details panel out of the grid before clearing so we don't lose it
    const details = document.getElementById('previousMatchDetails');
    if (list.contains(details)) list.parentNode.appendChild(details);

    list.innerHTML = '';
    openPrevMatchId = null;
    details.classList.add('hidden');

    if (!matches?.length) {
        list.innerHTML = '<p class="no-matches-msg">No completed matches yet</p>';
        return;
    }

    matches.forEach(m => {
        const card = document.createElement('div');
        card.className = 'match-card';
        card.dataset.matchId = m.id;
        card.onclick = () => _togglePrevDetails(m.id, card);

        let t1Score = '-', t2Score = '-';
        if (m.innings?.length > 0) {
            const i1 = m.innings[0];
            t1Score = `${i1.runs}/${i1.wickets} (${formatOvers(i1.balls)})`;
            if (m.innings.length > 1) {
                const i2 = m.innings[1];
                t2Score = `${i2.runs}/${i2.wickets} (${formatOvers(i2.balls)})`;
            }
        }

        card.innerHTML = `
            <span class="match-status completed">COMPLETED</span>
            <h4>${m.team1.name} vs ${m.team2.name}</h4>
            <div class="team-row">
                <span class="team-name">${m.team1.shortName}</span>
                <span class="team-score">${t1Score}</span>
            </div>
            <div class="team-row">
                <span class="team-name">${m.team2.shortName}</span>
                <span class="team-score">${t2Score}</span>
            </div>
            <p class="match-result-text">${m.result||'Result pending'}</p>`;
        list.appendChild(card);
    });
}

// ────────────────────────────────────────────────────────────
// Toggle previous match details inline below the clicked card
// ────────────────────────────────────────────────────────────
function _togglePrevDetails(matchId, cardEl) {
    const details = document.getElementById('previousMatchDetails');
    const list    = document.getElementById('previousMatchesList');

    // Tapping the already-open card → close it
    if (openPrevMatchId === matchId && !details.classList.contains('hidden')) {
        details.classList.add('hidden');
        list.parentNode.appendChild(details); // park outside grid
        openPrevMatchId = null;
        list.querySelectorAll('.match-card--open').forEach(c => c.classList.remove('match-card--open'));
        return;
    }

    // Remove open highlight from previous card
    list.querySelectorAll('.match-card--open').forEach(c => c.classList.remove('match-card--open'));
    cardEl.classList.add('match-card--open');

    openPrevMatchId = matchId;

    // Move details panel right after the clicked card (inside grid → full-width span)
    cardEl.insertAdjacentElement('afterend', details);
    details.classList.remove('hidden');

    showPreviousMatchDetails(matchId);
}

async function showPreviousMatchDetails(matchId) {
    const { data: m, error } = await db.from('matches').select('*').eq('id', matchId).single();
    if (error || !m) { showMessage('Match not found'); return; }

    document.getElementById('previousMatchDetails').classList.remove('hidden');
    document.getElementById('prevMatchTitle').textContent  = `${m.team1.name} vs ${m.team2.name}`;
    document.getElementById('prevMatchResult').textContent = m.result || 'Result pending';
    document.getElementById('prevMotm').textContent        = m.man_of_the_match?.name || '-';
    document.getElementById('prevBestBat').textContent     = m.best_batsman  ? `${m.best_batsman.name} (${m.best_batsman.runs})`                         : '-';
    document.getElementById('prevBestBowl').textContent    = m.best_bowler   ? `${m.best_bowler.name} (${m.best_bowler.wickets}/${m.best_bowler.runs})` : '-';

    if (m.innings?.length >= 2) {
        const i1 = m.innings[0], i2 = m.innings[1];
        document.getElementById('prevTeam1Name').textContent  = i1.battingTeamName;
        document.getElementById('prevTeam1Score').textContent = `${i1.runs}/${i1.wickets}`;
        document.getElementById('prevTeam1Overs').textContent = `(${formatOvers(i1.balls)} ov)`;
        document.getElementById('prevTeam2Name').textContent  = i2.battingTeamName;
        document.getElementById('prevTeam2Score').textContent = `${i2.runs}/${i2.wickets}`;
        document.getElementById('prevTeam2Overs').textContent = `(${formatOvers(i2.balls)} ov)`;
        loadPreviousInningsScorecard(i1, 1);
        loadPreviousInningsScorecard(i2, 2);
        // FIX 3: Load ball-by-ball commentary per innings from the balls table
        loadPreviousMatchCommentary(matchId);
    }
}

function loadPreviousInningsScorecard(innings, num) {
    const battingBody  = document.getElementById(`prevInnings${num}BattingBody`);
    const bowlingBody  = document.getElementById(`prevInnings${num}BowlingBody`);
    battingBody.innerHTML = '';
    bowlingBody.innerHTML = '';

    if (innings.batsmen?.length) {
        innings.batsmen.forEach(b => {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${b.name}</td><td>${b.runs}</td><td>${b.balls}</td><td>${b.fours||0}</td><td>${b.sixes||0}</td><td>${calculateStrikeRate(b.runs,b.balls)}</td><td>${b.status||(b.isOut?'Out':'Not Out')}</td>`;
            battingBody.appendChild(row);
        });
    } else {
        battingBody.innerHTML = '<tr><td colspan="7" class="no-data-cell">No data</td></tr>';
    }

    if (innings.bowlers?.length) {
        innings.bowlers.forEach(b => {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${b.name}</td><td>${formatOvers(b.balls)}</td><td>${b.maidens||0}</td><td>${b.runs}</td><td>${b.wickets}</td><td>${b.extras||0}</td><td>${calculateEconomy(b.runs,b.balls)}</td>`;
            bowlingBody.appendChild(row);
        });
    } else {
        bowlingBody.innerHTML = '<tr><td colspan="7" class="no-data-cell">No data</td></tr>';
    }
}

// FIX 3: Ball-by-ball commentary per innings for previous matches
async function loadPreviousMatchCommentary(matchId) {
    const { data, error } = await db
        .from('balls')
        .select('*')
        .eq('match_id', matchId)
        .order('innings_number', { ascending: true })
        .order('created_at', { ascending: true });

    [1, 2].forEach(num => {
        const container = document.getElementById(`prevInnings${num}Commentary`);
        if (!container) return;
        container.innerHTML = '';

        if (error || !data?.length) {
            container.innerHTML = '<p class="no-data-cell">No ball data recorded</p>';
            return;
        }

        const inningsBalls = data.filter(b => b.innings_number === num);
        if (!inningsBalls.length) {
            container.innerHTML = '<p class="no-data-cell">No balls recorded for this innings</p>';
            return;
        }

        inningsBalls.forEach(ball => {
            const item = document.createElement('div');
            item.className = 'commentary-item';
            item.innerHTML = `<div class="ball-info">${formatOvers(ball.over_ball)}</div><div class="ball-desc">${ball.description}</div>`;
            container.appendChild(item);
        });
    });
}

// ========================================
// STATS & RANKINGS
// ========================================
async function loadStats() {
    const { data: matches } = await db.from('matches').select('*').eq('status', 'completed');
    const playerStats = {};

    (matches || []).forEach(m => {
        if (!m.innings) return;
        m.innings.forEach(inn => {
            inn.batsmen?.forEach(b => {
                const k = b.name + '||' + inn.battingTeamName;
                if (!playerStats[k]) playerStats[k] = { name: b.name, team: inn.battingTeamName, runs: 0, wickets: 0, wBalls: 0, wRuns: 0, motmCount: 0 };
                playerStats[k].runs += b.runs || 0;
            });
            inn.bowlers?.forEach(b => {
                const k = b.name + '||' + inn.fieldingTeamName;
                if (!playerStats[k]) playerStats[k] = { name: b.name, team: inn.fieldingTeamName, runs: 0, wickets: 0, wBalls: 0, wRuns: 0, motmCount: 0 };
                playerStats[k].wickets += b.wickets || 0;
                playerStats[k].wBalls  += b.balls   || 0;
                playerStats[k].wRuns   += b.runs    || 0;
            });
        });
        if (m.man_of_the_match) {
            Object.keys(playerStats).forEach(k => {
                if (playerStats[k].name === m.man_of_the_match.name) playerStats[k].motmCount++;
            });
        }
    });

    const all = Object.values(playerStats);

    const battingBody = document.getElementById('battingRankingsBody');
    battingBody.innerHTML = '';
    [...all].sort((a, b) => b.runs - a.runs).slice(0, 10).forEach((p, i) => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${i+1}</td><td>${p.name}</td><td>${p.team||'-'}</td><td><strong>${p.runs}</strong></td>`;
        battingBody.appendChild(row);
    });

    const bowlingBody = document.getElementById('bowlingRankingsBody');
    bowlingBody.innerHTML = '';
    [...all].sort((a, b) => b.wickets !== a.wickets ? b.wickets - a.wickets : (a.wRuns/(a.wBalls||1)) - (b.wRuns/(b.wBalls||1))).slice(0, 10).forEach((p, i) => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${i+1}</td><td>${p.name}</td><td>${p.team||'-'}</td><td><strong>${p.wickets}</strong></td>`;
        bowlingBody.appendChild(row);
    });

    const mvp = [...all].sort((a, b) => b.motmCount !== a.motmCount ? b.motmCount - a.motmCount : b.runs - a.runs)[0];
    document.getElementById('mvpName').textContent   = (mvp?.runs > 0) ? mvp.name : 'No data yet';
    document.getElementById('mvpPoints').textContent = (mvp?.runs > 0) ? `${mvp.runs} runs | ${mvp.wickets} wickets | ${mvp.motmCount} MOTM award(s)` : '';
}

// ========================================
// SCORING INTERFACE — Match Selector
// ========================================
async function loadScoringInterface() {
    const { data: matches } = await db
        .from('matches').select('*').in('status', ['upcoming', 'live']);
    const sel = document.getElementById('scoringMatchSelect');
    sel.innerHTML = '<option value="">-- Select Match --</option>';
    (matches || []).forEach(m => sel.add(new Option(`${m.team1.name} vs ${m.team2.name} (${m.status})`, m.id)));
}

async function handleScoringMatchSelect() {
    const matchId = document.getElementById('scoringMatchSelect').value;
    if (!matchId) {
        document.getElementById('scoringInterface').classList.add('hidden');
        currentScoringMatch = null;
        return;
    }
    const { data: m } = await db.from('matches').select('*').eq('id', matchId).single();
    if (!m) return;
    currentScoringMatch = m;
    document.getElementById('scoringInterface').classList.remove('hidden');
    document.getElementById('scoringMatchTitle').textContent = `${m.team1.name} vs ${m.team2.name}`;
    refreshScoringUI();
}

// ========================================
// SCORING UI REFRESH
// ========================================
function refreshScoringUI() {
    if (!currentScoringMatch) return;
    const match = currentScoringMatch;

    const tossSelection   = document.getElementById('tossSelection');
    const tossInfoDisplay = document.getElementById('tossInfoDisplay');
    const startInningsBtn = document.getElementById('startInningsBtn');
    const endInningsBtn   = document.getElementById('endInningsBtn');
    const endMatchBtn     = document.getElementById('endMatchBtn');
    const batsmenSel      = document.getElementById('batsmenSelection');
    const bowlerSel       = document.getElementById('bowlerSelection');
    const currentPlayers  = document.getElementById('currentPlayers');
    const scoringControls = document.getElementById('scoringControls');

    // Reset all
    [batsmenSel, bowlerSel, currentPlayers, scoringControls].forEach(el => el.classList.add('hidden'));
    [startInningsBtn, endInningsBtn, endMatchBtn].forEach(el => el.classList.add('hidden'));
    _clearStatusBanners();

    // ── Step 1: Toss ────────────────────────────────────────────
    if (!match.toss) {
        tossSelection.classList.remove('hidden');
        tossInfoDisplay.classList.add('hidden');
        const tw = document.getElementById('tossWinnerSelect');
        tw.innerHTML = '<option value="">-- Select Toss Winner --</option>';
        tw.add(new Option(match.team1.name, match.team1.id));
        tw.add(new Option(match.team2.name, match.team2.id));
        return;
    }

    tossSelection.classList.add('hidden');
    tossInfoDisplay.classList.remove('hidden');
    document.getElementById('tossInfoText').textContent =
        `${match.toss.winnerName} won the toss and chose to ${match.toss.decision === 'bat' ? 'bat' : 'bowl'} first`;

    // ── Step 2: Pre-innings ──────────────────────────────────────
    if (match.status === 'upcoming' || match.current_innings === 0) {
        startInningsBtn.classList.remove('hidden');
        return;
    }

    // ── Step 3: Live ─────────────────────────────────────────────
    if (match.status === 'live') {
        const inn = match.innings[match.current_innings - 1];

        document.getElementById('scoringBattingTeam').textContent = inn.battingTeamName;
        document.getElementById('scoringScore').textContent       = `${inn.runs}/${inn.wickets}`;
        document.getElementById('scoringOvers').textContent       = `(${formatOvers(inn.balls)})`;

        // Target info (2nd innings)
        const targetEl = document.getElementById('targetInfo');
        if (match.current_innings === 2 && match.innings.length >= 2) {
            const target     = match.innings[0].runs + 1;
            const runsNeeded = target - inn.runs;
            const ballsLeft  = (match.total_overs * 6) - inn.balls;
            const rrr        = ballsLeft > 0 ? ((runsNeeded / ballsLeft) * 6).toFixed(2) : '0.00';
            if (targetEl) targetEl.textContent = runsNeeded > 0
                ? `Target: ${target} | Need ${runsNeeded} from ${ballsLeft} balls | RRR: ${rrr}`
                : '🎉 TARGET ACHIEVED!';
        } else {
            if (targetEl) targetEl.textContent = '';
        }

        // Need batsmen / bowler selection first
        if (!inn.striker || !inn.bowler) {
            if (!inn.striker) showBatsmenSelection();
            else              showBowlerSelection();
            return;
        }

        // ── Innings state ────────────────────────────────────────
        const maxWickets    = inn.maxWickets ?? 10;
        const totalBalls    = match.total_overs * 6;
        const isAllOut      = inn.allOut === true || inn.wickets >= maxWickets;
        const oversComplete = inn.balls >= totalBalls;
        const inningsLocked = isAllOut || oversComplete;

        // Update current-player panel
        currentPlayers.classList.remove('hidden');
        const striker    = inn.batsmen?.find(b => b.id === inn.striker);
        const nonStriker = inn.batsmen?.find(b => b.id === inn.nonStriker);
        const bowler     = inn.bowlers?.find(b => b.id === inn.bowler);
        document.getElementById('currentStriker').textContent    = striker?.name    || '-';
        document.getElementById('strikerStats').textContent      = striker    ? `${striker.runs}(${striker.balls})`                              : '0(0)';
        document.getElementById('currentNonStriker').textContent = nonStriker?.name || '-';
        document.getElementById('nonStrikerStats').textContent   = nonStriker ? `${nonStriker.runs}(${nonStriker.balls})`                        : '0(0)';
        document.getElementById('currentBowler').textContent     = bowler?.name     || '-';
        document.getElementById('bowlerStats').textContent       = bowler     ? `${bowler.wickets}-${bowler.runs} (${formatOvers(bowler.balls)})` : '0-0 (0.0)';

        if (inningsLocked) {
            scoringControls.classList.add('hidden');
            if (match.current_innings === 1) endInningsBtn.classList.remove('hidden');
            else                             endMatchBtn.classList.remove('hidden');
            if (isAllOut) _showAllOutBanner(inn, match);
            else          _showOversCompleteBanner(match);
        } else {
            scoringControls.classList.remove('hidden');
            endInningsBtn.classList.remove('hidden');
            endMatchBtn.classList.remove('hidden');
        }

        renderThisOver(inn);
        renderScoringCommentary(match.id);
    }
}

// ── Banner helpers ───────────────────────────────────────────────
function _clearStatusBanners() {
    ['inningsCompleteBanner', 'allOutBanner'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });
}

function _showAllOutBanner(inn, match) {
    let banner = document.getElementById('allOutBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'allOutBanner';
        banner.className = 'all-out-banner';
        document.getElementById('currentPlayers').insertAdjacentElement('afterend', banner);
    }
    const action = match.current_innings === 1
        ? 'Click "End Innings" to start the second innings.'
        : 'Click "End Match" to finish.';
    banner.innerHTML = `
        <span class="all-out-badge">ALL OUT!</span>
        <span class="all-out-detail">
            ${inn.battingTeamName} all out for <strong>${inn.runs}</strong>
            (${formatOvers(inn.balls)} overs, ${inn.wickets} wickets) — ${action}
        </span>`;
}

function _showOversCompleteBanner(match) {
    let banner = document.getElementById('inningsCompleteBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'inningsCompleteBanner';
        banner.className = 'innings-complete-banner';
        document.getElementById('currentPlayers').insertAdjacentElement('afterend', banner);
    }
    const action = match.current_innings === 1
        ? 'Click "End Innings" to start the second innings.'
        : 'Click "End Match" to finish.';
    banner.textContent = `🏏 All ${match.total_overs} overs completed. ${action}`;
}

// ========================================
// THIS OVER DISPLAY
// ========================================
function renderThisOver(inn) {
    const container = document.getElementById('thisOverBalls');
    container.innerHTML = '';
    (inn.thisOver || []).forEach(ball => {
        const span = document.createElement('span');
        span.className = 'over-ball';
        if (ball.isWicket) {
            span.classList.add('wicket');
            span.textContent = 'W';
        } else if (ball.extraType) {
            span.classList.add('extra');
            if (ball.extraType === 'wide') {
                span.textContent = 'Wd';
            } else if (ball.extraType === 'noball') {
                // Show batsman runs alongside the Nb label if any were scored
                span.textContent = (ball.batsmanRuns > 0) ? `Nb+${ball.batsmanRuns}` : 'Nb';
            } else {
                span.textContent = ball.runs > 0 ? ball.runs : '0';
            }
        } else {
            if (ball.runs === 4) span.classList.add('four');
            if (ball.runs === 6) span.classList.add('six');
            span.textContent = ball.runs;
        }
        container.appendChild(span);
    });
}

// ========================================
// SCORING COMMENTARY (admin panel)
// ========================================
async function renderScoringCommentary(matchId) {
    const { data } = await db
        .from('balls').select('*').eq('match_id', matchId)
        .order('created_at', { ascending: false }).limit(10);

    const container = document.getElementById('scoringCommentary');
    container.innerHTML = '';
    (data || []).forEach(ball => {
        const item = document.createElement('div');
        item.className = 'commentary-item';
        item.innerHTML = `<div class="ball-info">${formatOvers(ball.over_ball)}</div><div class="ball-desc">${ball.description}</div>`;
        container.appendChild(item);
    });
}

// ========================================
// TOSS
// ========================================
async function confirmToss() {
    const winnerId = document.getElementById('tossWinnerSelect').value;
    const decision = document.getElementById('tossDecisionSelect').value;
    if (!winnerId || !decision) { showMessage('Please select toss winner and decision.'); return; }

    const match      = currentScoringMatch;
    const winnerName = match.team1.id === winnerId ? match.team1.name : match.team2.name;
    const battingTeam  = decision === 'bat'
        ? (match.team1.id === winnerId ? match.team1 : match.team2)
        : (match.team1.id === winnerId ? match.team2 : match.team1);
    const fieldingTeam = battingTeam.id === match.team1.id ? match.team2 : match.team1;

    const { error } = await db.from('matches').update({
        toss:                { winnerId, winnerName, decision },
        batting_first_team:  battingTeam,
        fielding_first_team: fieldingTeam
    }).eq('id', match.id);

    if (error) { showMessage('Error saving toss: ' + error.message); return; }
    currentScoringMatch = { ...match, toss: { winnerId, winnerName, decision }, batting_first_team: battingTeam, fielding_first_team: fieldingTeam };
    refreshScoringUI();
}

// ========================================
// START INNINGS
// ========================================
async function startInnings() {
    const match      = currentScoringMatch;
    const inningsIdx = match.innings ? match.innings.length : 0;

    let battingTeam, fieldingTeam;
    if (inningsIdx === 0) {
        battingTeam  = match.batting_first_team  || match.team1;
        fieldingTeam = match.fielding_first_team || match.team2;
    } else {
        battingTeam  = match.innings[0].battingTeamId === match.team1.id ? match.team2 : match.team1;
        fieldingTeam = match.innings[0].battingTeamId === match.team1.id ? match.team1 : match.team2;
    }

    const { data: teamData } = await db.from('teams').select('players').eq('id', battingTeam.id).single();
    const rosterSize = teamData?.players?.length || 11;
    const maxWickets = Math.max(rosterSize - 1, 1);

    const newInnings = {
        inningsNumber:    inningsIdx + 1,
        battingTeamId:    battingTeam.id,
        battingTeamName:  battingTeam.name,
        fieldingTeamId:   fieldingTeam.id,
        fieldingTeamName: fieldingTeam.name,
        runs: 0, wickets: 0, balls: 0,
        batsmen: [], bowlers: [],
        striker: null, nonStriker: null, bowler: null, thisOver: [],
        maxWickets,
        allOut: false
    };

    const updatedInnings = [...(match.innings || []), newInnings];

    const { error } = await db.from('matches').update({
        status:          'live',
        innings:         updatedInnings,
        current_innings: inningsIdx + 1
    }).eq('id', match.id);

    if (error) { showMessage('Error starting innings: ' + error.message); return; }
    currentScoringMatch = { ...match, status: 'live', innings: updatedInnings, current_innings: inningsIdx + 1 };
    showBatsmenSelection();
    refreshScoringUI();
}

// ========================================
// BATSMEN / BOWLER SELECTION
// ========================================
async function showBatsmenSelection() {
    const match = currentScoringMatch;
    const inn   = match.innings[match.current_innings - 1];
    const { data: teamData } = await db.from('teams').select('players').eq('id', inn.battingTeamId).single();
    const players = teamData?.players || [];
    const usedIds = (inn.batsmen || []).filter(b => !b.isOut).map(b => b.id);

    const strikerSel    = document.getElementById('strikerSelect');
    const nonStrikerSel = document.getElementById('nonStrikerSelect');
    strikerSel.innerHTML    = '<option value="">-- Select Striker --</option>';
    nonStrikerSel.innerHTML = '<option value="">-- Select Non-Striker --</option>';

    const available = players.filter(p => !usedIds.includes(p.id));

    if (available.length === 0) {
        strikerSel.innerHTML    = '<option value="">No available players</option>';
        nonStrikerSel.innerHTML = '<option value="">No available players</option>';
    } else {
        available.forEach(p => {
            strikerSel.add(new Option(p.name, p.id + '||' + p.name));
            nonStrikerSel.add(new Option(p.name, p.id + '||' + p.name));
        });
    }

    const heading = document.querySelector('#batsmenSelection h4');
    if (heading) {
        heading.textContent = inn.inningsNumber === 1 ? 'Select Opening Batsmen' : 'Select Opening Batsmen (2nd Innings)';
    }

    document.getElementById('batsmenSelection').classList.remove('hidden');
    document.getElementById('bowlerSelection').classList.add('hidden');
    document.getElementById('currentPlayers').classList.add('hidden');
    document.getElementById('scoringControls').classList.add('hidden');
}

// ========================================
// END OF OVER — CHANGE BOWLER PROMPT
// ========================================
function showEndOfOverPrompt() {
    const match = currentScoringMatch;
    const inn   = match.innings[match.current_innings - 1];
    const bowler = inn.bowlers?.find(b => b.id === inn.bowler);
    const overNum = Math.floor(inn.balls / 6);

    const modal  = document.getElementById('endOfOverModal');
    const msgEl  = document.getElementById('endOfOverMsg');
    const keepBtn = document.getElementById('keepBowlerBtn');
    const changBtn = document.getElementById('changeBowlerPromptBtn');

    msgEl.textContent = `Over ${overNum} complete! ${bowler ? bowler.name + ' bowled that over.' : ''}`;
    keepBtn.textContent = `Keep ${bowler ? bowler.name : 'Same Bowler'}`;

    keepBtn.onclick = async () => {
        modal.classList.add('hidden');
        // Re-confirm the same bowler so thisOver is cleared and the new over starts
        if (inn.bowler) {
            const bv = inn.bowler + '||' + (bowler?.name || '');
            document.getElementById('bowlerSelect').value = ''; // reset
            await _reconfirmSameBowler(inn.bowler, bowler?.name || '');
        }
    };

    changBtn.onclick = () => {
        modal.classList.add('hidden');
        showBowlerSelection();
    };

    modal.classList.remove('hidden');
}

async function _reconfirmSameBowler(bid, bname) {
    const match   = currentScoringMatch;
    const idx     = match.current_innings - 1;
    const innings = [...match.innings];
    const inn     = { ...innings[idx] };

    // Clear thisOver for the new over (same as confirmBowler does)
    inn.thisOver = [];
    innings[idx] = inn;

    const { error } = await db.from('matches').update({ innings }).eq('id', match.id);
    if (error) { showMessage('Error starting new over: ' + error.message); return; }
    currentScoringMatch = { ...match, innings };
    refreshScoringUI();
}

async function showBowlerSelection() {
    const match = currentScoringMatch;
    const inn   = match.innings[match.current_innings - 1];
    const { data: teamData } = await db.from('teams').select('players').eq('id', inn.fieldingTeamId).single();
    const players = teamData?.players || [];

    const bowlerSel = document.getElementById('bowlerSelect');
    bowlerSel.innerHTML = '<option value="">-- Select Bowler --</option>';
    players.forEach(p => {
        const record = (inn.bowlers || []).find(b => b.id === String(p.id));
        let label = p.name;
        if (record && record.balls > 0) {
            const completedOvers = Math.floor(record.balls / 6);
            if (completedOvers > 0) {
                label += ` — ${completedOvers} over${completedOvers > 1 ? 's' : ''} completed`;
            } else {
                const b = record.balls;
                label += ` — ${b} ball${b !== 1 ? 's' : ''} bowled`;
            }
        }
        bowlerSel.add(new Option(label, p.id + '||' + p.name));
    });

    document.getElementById('bowlerSelection').classList.remove('hidden');
    document.getElementById('batsmenSelection').classList.add('hidden');
    // Hide scoring controls so the scorer can't record balls before selecting bowler
    document.getElementById('scoringControls').classList.add('hidden');

    // Render the completed over's deliveries so the scorer can see all 6 balls
    // while choosing the next bowler. renderThisOver is normally only called from
    // refreshScoringUI, which is skipped when showBowlerSelection is called directly.
    renderThisOver(inn);
}

async function confirmBatsmen() {
    const sv = document.getElementById('strikerSelect').value;
    const nv = document.getElementById('nonStrikerSelect').value;
    if (!sv || !nv) { showMessage('Please select both batsmen.'); return; }
    if (sv === nv)  { showMessage('Please select two different batsmen.'); return; }

    const [sid, sname] = sv.split('||');
    const [nid, nname] = nv.split('||');
    const match  = currentScoringMatch;
    const idx    = match.current_innings - 1;
    const innings = [...match.innings];
    const inn     = { ...innings[idx] };
    const batsmen = [...(inn.batsmen || [])];

    if (!batsmen.find(b => b.id === sid)) batsmen.push({ id: sid, name: sname, runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, isStriker: true,  status: 'Not Out' });
    if (!batsmen.find(b => b.id === nid)) batsmen.push({ id: nid, name: nname, runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, isStriker: false, status: 'Not Out' });

    inn.batsmen    = batsmen;
    inn.striker    = sid;
    inn.nonStriker = nid;
    innings[idx]   = inn;

    const { error } = await db.from('matches').update({ innings }).eq('id', match.id);
    if (error) { showMessage('Error confirming batsmen: ' + error.message); return; }
    currentScoringMatch = { ...match, innings };
    document.getElementById('batsmenSelection').classList.add('hidden');
    showBowlerSelection();
}

async function confirmBowler() {
    const bv = document.getElementById('bowlerSelect').value;
    if (!bv) { showMessage('Please select a bowler.'); return; }

    const [bid, bname] = bv.split('||');
    const match   = currentScoringMatch;
    const idx     = match.current_innings - 1;
    const innings = [...match.innings];
    const inn     = { ...innings[idx] };
    const bowlers = [...(inn.bowlers || [])];

    if (!bowlers.find(b => b.id === bid))
        bowlers.push({ id: bid, name: bname, balls: 0, runs: 0, wickets: 0, maidens: 0, extras: 0 });

    inn.bowlers  = bowlers;
    inn.bowler   = bid;
    // Clear the previous over's deliveries now that a new over is beginning
    inn.thisOver = [];
    innings[idx] = inn;

    const { error } = await db.from('matches').update({ innings }).eq('id', match.id);
    if (error) { showMessage('Error confirming bowler: ' + error.message); return; }
    currentScoringMatch = { ...match, innings };
    document.getElementById('bowlerSelection').classList.add('hidden');
    refreshScoringUI();
}

// ========================================
// CHANGE STRIKE / CHANGE BOWLER
// ========================================
async function changeStrike() {
    const match   = currentScoringMatch;
    const idx     = match.current_innings - 1;
    const innings = [...match.innings];
    const inn     = { ...innings[idx] };

    const t        = inn.striker;
    inn.striker    = inn.nonStriker;
    inn.nonStriker = t;
    inn.batsmen    = inn.batsmen.map(b => ({ ...b, isStriker: b.id === inn.striker }));
    innings[idx]   = inn;

    const { error } = await db.from('matches').update({ innings }).eq('id', match.id);
    if (error) { showMessage('Error changing strike: ' + error.message); return; }
    currentScoringMatch = { ...match, innings };
    refreshScoringUI();
}

function showChangeBowler() { showBowlerSelection(); }

// ========================================
// NO BALL MODAL
// ========================================
function showNoBallModal()  { document.getElementById('noBallModal').classList.remove('hidden'); }
function closeNoBallModal() { document.getElementById('noBallModal').classList.add('hidden'); }

// Called when the scorer taps a run button inside the no-ball modal.
// batsmanRuns = runs scored off the bat (0, 1, 2, 3, 4, or 6).
// The 1 no-ball penalty is always added on top.
function confirmNoBall(batsmanRuns) {
    closeNoBallModal();
    // Total runs credited to the team: 1 (penalty) + batsman runs
    recordBall(1 + batsmanRuns, true, 'noball', batsmanRuns);
}

// ========================================
// WICKET MODAL
// ========================================
async function showWicketModal() {
    const match       = currentScoringMatch;
    const inn         = match.innings[match.current_innings - 1];
    const maxWickets  = inn.maxWickets ?? 10;
    const activeBatsmen = (inn.batsmen || []).filter(b => !b.isOut);

    const wbs = document.getElementById('wicketBatsmanSelect');
    wbs.innerHTML = '<option value="">-- Select --</option>';
    activeBatsmen.forEach(b => wbs.add(new Option(b.name, b.id + '||' + b.name)));

    // Pre-select the striker by default (they're almost always the one out)
    const strikerId = inn.striker;
    const strikerBatsman = activeBatsmen.find(b => b.id === strikerId);
    if (strikerBatsman) wbs.value = strikerId + '||' + strikerBatsman.name;

    // Lock/unlock batsman select based on dismissal type.
    // For Run Out, the scorer must choose who was run out. For all other types
    // (Bowled, Caught, LBW, Stumped, Hit Wicket) the striker is always the one out.
    const wicketTypeEl = document.getElementById('wicketType');
    function _updateBatsmanLock() {
        const isRunOut = wicketTypeEl.value === 'Run Out';
        wbs.disabled = !isRunOut;
        if (!isRunOut && strikerBatsman) {
            wbs.value = strikerId + '||' + strikerBatsman.name;
        }
    }
    wicketTypeEl.onchange = _updateBatsmanLock;
    _updateBatsmanLock(); // apply immediately on open

    const fs = document.getElementById('fielderSelect');
    fs.innerHTML = '<option value="">-- Select Fielder --</option>';
    const { data: fTeam } = await db.from('teams').select('players').eq('id', inn.fieldingTeamId).single();
    fTeam?.players?.forEach(p => fs.add(new Option(p.name, p.name)));

    const newBatsmanGroup = document.getElementById('newBatsmanGroup');
    const nbs             = document.getElementById('newBatsmanSelect');
    const isLastWicket    = (inn.wickets + 1) >= maxWickets;

    const oldNotice = document.getElementById('lastWicketNotice');
    if (oldNotice) oldNotice.remove();

    if (isLastWicket) {
        newBatsmanGroup.classList.add('hidden');
        nbs.removeAttribute('required');
        nbs.innerHTML = '<option value="">N/A - innings ending</option>';

        const notice = document.createElement('p');
        notice.id        = 'lastWicketNotice';
        notice.className = 'last-wicket-notice';
        notice.innerHTML = `<strong>⚡ LAST WICKET</strong> — This is wicket ${inn.wickets + 1}/${maxWickets}. No new batsman needed; innings will be marked all out.`;
        newBatsmanGroup.insertAdjacentElement('beforebegin', notice);
    } else {
        newBatsmanGroup.classList.remove('hidden');
        nbs.setAttribute('required', '');
        nbs.innerHTML = '<option value="">-- Select New Batsman --</option>';
        const { data: bTeam } = await db.from('teams').select('players').eq('id', inn.battingTeamId).single();
        const usedIds = (inn.batsmen || []).map(b => b.id);
        bTeam?.players?.filter(p => !usedIds.includes(p.id)).forEach(p => nbs.add(new Option(p.name, p.id + '||' + p.name)));
    }

    document.getElementById('wicketModal').classList.remove('hidden');
}

function closeWicketModal() {
    document.getElementById('wicketModal').classList.add('hidden');
    document.getElementById('wicketForm').reset();
    // Remove the dynamic lock handler to avoid stale closures on next open
    document.getElementById('wicketType').onchange = null;
    document.getElementById('wicketBatsmanSelect').disabled = false;
}

// ========================================
// HANDLE WICKET
// ========================================
async function handleWicket(e) {
    e.preventDefault();
    const bv         = document.getElementById('wicketBatsmanSelect').value;
    const wicketType = document.getElementById('wicketType').value;
    const fielder    = document.getElementById('fielderSelect').value;
    const nbv        = document.getElementById('newBatsmanSelect').value;

    if (!bv || !wicketType) { showMessage('Please fill in all required fields.'); return; }

    const [outId, outName] = bv.split('||');
    const match      = currentScoringMatch;
    const idx        = match.current_innings - 1;
    const innings    = [...match.innings];
    const inn        = { ...innings[idx] };
    const maxWickets = inn.maxWickets ?? 10;

    if (inn.balls >= match.total_overs * 6) {
        showMessage(`All ${match.total_overs} overs are complete. Click "End Innings" to continue.`);
        closeWicketModal(); return;
    }
    if (inn.allOut) {
        showMessage('Team is already all out. Click "End Innings" to continue.');
        closeWicketModal(); return;
    }

    // FIX 2 & 4: Snapshot the state BEFORE any modification so undo correctly
    // restores to the pre-wicket state (mirrors the same fix in recordBall).
    lastBalls.push({ innings: JSON.parse(JSON.stringify(match.innings)) });

    inn.batsmen = inn.batsmen.map(b => {
        if (b.id === outId) {
            let status = wicketType;
            if ((wicketType === 'Caught' || wicketType === 'Run Out') && fielder) status = `${wicketType} (${fielder})`;
            return { ...b, isOut: true, isStriker: false, status };
        }
        return b;
    });

    inn.wickets = (inn.wickets || 0) + 1;

    const bowlerCredited = ['Bowled', 'Caught', 'LBW', 'Stumped', 'Hit Wicket'];
    if (bowlerCredited.includes(wicketType)) {
        inn.bowlers = inn.bowlers.map(b => b.id === inn.bowler ? { ...b, wickets: (b.wickets||0) + 1 } : b);
    }

    const isAllOut = inn.wickets >= maxWickets;

    if (isAllOut) {
        inn.allOut = true;
        if (outId === inn.striker)    inn.striker    = null;
        else                          inn.nonStriker = null;
    } else if (nbv) {
        const [nid, nname] = nbv.split('||');
        inn.batsmen.push({
            id: nid, name: nname, runs: 0, balls: 0,
            fours: 0, sixes: 0, isOut: false, isStriker: false, status: 'Not Out'
        });
        if (outId === inn.striker)    inn.striker    = nid;
        else                          inn.nonStriker = nid;
    } else {
        showMessage('Please select the new batsman.'); return;
    }

    inn.batsmen  = inn.batsmen.map(b => ({ ...b, isStriker: b.id === inn.striker }));
    inn.balls    = (inn.balls || 0) + 1;
    inn.bowlers  = inn.bowlers.map(b => b.id === inn.bowler ? { ...b, balls: (b.balls||0) + 1 } : b);
    inn.thisOver = [...(inn.thisOver || []), { runs: 0, isWicket: true }];

    // Check if this wicket ball completed an over
    const wicketOverComplete = inn.balls % 6 === 0 && inn.balls > 0;

    innings[idx] = inn;

    const bowlerObj    = inn.bowlers?.find(b => b.id === inn.bowler);
    const allOutSuffix = isAllOut ? ' — ALL OUT!' : '';
    const description  = `${outName} ${wicketType}${fielder ? ' by ' + fielder : ''} — WICKET! b. ${bowlerObj?.name || 'Unknown'}${allOutSuffix}`;

    const { error } = await db.from('matches').update({ innings }).eq('id', match.id);
    if (error) { showMessage('Error recording wicket: ' + error.message); return; }

    await db.from('balls').insert({
        match_id:       match.id,
        type:           'wicket',
        runs:           0,
        is_extra:       false,
        is_wicket:      true,
        wicket_type:    wicketType,
        batsman_out:    outName,
        over_ball:      inn.balls,
        description,
        innings_number: match.current_innings
    });

    currentScoringMatch = { ...match, innings };
    closeWicketModal();

    if (!isAllOut && wicketOverComplete) showEndOfOverPrompt();
    else                                 refreshScoringUI();
}

// ========================================
// RECORD BALL
// ========================================
// batsmanRuns is only used for no-balls:
//   runs        = total runs added to the team score (1 penalty + batsmanRuns)
//   batsmanRuns = runs credited to the individual batsman's scorecard
//   For all other delivery types, batsmanRuns defaults to 0.
async function recordBall(runs, isExtra, extraType, batsmanRuns = 0) {
    const match = currentScoringMatch;
    if (!match) return;

    const idx     = match.current_innings - 1;
    const innings = [...match.innings];
    const inn     = { ...innings[idx] };

    // ── Guards ──────────────────────────────────────────────────
    if (inn.allOut) {
        showMessage('Team is all out. Click "End Innings" to continue.');
        return;
    }
    if (inn.balls >= match.total_overs * 6) {
        showMessage(`All ${match.total_overs} overs are complete. Click "End Innings" to continue.`);
        return;
    }
    if (match.current_innings === 2 && innings.length >= 2 && inn.runs >= innings[0].runs + 1) {
        showMessage('Target already achieved! Click "End Match" to finish.');
        return;
    }

    const striker = inn.batsmen?.find(b => b.id === inn.striker);
    const bowler  = inn.bowlers?.find(b => b.id === inn.bowler);
    if (!striker || !bowler) { showMessage('Please set batsmen and bowler first.'); return; }

    // FIX 2: Snapshot state BEFORE modification so undo restores to pre-ball state.
    lastBalls.push({ innings: JSON.parse(JSON.stringify(match.innings)) });

    const overBall = (!isExtra || (extraType !== 'wide' && extraType !== 'noball'))
        ? inn.balls + 1 : inn.balls;

    // ── Team score ───────────────────────────────────────────────
    inn.runs = (inn.runs || 0) + runs;

    // ── Batsman & ball counts ────────────────────────────────────
    if (!isExtra) {
        // Normal delivery: all runs go to the batsman
        inn.batsmen = inn.batsmen.map(b => b.id === inn.striker
            ? { ...b,
                runs:  (b.runs||0)  + runs,
                balls: (b.balls||0) + 1,
                fours: runs === 4 ? (b.fours||0) + 1 : (b.fours||0),
                sixes: runs === 6 ? (b.sixes||0) + 1 : (b.sixes||0)
              }
            : b);
        inn.balls   = (inn.balls || 0) + 1;
        inn.bowlers = inn.bowlers.map(b => b.id === inn.bowler
            ? { ...b, runs: (b.runs||0) + runs, balls: (b.balls||0) + 1 }
            : b);
    } else {
        // Extra delivery: bowler concedes all runs; ball count only increases for bye/legbye
        inn.bowlers = inn.bowlers.map(b => b.id === inn.bowler
            ? { ...b, runs: (b.runs||0) + runs, extras: (b.extras||0) + 1 }
            : b);
        if (extraType !== 'wide' && extraType !== 'noball') inn.balls = (inn.balls || 0) + 1;

        // No-ball only: credit batsman runs (NOT the 1 penalty run)
        if (extraType === 'noball' && batsmanRuns > 0) {
            inn.batsmen = inn.batsmen.map(b => b.id === inn.striker
                ? { ...b,
                    runs:  (b.runs||0)  + batsmanRuns,
                    fours: batsmanRuns === 4 ? (b.fours||0) + 1 : (b.fours||0),
                    sixes: batsmanRuns === 6 ? (b.sixes||0) + 1 : (b.sixes||0)
                  }
                : b);
        }
    }

    // ── Strike rotation ─────────────────────────────────────────
    // Wides:    the 1-run penalty is automatic — the batsman never ran, so
    //           strike must NEVER rotate regardless of the run value.
    // No-balls: rotate based on batsman runs only (penalty run does not count).
    // All other deliveries: rotate based on total runs.
    const strikeRunsForRotation = (extraType === 'wide')   ? 0 :
                                  (extraType === 'noball') ? batsmanRuns : runs;
    if (strikeRunsForRotation % 2 === 1) {
        const t = inn.striker; inn.striker = inn.nonStriker; inn.nonStriker = t;
    }
    inn.batsmen = inn.batsmen.map(b => ({ ...b, isStriker: b.id === inn.striker }));

    // ── Over complete? ───────────────────────────────────────────
    // No-balls never count toward the over, so overComplete can only be true for !isExtra.
    const overComplete = !isExtra && inn.balls % 6 === 0 && inn.balls > 0;

    // ── Commentary ───────────────────────────────────────────────
    let description = '';
    if (isExtra) {
        if (extraType === 'noball') {
            if (batsmanRuns === 0)
                description = `NO BALL. 1 penalty run. ${striker.name} off ${bowler.name}.`;
            else if (batsmanRuns === 4)
                description = `NO BALL + FOUR! ${striker.name} hits ${bowler.name} for 4. Total: ${runs} runs.`;
            else if (batsmanRuns === 6)
                description = `NO BALL + SIX! ${striker.name} hits ${bowler.name} for 6. Total: ${runs} runs.`;
            else
                description = `NO BALL + ${batsmanRuns} run(s). ${striker.name} off ${bowler.name}. Total: ${runs} runs.`;
        } else {
            description = `${extraType.toUpperCase()} + ${runs} runs`;
        }
    } else if (runs === 0) {
        description = `Dot ball. ${striker.name} to ${bowler.name}`;
    } else if (runs === 4) {
        description = `FOUR! ${striker.name} hits ${bowler.name} for 4`;
    } else if (runs === 6) {
        description = `SIX! ${striker.name} hits ${bowler.name} for 6`;
    } else {
        description = `${runs} run(s). ${striker.name} off ${bowler.name}`;
    }

    // ── End-of-over handling ─────────────────────────────────────
    if (overComplete) {
        const t = inn.striker; inn.striker = inn.nonStriker; inn.nonStriker = t;
        inn.batsmen  = inn.batsmen.map(b => ({ ...b, isStriker: b.id === inn.striker }));
        // Add the 6th delivery to thisOver so it remains visible during bowler selection.
        // thisOver is cleared in confirmBowler() when the new over actually begins.
        inn.thisOver = [...(inn.thisOver || []), {
            runs,
            isWicket:    false,
            extraType:   isExtra ? extraType : null,
            batsmanRuns: extraType === 'noball' ? batsmanRuns : null
        }];
        description += ' [End of Over]';
    } else {
        // Store batsmanRuns in the thisOver entry so renderThisOver can show "Nb+4" etc.
        inn.thisOver = [...(inn.thisOver || []), {
            runs,
            isWicket:   false,
            extraType:  isExtra ? extraType : null,
            batsmanRuns: extraType === 'noball' ? batsmanRuns : null
        }];
    }

    innings[idx] = inn;

    // ── Persist to Supabase ──────────────────────────────────────
    const { error } = await db.from('matches').update({ innings }).eq('id', match.id);
    if (error) { showMessage('Error recording ball: ' + error.message); return; }

    await db.from('balls').insert({
        match_id:       match.id,
        type:           isExtra ? 'extra' : 'normal',
        runs,
        is_extra:       isExtra,
        extra_type:     extraType,
        is_wicket:      false,
        over_ball:      overBall,
        description,
        innings_number: match.current_innings
    });

    currentScoringMatch = { ...match, innings };

    // ── Target reached in 2nd innings? ──────────────────────────
    const targetReached = match.current_innings === 2 && innings.length >= 2 && inn.runs >= innings[0].runs + 1;
    if (targetReached) {
        const maxW = inn.maxWickets ?? 10;
        showMessage(`🎉 TARGET ACHIEVED! ${inn.battingTeamName} wins by ${maxW - inn.wickets} wicket(s)!`);
        refreshScoringUI();
        setTimeout(() => endMatch(), 2000);
        return;
    }

    if (overComplete) showEndOfOverPrompt();
    else              refreshScoringUI();
}

// ========================================
// HANDLE EXTRA (Wide / Bye / Leg Bye)
// ========================================
// No-ball is now handled by showNoBallModal() → confirmNoBall().
// Wide keeps its default 1 run. Bye and leg-bye ask for run count via prompt.
function handleExtra(extraType) {
    if (extraType === 'noball') {
        // Open the no-ball modal so the scorer can specify runs off the bat
        showNoBallModal();
        return;
    }

    let runs = 1;
    if (extraType === 'bye' || extraType === 'legbye') {
        const r = prompt(`Enter runs for ${extraType} (0–6):`, '1');
        if (r === null) return;
        runs = parseInt(r) || 0;
    }
    recordBall(runs, true, extraType);
}

// ========================================
// END INNINGS
// ========================================
async function endInnings() {
    if (!confirm('Are you sure you want to end this innings?')) return;
    const match   = currentScoringMatch;
    const innings = [...match.innings];
    innings[match.current_innings - 1] = { ...innings[match.current_innings - 1], completed: true };

    const { error } = await db.from('matches').update({ innings }).eq('id', match.id);
    if (error) { showMessage('Error ending innings: ' + error.message); return; }
    currentScoringMatch = { ...match, innings };
    showMessage('Innings ended. Click "Start Innings" to begin the second innings.');

    document.getElementById('startInningsBtn').classList.remove('hidden');
    document.getElementById('endInningsBtn').classList.add('hidden');
    document.getElementById('currentPlayers').classList.add('hidden');
    document.getElementById('scoringControls').classList.add('hidden');
    _clearStatusBanners();
}

// ========================================
// END MATCH
// ========================================
async function endMatch() {
    if (!confirm('Are you sure you want to end this match?')) return;
    const match   = currentScoringMatch;
    const innings = match.innings;
    let result = 'Match result pending', manOfTheMatch = null, bestBatsman = null, bestBowler = null;

    if (innings?.length >= 2) {
        const i1 = innings[0], i2 = innings[1];
        if      (i2.runs > i1.runs) result = `${i2.battingTeamName} won by ${(i2.maxWickets ?? 10) - i2.wickets} wicket(s)`;
        else if (i1.runs > i2.runs) result = `${i1.battingTeamName} won by ${i1.runs - i2.runs} run(s)`;
        else                        result = 'Match Tied';

        const grouped = {};
        [...(i1.batsmen||[]), ...(i2.batsmen||[])].forEach(b => {
            if (!grouped[b.name]) grouped[b.name] = { name: b.name, runs: 0, balls: 0 };
            grouped[b.name].runs += b.runs; grouped[b.name].balls += b.balls;
        });
        bestBatsman = Object.values(grouped).sort((a, b) => b.runs - a.runs)[0] || null;

        const groupedB = {};
        [...(i1.bowlers||[]), ...(i2.bowlers||[])].forEach(b => {
            if (!groupedB[b.name]) groupedB[b.name] = { name: b.name, wickets: 0, runs: 0, balls: 0 };
            groupedB[b.name].wickets += b.wickets; groupedB[b.name].runs += b.runs; groupedB[b.name].balls += b.balls;
        });
        bestBowler    = Object.values(groupedB).sort((a, b) => b.wickets !== a.wickets ? b.wickets - a.wickets : (a.runs/(a.balls||1)) - (b.runs/(b.balls||1)))[0] || null;
        manOfTheMatch = bestBatsman;
    }

    const { error } = await db.from('matches').update({
        status:           'completed',
        result,
        man_of_the_match: manOfTheMatch,
        best_batsman:     bestBatsman,
        best_bowler:      bestBowler,
        completed_at:     new Date().toISOString()
    }).eq('id', match.id);

    if (error) { showMessage('Error ending match: ' + error.message); return; }
    currentScoringMatch = null;
    document.getElementById('scoringInterface').classList.add('hidden');
    document.getElementById('scoringMatchSelect').value = '';
    showMessage(`Match ended! Result: ${result}`);
    loadScoringInterface();
}

// ========================================
// UNDO LAST BALL
// ========================================
async function undoLastBall() {
    if (lastBalls.length === 0) { showMessage('Nothing to undo.'); return; }
    if (!confirm('Undo the last recorded ball?')) return;

    const last  = lastBalls.pop();
    const match = currentScoringMatch;

    const { error } = await db.from('matches').update({ innings: last.innings }).eq('id', match.id);
    if (error) { showMessage('Error undoing: ' + error.message); return; }

    // Delete the most recent ball record for this match (works for normal, extra, AND wicket balls)
    const { data } = await db
        .from('balls').select('id').eq('match_id', match.id)
        .order('created_at', { ascending: false }).limit(1);
    if (data?.length) await db.from('balls').delete().eq('id', data[0].id);

    currentScoringMatch = { ...match, innings: last.innings };
    refreshScoringUI();
    showMessage('Last ball undone.');
}