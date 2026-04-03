// ========================================
// SUPABASE CONFIGURATION
// ========================================
const SUPABASE_URL = 'https://vovtrxohcbwrjejywshn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZvdnRyeG9oY2J3cmplanl3c2huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NjQ2OTYsImV4cCI6MjA4NzM0MDY5Nn0.6jXzrcZcxJ8kXvWwfxuRu7LJ2-RwjWpqDfxrCcjKj6U';

var db = null;
try {
    var _createClient = supabase.createClient;
    db = _createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
    console.error('Supabase init failed:', e);
}

// ========================================
// GLOBAL STATE
// ========================================
var currentUser          = null;
var isAdmin              = false;
var currentMatchId       = null;
var openPrevMatchId      = null;
var currentScoringMatch  = null;
var lastBalls            = [];
var commentaryLoaded     = false;

// ── Polling intervals (replace WebSocket realtime) ──────────────
var liveMatchesPollTimer  = null;   // polls live matches list
var matchDetailPollTimer  = null;   // polls current open match detail
var LIVE_POLL_MS          = 8000;   // 8 s for the matches list
var DETAIL_POLL_MS        = 5000;   // 5 s for the open match detail

// ========================================
// INITIALIZATION
// ========================================
document.addEventListener('DOMContentLoaded', function () {
    console.log('VPL Kindle App — Polling mode');

    // ── STEP 1: Wire up all UI buttons immediately ───────────────
    // This MUST happen before any network calls so the hamburger
    // and nav buttons are always responsive, even if Supabase is slow.
    setupEventListeners();

    if (!db) {
        showDbError();
        return;
    }

    // ── STEP 2: Check for existing session ──────────────────────
    db.auth.getSession().then(function (result) {
        var session = result && result.data && result.data.session;
        if (session) {
            currentUser = session.user;
            isAdmin     = true;
            showAdminUI();
            stopPolling();
            loadAllData();
        } else {
            hideAdminUI();
            startLiveMatchesPolling();
        }
    }).catch(function (e) {
        console.error('getSession error:', e);
        hideAdminUI();
        startLiveMatchesPolling();
    });

    // ── STEP 3: Auth state changes ───────────────────────────────
    // Use a simple polling check instead of WebSocket-based onAuthStateChange
    setInterval(function () {
        if (!db) return;
        db.auth.getSession().then(function (result) {
            var session = result && result.data && result.data.session;
            var nowAdmin = !!session;
            if (nowAdmin && !isAdmin) {
                currentUser = session.user;
                isAdmin     = true;
                showAdminUI();
                stopPolling();
                loadAllData();
            } else if (!nowAdmin && isAdmin) {
                currentUser = null;
                isAdmin     = false;
                hideAdminUI();
                startLiveMatchesPolling();
            }
        }).catch(function () {});
    }, 30000); // check auth state every 30 s
});

function showDbError() {
    var container = document.getElementById('liveMatchesList');
    if (container) {
        container.innerHTML = '<p class="no-matches-msg">Database connection failed. Please refresh the page.</p>';
    }
}

// ========================================
// EVENT LISTENERS
// ========================================
function setupEventListeners() {
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { switchTab(this.getAttribute('data-tab')); });
        btn.addEventListener('touchend', function (e) {
            e.preventDefault();
            switchTab(this.getAttribute('data-tab'));
        });
    });

    var mobileToggle = document.getElementById('mobileMenuToggle');
    if (mobileToggle) {
        mobileToggle.addEventListener('click', toggleMobileMenu);
        // Kindle fix: browser has a 300ms tap delay that swallows 'click' events
        // Adding 'touchend' fires immediately on finger-lift and bypasses the delay
        mobileToggle.addEventListener('touchend', function (e) {
            e.preventDefault(); // prevent the ghost click that follows touchend
            toggleMobileMenu();
        });
    }

    var loginBtn  = document.getElementById('loginBtn');
    var logoutBtn = document.getElementById('logoutBtn');
    if (loginBtn)  loginBtn.addEventListener('click', openLoginModal);
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    var closeModalBtn = document.querySelector('.close-modal');
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeLoginModal);

    var loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', handleLogin);

    var addTeamForm   = document.getElementById('addTeamForm');
    var addPlayerForm = document.getElementById('addPlayerForm');
    var addMatchForm  = document.getElementById('addMatchForm');
    if (addTeamForm)   addTeamForm.addEventListener('submit', handleAddTeam);
    if (addPlayerForm) addPlayerForm.addEventListener('submit', handleAddPlayer);
    if (addMatchForm)  addMatchForm.addEventListener('submit', handleAddMatch);

    var scoringMatchSel = document.getElementById('scoringMatchSelect');
    if (scoringMatchSel) scoringMatchSel.addEventListener('change', handleScoringMatchSelect);

    var confirmTossBtn    = document.getElementById('confirmTossBtn');
    var startInningsBtn   = document.getElementById('startInningsBtn');
    var endInningsBtn     = document.getElementById('endInningsBtn');
    var endMatchBtn       = document.getElementById('endMatchBtn');
    var confirmBatsmenBtn = document.getElementById('confirmBatsmenBtn');
    var confirmBowlerBtn  = document.getElementById('confirmBowlerBtn');
    var strikeChangeBtn   = document.getElementById('strikeChangeBtn');
    var changeBowlerBtn   = document.getElementById('changeBowlerBtn');
    var wicketBtn         = document.getElementById('wicketBtn');
    var cancelWicketBtn   = document.getElementById('cancelWicketBtn');
    var wicketForm        = document.getElementById('wicketForm');
    var undoBtn           = document.getElementById('undoBtn');
    var cancelNoBallBtn   = document.getElementById('cancelNoBallBtn');
    var commentaryBtn     = document.getElementById('loadCommentaryBtn');

    if (confirmTossBtn)    confirmTossBtn.addEventListener('click', confirmToss);
    if (startInningsBtn)   startInningsBtn.addEventListener('click', startInnings);
    if (endInningsBtn)     endInningsBtn.addEventListener('click', endInnings);
    if (endMatchBtn)       endMatchBtn.addEventListener('click', endMatch);
    if (confirmBatsmenBtn) confirmBatsmenBtn.addEventListener('click', confirmBatsmen);
    if (confirmBowlerBtn)  confirmBowlerBtn.addEventListener('click', confirmBowler);
    if (strikeChangeBtn)   strikeChangeBtn.addEventListener('click', changeStrike);
    if (changeBowlerBtn)   changeBowlerBtn.addEventListener('click', showChangeBowler);
    if (wicketBtn)         wicketBtn.addEventListener('click', showWicketModal);
    if (cancelWicketBtn)   cancelWicketBtn.addEventListener('click', closeWicketModal);
    if (wicketForm)        wicketForm.addEventListener('submit', handleWicket);
    if (undoBtn)           undoBtn.addEventListener('click', undoLastBall);
    if (cancelNoBallBtn)   cancelNoBallBtn.addEventListener('click', closeNoBallModal);
    if (commentaryBtn)     commentaryBtn.addEventListener('click', toggleCommentary);

    document.querySelectorAll('.nb-run-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            confirmNoBall(parseInt(this.getAttribute('data-nbr')));
        });
    });

    document.querySelectorAll('.run-btn:not(.nb-run-btn)').forEach(function (btn) {
        btn.addEventListener('click', function () {
            recordBall(parseInt(this.getAttribute('data-runs')), false, null);
        });
    });

    document.querySelectorAll('.extra-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { handleExtra(this.getAttribute('data-extra')); });
    });

    window.addEventListener('click', function (e) {
        if (e.target === document.getElementById('loginModal'))  closeLoginModal();
        if (e.target === document.getElementById('wicketModal')) closeWicketModal();
        if (e.target === document.getElementById('noBallModal')) closeNoBallModal();
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
    document.querySelectorAll('.tab-content').forEach(function (t) { t.classList.remove('active'); });
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); });

    var tab = document.getElementById(tabName + 'Tab');
    if (tab) tab.classList.add('active');

    var btn = document.querySelector('[data-tab="' + tabName + '"]');
    if (btn) btn.classList.add('active');

    document.getElementById('mainNav').classList.remove('mobile-open');
    document.getElementById('mobileMenuToggle').classList.remove('active');

    // Stop per-match polling when leaving live tab
    if (tabName !== 'live') {
        stopMatchDetailPolling();
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
    var loginBtn  = document.getElementById('loginBtn');
    var logoutBtn = document.getElementById('logoutBtn');
    if (loginBtn)  loginBtn.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    document.querySelectorAll('.admin-only').forEach(function (el) { el.classList.remove('hidden'); });
    var ind = document.getElementById('refreshIndicator');
    if (ind) ind.classList.add('hidden');
}

function hideAdminUI() {
    var loginBtn  = document.getElementById('loginBtn');
    var logoutBtn = document.getElementById('logoutBtn');
    if (loginBtn)  loginBtn.classList.remove('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    document.querySelectorAll('.admin-only').forEach(function (el) { el.classList.add('hidden'); });
    var ind = document.getElementById('refreshIndicator');
    if (ind) { ind.innerHTML = '🟢 Live'; ind.classList.remove('hidden'); }
}

function openLoginModal()  { document.getElementById('loginModal').classList.remove('hidden'); }
function closeLoginModal() {
    document.getElementById('loginModal').classList.add('hidden');
    var form = document.getElementById('loginForm');
    if (form) form.reset();
    var msg = document.getElementById('loginMessage');
    if (msg) msg.textContent = '';
}

// ========================================
// AUTH
// ========================================
function handleLogin(e) {
    e.preventDefault();
    var email     = document.getElementById('loginEmail').value;
    var password  = document.getElementById('loginPassword').value;
    var messageEl = document.getElementById('loginMessage');

    db.auth.signInWithPassword({ email: email, password: password }).then(function (result) {
        if (result.error) {
            messageEl.className   = 'form-message form-message--error';
            messageEl.textContent = 'Login failed: ' + result.error.message;
        } else {
            messageEl.className   = 'form-message form-message--success';
            messageEl.textContent = 'Login successful!';
            setTimeout(closeLoginModal, 1000);
        }
    }).catch(function (e) {
        messageEl.className   = 'form-message form-message--error';
        messageEl.textContent = 'Login error: ' + e.message;
    });
}

function logout() {
    stopPolling();
    db.auth.signOut().then(function () {
        currentUser = null;
        isAdmin     = false;
        hideAdminUI();
        switchTab('live');
        startLiveMatchesPolling();
        alert('Logged out successfully.');
    }).catch(function (e) {
        console.error('Logout error:', e);
    });
}

// ========================================
// POLLING (replaces WebSocket Realtime)
// ========================================
function startLiveMatchesPolling() {
    stopPolling();
    _fetchAndRenderLiveMatches(); // immediate first load
    liveMatchesPollTimer = setInterval(_fetchAndRenderLiveMatches, LIVE_POLL_MS);
}

function startMatchDetailPolling(matchId) {
    stopMatchDetailPolling();
    matchDetailPollTimer = setInterval(function () {
        if (!matchId) return;
        db.from('matches').select('*').eq('id', matchId).single()
            .then(function (result) {
                if (result.data) renderMatchDetails(result.data, matchId);
            }).catch(function () {});
    }, DETAIL_POLL_MS);
}

function stopMatchDetailPolling() {
    if (matchDetailPollTimer) { clearInterval(matchDetailPollTimer); matchDetailPollTimer = null; }
}

function stopPolling() {
    if (liveMatchesPollTimer)  { clearInterval(liveMatchesPollTimer);  liveMatchesPollTimer  = null; }
    stopMatchDetailPolling();
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

function loadLiveMatchesOnce() {
    if (!isAdmin) {
        startLiveMatchesPolling();
        return;
    }
    _fetchAndRenderLiveMatches();
}

function _fetchAndRenderLiveMatches() {
    if (!db) {
        var c = document.getElementById('liveMatchesList');
        if (c) c.innerHTML = '<p class="no-matches-msg">Database not connected. Please refresh the page.</p>';
        return;
    }
    // Show a loading message so Kindle users know the page is working
    var container = document.getElementById('liveMatchesList');
    if (container && container.innerHTML.trim() === '') {
        container.innerHTML = '<p class="no-matches-msg">Loading matches...</p>';
    }
    db.from('matches').select('*').in('status', ['live', 'upcoming']).order('date_time', { ascending: true })
        .then(function (result) {
            if (result.error) {
                console.error('Error loading live matches:', result.error);
                var cont = document.getElementById('liveMatchesList');
                if (cont) cont.innerHTML = '<p class="no-matches-msg">Error loading matches: ' + result.error.message + '</p>';
                return;
            }
            renderLiveMatchesList(result.data || []);
        }).catch(function (e) {
            console.error('Fetch error:', e);
            var cont = document.getElementById('liveMatchesList');
            if (cont) cont.innerHTML = '<p class="no-matches-msg">Connection error. Check your internet and refresh.</p>';
        });
}

// ========================================
// UTILITY FUNCTIONS
// ========================================
function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
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
    return Math.floor(balls / 6) + '.' + (balls % 6);
}

function showMessage(msg) { alert(msg); }

// ========================================
// TEAM MANAGEMENT
// ========================================
function handleAddTeam(e) {
    e.preventDefault();
    var name       = document.getElementById('teamName').value.trim();
    var short_name = document.getElementById('teamShortName').value.trim().toUpperCase();

    db.from('teams').insert({ name: name, short_name: short_name, players: [] })
        .then(function (result) {
            if (result.error) { showMessage('Error adding team: ' + result.error.message); return; }
            showMessage('Team added successfully!');
            document.getElementById('addTeamForm').reset();
            loadTeamsManagement();
        }).catch(function (e) { showMessage('Error: ' + e.message); });
}

function handleAddPlayer(e) {
    e.preventDefault();
    var teamId     = document.getElementById('playerTeamSelect').value;
    var playerName = document.getElementById('playerName').value.trim();

    db.from('teams').select('players').eq('id', teamId).single()
        .then(function (result) {
            if (result.error) { showMessage('Error fetching team: ' + result.error.message); return; }
            var updatedPlayers = (result.data.players || []).concat([{ id: Date.now().toString(), name: playerName }]);
            return db.from('teams').update({ players: updatedPlayers }).eq('id', teamId)
                .then(function (r2) {
                    if (r2.error) { showMessage('Error adding player: ' + r2.error.message); return; }
                    showMessage('Player added successfully!');
                    document.getElementById('playerName').value = '';
                    loadTeamsManagement().then(function () {
                        var sel = document.getElementById('playerTeamSelect');
                        if (sel) sel.value = teamId;
                    });
                });
        }).catch(function (e) { showMessage('Error: ' + e.message); });
}

function loadTeamsManagement() {
    return db.from('teams').select('*').order('name')
        .then(function (result) {
            if (result.error) { console.error('Error loading teams:', result.error); return; }
            var teams = result.data || [];

            var playerTeamSel = document.getElementById('playerTeamSelect');
            var matchTeam1Sel = document.getElementById('matchTeam1');
            var matchTeam2Sel = document.getElementById('matchTeam2');

            var prevTeamId = playerTeamSel.value;
            playerTeamSel.innerHTML = '<option value="">-- Select Team --</option>';
            matchTeam1Sel.innerHTML = '<option value="">-- Select Team 1 --</option>';
            matchTeam2Sel.innerHTML = '<option value="">-- Select Team 2 --</option>';

            var teamsList = document.getElementById('teamsList');
            teamsList.innerHTML = '';

            teams.forEach(function (team) {
                playerTeamSel.add(new Option(team.name, team.id));
                matchTeam1Sel.add(new Option(team.name, team.id));
                matchTeam2Sel.add(new Option(team.name, team.id));

                var item = document.createElement('div');
                item.className = 'team-item';
                var playersHtml = team.players && team.players.length
                    ? team.players.map(function (p) { return '<div class="player-name">• ' + p.name + '</div>'; }).join('')
                    : '<div class="player-name">No players added yet</div>';
                item.innerHTML = '<h4>' + team.name + ' (' + team.short_name + ')</h4><div class="players-list"><strong>Players:</strong>' + playersHtml + '</div>';
                teamsList.appendChild(item);
            });

            if (prevTeamId) playerTeamSel.value = prevTeamId;
        }).catch(function (e) { console.error('Teams error:', e); });
}

// ========================================
// PUBLIC TEAMS VIEW
// ========================================
function loadPublicTeams() {
    var publicTeamsList = document.getElementById('publicTeamsList');
    if (!publicTeamsList) return;
    publicTeamsList.innerHTML = '';

    db.from('teams').select('*').order('name')
        .then(function (result) {
            if (result.error) {
                publicTeamsList.innerHTML = '<div class="no-teams-message"><h3>Error Loading Teams</h3><p>' + result.error.message + '</p></div>';
                return;
            }
            var teams = result.data || [];
            if (!teams.length) {
                publicTeamsList.innerHTML = '<div class="no-teams-message"><h3>No Teams Yet</h3><p>Teams will appear here once created.</p></div>';
                return;
            }
            teams.forEach(function (team) {
                var card = document.createElement('div');
                card.className = 'public-team-card';
                var playersHTML = team.players && team.players.length
                    ? team.players.map(function (p) { return '<div class="public-player-item"><span class="public-player-name">' + p.name + '</span></div>'; }).join('')
                    : '<div class="public-player-item"><span class="public-player-name">No players yet</span></div>';
                card.innerHTML =
                    '<div class="public-team-header"><div class="public-team-name">' + team.name + '</div><div class="public-team-short">' + team.short_name + '</div></div>' +
                    '<div class="public-players-section"><h4>Squad (' + (team.players ? team.players.length : 0) + ' players)</h4><div class="public-player-list">' + playersHTML + '</div></div>';
                publicTeamsList.appendChild(card);
            });
        }).catch(function (e) { console.error('Public teams error:', e); });
}

// ========================================
// MATCH MANAGEMENT
// ========================================
function handleAddMatch(e) {
    e.preventDefault();
    var team1Id    = document.getElementById('matchTeam1').value;
    var team2Id    = document.getElementById('matchTeam2').value;
    var totalOvers = parseInt(document.getElementById('matchOvers').value);
    var dateTime   = document.getElementById('matchDateTime').value;
    var venue      = document.getElementById('matchVenue').value.trim();

    if (team1Id === team2Id) { showMessage('Please select different teams!'); return; }

    db.from('teams').select('*').in('id', [team1Id, team2Id])
        .then(function (result) {
            if (result.error) { showMessage('Error fetching teams: ' + result.error.message); return; }
            var teams = result.data || [];
            var team1 = teams.find(function (t) { return t.id === team1Id; });
            var team2 = teams.find(function (t) { return t.id === team2Id; });

            return db.from('matches').insert({
                team1:           { id: team1.id, name: team1.name, shortName: team1.short_name },
                team2:           { id: team2.id, name: team2.name, shortName: team2.short_name },
                total_overs:     totalOvers,
                date_time:       new Date(dateTime).toISOString(),
                venue:           venue,
                status:          'upcoming',
                current_innings: 0,
                innings:         []
            }).then(function (r2) {
                if (r2.error) { showMessage('Error creating match: ' + r2.error.message); return; }
                showMessage('Match created successfully!');
                document.getElementById('addMatchForm').reset();
                loadMatchesManagement();
            });
        }).catch(function (e) { showMessage('Error: ' + e.message); });
}

function loadMatchesManagement() {
    db.from('matches').select('*').order('date_time', { ascending: false })
        .then(function (result) {
            if (result.error) { console.error('Error loading matches:', result.error); return; }
            var matches = result.data || [];
            var list = document.getElementById('matchesList');
            list.innerHTML = '';
            if (!matches.length) { list.innerHTML = '<p>No matches created yet</p>'; return; }
            matches.forEach(function (m) {
                var item = document.createElement('div');
                item.className = 'match-item';
                var badge = m.status === 'live'      ? '<span class="match-status live">LIVE</span>' :
                            m.status === 'completed' ? '<span class="match-status completed">COMPLETED</span>' :
                                                       '<span class="match-status upcoming">UPCOMING</span>';
                item.innerHTML = '<h4>' + m.team1.name + ' vs ' + m.team2.name + '</h4>' + badge +
                    '<p><strong>Venue:</strong> ' + m.venue + '</p>' +
                    '<p><strong>Date:</strong> ' + formatDate(m.date_time) + '</p>' +
                    '<p><strong>Overs:</strong> ' + m.total_overs + '</p>';
                list.appendChild(item);
            });
        }).catch(function (e) { console.error('Matches error:', e); });
}

// ========================================
// LIVE MATCHES LIST
// ========================================
function renderLiveMatchesList(matches) {
    var container = document.getElementById('liveMatchesList');
    var details   = document.getElementById('matchDetails');

    if (container.contains(details)) container.parentNode.appendChild(details);
    container.innerHTML = '';

    if (!matches.length) {
        container.innerHTML = '<p class="no-matches-msg">No live or upcoming matches</p>';
        return;
    }

    matches.forEach(function (m) {
        var card = document.createElement('div');
        card.className = 'match-card ' + (m.status === 'live' ? 'live' : '');
        // Use setAttribute instead of dataset for older Kindle browser compatibility
        card.setAttribute('data-match-id', m.id);

        if (m.id === currentMatchId && !details.classList.contains('hidden')) {
            card.classList.add('match-card--open');
        }

        (function (matchId, cardEl) {
            card.onclick = function () { _toggleLiveDetails(matchId, cardEl); };
            // Kindle fix: add touchend as fallback for tap events
            card.addEventListener('touchend', function (e) {
                e.preventDefault();
                _toggleLiveDetails(matchId, cardEl);
            });
        })(m.id, card);

        var badge = m.status === 'live'
            ? '<span class="match-status live">LIVE</span>'
            : '<span class="match-status upcoming">UPCOMING</span>';

        var t1Score = '-', t2Score = '-';
        if (m.innings && m.innings.length > 0) {
            var i1 = m.innings[0];
            t1Score = i1.runs + '/' + i1.wickets + ' (' + formatOvers(i1.balls) + ')';
            if (m.innings.length > 1) {
                var i2 = m.innings[1];
                t2Score = i2.runs + '/' + i2.wickets + ' (' + formatOvers(i2.balls) + ')';
            }
        }

        card.innerHTML = badge +
            '<h4>' + m.team1.name + ' vs ' + m.team2.name + '</h4>' +
            '<div class="team-row"><span class="team-name">' + m.team1.shortName + '</span><span class="team-score">' + t1Score + '</span></div>' +
            '<div class="team-row"><span class="team-name">' + m.team2.shortName + '</span><span class="team-score">' + t2Score + '</span></div>' +
            '<p class="match-venue">' + m.venue + '</p>';
        container.appendChild(card);
    });

    if (currentMatchId && !details.classList.contains('hidden')) {
        var openCard = container.querySelector('[data-match-id="' + currentMatchId + '"]');
        if (openCard) openCard.insertAdjacentElement('afterend', details);
    }
}

function _toggleLiveDetails(matchId, cardEl) {
    var details   = document.getElementById('matchDetails');
    var container = document.getElementById('liveMatchesList');

    if (currentMatchId === matchId && !details.classList.contains('hidden')) {
        details.classList.add('hidden');
        container.parentNode.appendChild(details);
        stopMatchDetailPolling();
        currentMatchId = null;
        container.querySelectorAll('.match-card--open').forEach(function (c) { c.classList.remove('match-card--open'); });
        return;
    }

    container.querySelectorAll('.match-card--open').forEach(function (c) { c.classList.remove('match-card--open'); });
    cardEl.classList.add('match-card--open');
    cardEl.insertAdjacentElement('afterend', details);
    details.classList.remove('hidden');
    showMatchDetails(matchId);
}

// ========================================
// MATCH DETAIL VIEW (live tab)
// ========================================
function showMatchDetails(matchId) {
    currentMatchId   = matchId;
    commentaryLoaded = false;

    var commentaryBtn  = document.getElementById('loadCommentaryBtn');
    var commentaryList = document.getElementById('ballCommentary');
    if (commentaryList) { commentaryList.innerHTML = ''; commentaryList.classList.add('hidden'); }
    if (commentaryBtn)  commentaryBtn.textContent = 'Show Commentary ▼';

    // Initial load
    db.from('matches').select('*').eq('id', matchId).single()
        .then(function (result) {
            if (result.error || !result.data) { showMessage('Match not found'); return; }
            renderMatchDetails(result.data, matchId);
        }).catch(function (e) { console.error('Match detail error:', e); });

    // Start polling for this match (replaces WebSocket subscription)
    startMatchDetailPolling(matchId);
}

function renderMatchDetails(match, matchId) {
    document.getElementById('matchDetails').classList.remove('hidden');
    document.getElementById('matchTitle').textContent = match.team1.name + ' vs ' + match.team2.name;

    var statusEl = document.getElementById('matchStatus');
    statusEl.textContent = match.status.toUpperCase();
    statusEl.className   = 'match-status ' + match.status;

    if (match.innings && match.innings.length > 0) {
        var i1 = match.innings[0];
        document.getElementById('team1Name').textContent  = i1.battingTeamName || match.team1.name;
        document.getElementById('team1Score').textContent = i1.runs + '/' + i1.wickets;
        document.getElementById('team1Overs').textContent = '(' + formatOvers(i1.balls) + ' ov)';
        if (match.innings.length > 1) {
            var i2 = match.innings[1];
            document.getElementById('team2Name').textContent  = i2.battingTeamName || match.team2.name;
            document.getElementById('team2Score').textContent = i2.runs + '/' + i2.wickets;
            document.getElementById('team2Overs').textContent = '(' + formatOvers(i2.balls) + ' ov)';
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
    var el = document.getElementById('partnershipDetails');
    if (!match.innings || match.current_innings === 0) { el.innerHTML = ''; return; }
    var inn = match.innings[match.current_innings - 1];
    if (!inn) { el.innerHTML = ''; return; }
    var striker    = inn.batsmen && inn.batsmen.find(function (b) { return b.id === inn.striker; });
    var nonStriker = inn.batsmen && inn.batsmen.find(function (b) { return b.id === inn.nonStriker; });
    el.innerHTML = (striker && nonStriker)
        ? '<span>' + striker.name + '* ' + striker.runs + '(' + striker.balls + ')</span> &nbsp;|&nbsp; <span>' + nonStriker.name + ' ' + nonStriker.runs + '(' + nonStriker.balls + ')</span>'
        : '';
}

// ========================================
// COMMENTARY (lazy load)
// ========================================
function toggleCommentary() {
    var list = document.getElementById('ballCommentary');
    var btn  = document.getElementById('loadCommentaryBtn');
    if (list.classList.contains('hidden')) {
        list.classList.remove('hidden');
        btn.textContent = 'Hide Commentary ▲';
        if (!commentaryLoaded && currentMatchId) loadBallCommentary(currentMatchId);
    } else {
        list.classList.add('hidden');
        btn.textContent = 'Show Commentary ▼';
    }
}

function loadBallCommentary(matchId) {
    db.from('balls').select('*').eq('match_id', matchId).order('created_at', { ascending: false }).limit(20)
        .then(function (result) {
            var list = document.getElementById('ballCommentary');
            list.innerHTML = '';
            commentaryLoaded = true;
            if (result.error || !result.data || !result.data.length) {
                list.innerHTML = '<p>No balls bowled yet</p>'; return;
            }
            result.data.forEach(function (ball) {
                var item = document.createElement('div');
                item.className = 'commentary-item';
                item.innerHTML = '<div class="ball-info">' + formatOvers(ball.over_ball) + '</div><div class="ball-desc">' + ball.description + '</div>';
                list.appendChild(item);
            });
        }).catch(function (e) { console.error('Commentary error:', e); });
}

// ========================================
// SCORECARDS
// ========================================
function loadBattingScorecard(match) {
    var body = document.getElementById('battingTableBody');
    body.innerHTML = '';
    if (!match.innings || !match.innings.length) {
        body.innerHTML = '<tr><td colspan="7" class="no-data-cell">No batting data yet</td></tr>'; return;
    }
    var inn = match.innings[match.current_innings - 1] || match.innings[match.innings.length - 1];
    if (!inn || !inn.batsmen || !inn.batsmen.length) {
        body.innerHTML = '<tr><td colspan="7" class="no-data-cell">No batting data yet</td></tr>'; return;
    }
    inn.batsmen.forEach(function (b) {
        var row = document.createElement('tr');
        if (b.isStriker) row.classList.add('striker');
        row.innerHTML = '<td>' + b.name + '</td><td>' + b.runs + '</td><td>' + b.balls + '</td><td>' + (b.fours || 0) + '</td><td>' + (b.sixes || 0) + '</td><td>' + calculateStrikeRate(b.runs, b.balls) + '</td><td>' + (b.status || (b.isOut ? 'Out' : 'Not Out')) + '</td>';
        body.appendChild(row);
    });
}

function loadBowlingScorecard(match) {
    var body = document.getElementById('bowlingTableBody');
    body.innerHTML = '';
    if (!match.innings || !match.innings.length) {
        body.innerHTML = '<tr><td colspan="7" class="no-data-cell">No bowling data yet</td></tr>'; return;
    }
    var inn = match.innings[match.current_innings - 1] || match.innings[match.innings.length - 1];
    if (!inn || !inn.bowlers || !inn.bowlers.length) {
        body.innerHTML = '<tr><td colspan="7" class="no-data-cell">No bowling data yet</td></tr>'; return;
    }
    inn.bowlers.forEach(function (b) {
        var row = document.createElement('tr');
        row.innerHTML = '<td>' + b.name + '</td><td>' + formatOvers(b.balls) + '</td><td>' + (b.maidens || 0) + '</td><td>' + b.runs + '</td><td>' + b.wickets + '</td><td>' + (b.extras || 0) + '</td><td>' + calculateEconomy(b.runs, b.balls) + '</td>';
        body.appendChild(row);
    });
}

// ========================================
// POINTS TABLE
// ========================================
function loadPointsTable() {
    Promise.all([
        db.from('teams').select('*'),
        db.from('matches').select('*').eq('status', 'completed')
    ]).then(function (results) {
        var teams   = results[0].data || [];
        var matches = results[1].data || [];

        var pts = {};
        teams.forEach(function (t) {
            pts[t.id] = { name: t.name, played: 0, won: 0, lost: 0, tied: 0, points: 0, totalRunsScored: 0, totalBallsFaced: 0, totalRunsConceded: 0, totalBallsBowled: 0, nrr: 0 };
        });

        matches.forEach(function (m) {
            if (!m.innings || m.innings.length < 2) return;
            var i1 = m.innings[0], i2 = m.innings[1];
            var t1 = m.team1.id, t2 = m.team2.id;
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
                if (m.result.indexOf('Tied') !== -1 || m.result.indexOf('tied') !== -1) {
                    pts[t1].tied++; pts[t2].tied++; pts[t1].points++; pts[t2].points++;
                } else if (m.result.indexOf(m.team1.name) !== -1) {
                    pts[t1].won++; pts[t2].lost++; pts[t1].points += 2;
                } else if (m.result.indexOf(m.team2.name) !== -1) {
                    pts[t2].won++; pts[t1].lost++; pts[t2].points += 2;
                }
            }
        });

        Object.values(pts).forEach(function (t) {
            if (t.played > 0) {
                var rrFor     = t.totalBallsFaced  > 0 ? t.totalRunsScored   / (t.totalBallsFaced  / 6) : 0;
                var rrAgainst = t.totalBallsBowled > 0 ? t.totalRunsConceded / (t.totalBallsBowled / 6) : 0;
                t.nrr = rrFor - rrAgainst;
            }
        });

        var sorted = Object.values(pts).sort(function (a, b) { return b.points - a.points || b.nrr - a.nrr; });
        var body = document.getElementById('pointsTableBody');
        body.innerHTML = '';
        sorted.forEach(function (t, i) {
            var row = document.createElement('tr');
            row.innerHTML = '<td>' + (i + 1) + '</td><td>' + t.name + '</td><td>' + t.played + '</td><td>' + t.won + '</td><td>' + t.lost + '</td><td>' + t.tied + '</td><td>' + t.nrr.toFixed(3) + '</td><td><strong>' + t.points + '</strong></td>';
            body.appendChild(row);
        });
    }).catch(function (e) { console.error('Points table error:', e); });
}

// ========================================
// PREVIOUS MATCHES
// ========================================
function loadPreviousMatches() {
    db.from('matches').select('*').eq('status', 'completed').order('completed_at', { ascending: false })
        .then(function (result) {
            if (result.error) { console.error(result.error); return; }
            var matches = result.data || [];
            var list    = document.getElementById('previousMatchesList');
            var details = document.getElementById('previousMatchDetails');

            if (list.contains(details)) list.parentNode.appendChild(details);
            list.innerHTML = '';
            openPrevMatchId = null;
            details.classList.add('hidden');

            if (!matches.length) {
                list.innerHTML = '<p class="no-matches-msg">No completed matches yet</p>'; return;
            }

            matches.forEach(function (m) {
                var card = document.createElement('div');
                card.className = 'match-card';
                card.dataset.matchId = m.id;

                var t1Score = '-', t2Score = '-';
                if (m.innings && m.innings.length > 0) {
                    var i1 = m.innings[0];
                    t1Score = i1.runs + '/' + i1.wickets + ' (' + formatOvers(i1.balls) + ')';
                    if (m.innings.length > 1) {
                        var i2 = m.innings[1];
                        t2Score = i2.runs + '/' + i2.wickets + ' (' + formatOvers(i2.balls) + ')';
                    }
                }

                (function (matchId, cardEl) {
                    card.onclick = function () { _togglePrevDetails(matchId, cardEl); };
                })(m.id, card);

                card.innerHTML =
                    '<span class="match-status completed">COMPLETED</span>' +
                    '<h4>' + m.team1.name + ' vs ' + m.team2.name + '</h4>' +
                    '<div class="team-row"><span class="team-name">' + m.team1.shortName + '</span><span class="team-score">' + t1Score + '</span></div>' +
                    '<div class="team-row"><span class="team-name">' + m.team2.shortName + '</span><span class="team-score">' + t2Score + '</span></div>' +
                    '<p class="match-result-text">' + (m.result || 'Result pending') + '</p>';
                list.appendChild(card);
            });
        }).catch(function (e) { console.error('Previous matches error:', e); });
}

function _togglePrevDetails(matchId, cardEl) {
    var details = document.getElementById('previousMatchDetails');
    var list    = document.getElementById('previousMatchesList');

    if (openPrevMatchId === matchId && !details.classList.contains('hidden')) {
        details.classList.add('hidden');
        list.parentNode.appendChild(details);
        openPrevMatchId = null;
        list.querySelectorAll('.match-card--open').forEach(function (c) { c.classList.remove('match-card--open'); });
        return;
    }

    list.querySelectorAll('.match-card--open').forEach(function (c) { c.classList.remove('match-card--open'); });
    cardEl.classList.add('match-card--open');
    openPrevMatchId = matchId;
    cardEl.insertAdjacentElement('afterend', details);
    details.classList.remove('hidden');
    showPreviousMatchDetails(matchId);
}

function showPreviousMatchDetails(matchId) {
    db.from('matches').select('*').eq('id', matchId).single()
        .then(function (result) {
            if (result.error || !result.data) { showMessage('Match not found'); return; }
            var m = result.data;
            document.getElementById('previousMatchDetails').classList.remove('hidden');
            document.getElementById('prevMatchTitle').textContent  = m.team1.name + ' vs ' + m.team2.name;
            document.getElementById('prevMatchResult').textContent = m.result || 'Result pending';
            document.getElementById('prevMotm').textContent        = m.man_of_the_match ? m.man_of_the_match.name : '-';
            document.getElementById('prevBestBat').textContent     = m.best_batsman  ? m.best_batsman.name  + ' (' + m.best_batsman.runs  + ')' : '-';
            document.getElementById('prevBestBowl').textContent    = m.best_bowler   ? m.best_bowler.name   + ' (' + m.best_bowler.wickets + '/' + m.best_bowler.runs + ')' : '-';

            if (m.innings && m.innings.length >= 2) {
                var i1 = m.innings[0], i2 = m.innings[1];
                document.getElementById('prevTeam1Name').textContent  = i1.battingTeamName;
                document.getElementById('prevTeam1Score').textContent = i1.runs + '/' + i1.wickets;
                document.getElementById('prevTeam1Overs').textContent = '(' + formatOvers(i1.balls) + ' ov)';
                document.getElementById('prevTeam2Name').textContent  = i2.battingTeamName;
                document.getElementById('prevTeam2Score').textContent = i2.runs + '/' + i2.wickets;
                document.getElementById('prevTeam2Overs').textContent = '(' + formatOvers(i2.balls) + ' ov)';
                loadPreviousInningsScorecard(i1, 1);
                loadPreviousInningsScorecard(i2, 2);
                loadPreviousMatchCommentary(matchId);
            }
        }).catch(function (e) { console.error('Prev match detail error:', e); });
}

function loadPreviousInningsScorecard(innings, num) {
    var battingBody  = document.getElementById('prevInnings' + num + 'BattingBody');
    var bowlingBody  = document.getElementById('prevInnings' + num + 'BowlingBody');
    battingBody.innerHTML = '';
    bowlingBody.innerHTML = '';

    if (innings.batsmen && innings.batsmen.length) {
        innings.batsmen.forEach(function (b) {
            var row = document.createElement('tr');
            row.innerHTML = '<td>' + b.name + '</td><td>' + b.runs + '</td><td>' + b.balls + '</td><td>' + (b.fours || 0) + '</td><td>' + (b.sixes || 0) + '</td><td>' + calculateStrikeRate(b.runs, b.balls) + '</td><td>' + (b.status || (b.isOut ? 'Out' : 'Not Out')) + '</td>';
            battingBody.appendChild(row);
        });
    } else {
        battingBody.innerHTML = '<tr><td colspan="7" class="no-data-cell">No data</td></tr>';
    }

    if (innings.bowlers && innings.bowlers.length) {
        innings.bowlers.forEach(function (b) {
            var row = document.createElement('tr');
            row.innerHTML = '<td>' + b.name + '</td><td>' + formatOvers(b.balls) + '</td><td>' + (b.maidens || 0) + '</td><td>' + b.runs + '</td><td>' + b.wickets + '</td><td>' + (b.extras || 0) + '</td><td>' + calculateEconomy(b.runs, b.balls) + '</td>';
            bowlingBody.appendChild(row);
        });
    } else {
        bowlingBody.innerHTML = '<tr><td colspan="7" class="no-data-cell">No data</td></tr>';
    }
}

function loadPreviousMatchCommentary(matchId) {
    db.from('balls').select('*').eq('match_id', matchId).order('innings_number', { ascending: true }).order('created_at', { ascending: true })
        .then(function (result) {
            [1, 2].forEach(function (num) {
                var container = document.getElementById('prevInnings' + num + 'Commentary');
                if (!container) return;
                container.innerHTML = '';
                if (result.error || !result.data || !result.data.length) {
                    container.innerHTML = '<p class="no-data-cell">No ball data recorded</p>'; return;
                }
                var inningsBalls = result.data.filter(function (b) { return b.innings_number === num; });
                if (!inningsBalls.length) {
                    container.innerHTML = '<p class="no-data-cell">No balls recorded for this innings</p>'; return;
                }
                inningsBalls.forEach(function (ball) {
                    var item = document.createElement('div');
                    item.className = 'commentary-item';
                    item.innerHTML = '<div class="ball-info">' + formatOvers(ball.over_ball) + '</div><div class="ball-desc">' + ball.description + '</div>';
                    container.appendChild(item);
                });
            });
        }).catch(function (e) { console.error('Commentary error:', e); });
}

// ========================================
// STATS & RANKINGS
// ========================================
function loadStats() {
    db.from('matches').select('*').eq('status', 'completed')
        .then(function (result) {
            var matches     = result.data || [];
            var playerStats = {};

            matches.forEach(function (m) {
                if (!m.innings) return;
                m.innings.forEach(function (inn) {
                    if (inn.batsmen) inn.batsmen.forEach(function (b) {
                        var k = b.name + '||' + inn.battingTeamName;
                        if (!playerStats[k]) playerStats[k] = { name: b.name, team: inn.battingTeamName, runs: 0, wickets: 0, wBalls: 0, wRuns: 0, motmCount: 0 };
                        playerStats[k].runs += b.runs || 0;
                    });
                    if (inn.bowlers) inn.bowlers.forEach(function (b) {
                        var k = b.name + '||' + inn.fieldingTeamName;
                        if (!playerStats[k]) playerStats[k] = { name: b.name, team: inn.fieldingTeamName, runs: 0, wickets: 0, wBalls: 0, wRuns: 0, motmCount: 0 };
                        playerStats[k].wickets += b.wickets || 0;
                        playerStats[k].wBalls  += b.balls   || 0;
                        playerStats[k].wRuns   += b.runs    || 0;
                    });
                });
                if (m.man_of_the_match) {
                    Object.keys(playerStats).forEach(function (k) {
                        if (playerStats[k].name === m.man_of_the_match.name) playerStats[k].motmCount++;
                    });
                }
            });

            var all = Object.values(playerStats);

            var battingBody = document.getElementById('battingRankingsBody');
            battingBody.innerHTML = '';
            all.slice().sort(function (a, b) { return b.runs - a.runs; }).slice(0, 10).forEach(function (p, i) {
                var row = document.createElement('tr');
                row.innerHTML = '<td>' + (i + 1) + '</td><td>' + p.name + '</td><td>' + (p.team || '-') + '</td><td><strong>' + p.runs + '</strong></td>';
                battingBody.appendChild(row);
            });

            var bowlingBody = document.getElementById('bowlingRankingsBody');
            bowlingBody.innerHTML = '';
            all.slice().sort(function (a, b) { return b.wickets !== a.wickets ? b.wickets - a.wickets : (a.wRuns / (a.wBalls || 1)) - (b.wRuns / (b.wBalls || 1)); }).slice(0, 10).forEach(function (p, i) {
                var row = document.createElement('tr');
                row.innerHTML = '<td>' + (i + 1) + '</td><td>' + p.name + '</td><td>' + (p.team || '-') + '</td><td><strong>' + p.wickets + '</strong></td>';
                bowlingBody.appendChild(row);
            });

            var mvp = all.slice().sort(function (a, b) { return b.motmCount !== a.motmCount ? b.motmCount - a.motmCount : b.runs - a.runs; })[0];
            document.getElementById('mvpName').textContent   = (mvp && mvp.runs > 0) ? mvp.name : 'No data yet';
            document.getElementById('mvpPoints').textContent = (mvp && mvp.runs > 0) ? mvp.runs + ' runs | ' + mvp.wickets + ' wickets | ' + mvp.motmCount + ' MOTM award(s)' : '';
        }).catch(function (e) { console.error('Stats error:', e); });
}

// ========================================
// SCORING INTERFACE
// ========================================
function loadScoringInterface() {
    db.from('matches').select('*').in('status', ['upcoming', 'live'])
        .then(function (result) {
            var matches = result.data || [];
            var sel = document.getElementById('scoringMatchSelect');
            sel.innerHTML = '<option value="">-- Select Match --</option>';
            matches.forEach(function (m) {
                sel.add(new Option(m.team1.name + ' vs ' + m.team2.name + ' (' + m.status + ')', m.id));
            });
        }).catch(function (e) { console.error('Scoring interface error:', e); });
}

function handleScoringMatchSelect() {
    var matchId = document.getElementById('scoringMatchSelect').value;
    if (!matchId) {
        document.getElementById('scoringInterface').classList.add('hidden');
        currentScoringMatch = null;
        return;
    }
    db.from('matches').select('*').eq('id', matchId).single()
        .then(function (result) {
            if (!result.data) return;
            currentScoringMatch = result.data;
            document.getElementById('scoringInterface').classList.remove('hidden');
            document.getElementById('scoringMatchTitle').textContent = result.data.team1.name + ' vs ' + result.data.team2.name;
            refreshScoringUI();
        }).catch(function (e) { console.error('Match select error:', e); });
}

// ========================================
// SCORING UI REFRESH
// ========================================
function refreshScoringUI() {
    if (!currentScoringMatch) return;
    var match = currentScoringMatch;

    var tossSelection   = document.getElementById('tossSelection');
    var tossInfoDisplay = document.getElementById('tossInfoDisplay');
    var startInningsBtn = document.getElementById('startInningsBtn');
    var endInningsBtn   = document.getElementById('endInningsBtn');
    var endMatchBtn     = document.getElementById('endMatchBtn');
    var batsmenSel      = document.getElementById('batsmenSelection');
    var bowlerSel       = document.getElementById('bowlerSelection');
    var currentPlayers  = document.getElementById('currentPlayers');
    var scoringControls = document.getElementById('scoringControls');

    [batsmenSel, bowlerSel, currentPlayers, scoringControls].forEach(function (el) { el.classList.add('hidden'); });
    [startInningsBtn, endInningsBtn, endMatchBtn].forEach(function (el) { el.classList.add('hidden'); });
    _clearStatusBanners();

    if (!match.toss) {
        tossSelection.classList.remove('hidden');
        tossInfoDisplay.classList.add('hidden');
        var tw = document.getElementById('tossWinnerSelect');
        tw.innerHTML = '<option value="">-- Select Toss Winner --</option>';
        tw.add(new Option(match.team1.name, match.team1.id));
        tw.add(new Option(match.team2.name, match.team2.id));
        return;
    }

    tossSelection.classList.add('hidden');
    tossInfoDisplay.classList.remove('hidden');
    document.getElementById('tossInfoText').textContent =
        match.toss.winnerName + ' won the toss and chose to ' + (match.toss.decision === 'bat' ? 'bat' : 'bowl') + ' first';

    if (match.status === 'upcoming' || match.current_innings === 0) {
        startInningsBtn.classList.remove('hidden');
        return;
    }

    if (match.status === 'live') {
        var inn = match.innings[match.current_innings - 1];

        document.getElementById('scoringBattingTeam').textContent = inn.battingTeamName;
        document.getElementById('scoringScore').textContent       = inn.runs + '/' + inn.wickets;
        document.getElementById('scoringOvers').textContent       = '(' + formatOvers(inn.balls) + ')';

        var targetEl = document.getElementById('targetInfo');
        if (match.current_innings === 2 && match.innings.length >= 2) {
            var target     = match.innings[0].runs + 1;
            var runsNeeded = target - inn.runs;
            var ballsLeft  = (match.total_overs * 6) - inn.balls;
            var rrr        = ballsLeft > 0 ? ((runsNeeded / ballsLeft) * 6).toFixed(2) : '0.00';
            if (targetEl) targetEl.textContent = runsNeeded > 0
                ? 'Target: ' + target + ' | Need ' + runsNeeded + ' from ' + ballsLeft + ' balls | RRR: ' + rrr
                : 'TARGET ACHIEVED!';
        } else {
            if (targetEl) targetEl.textContent = '';
        }

        if (!inn.striker || !inn.bowler) {
            if (!inn.striker) showBatsmenSelection();
            else              showBowlerSelection();
            return;
        }

        var maxWickets    = inn.maxWickets !== undefined ? inn.maxWickets : 10;
        var totalBalls    = match.total_overs * 6;
        var isAllOut      = inn.allOut === true || inn.wickets >= maxWickets;
        var oversComplete = inn.balls >= totalBalls;
        var inningsLocked = isAllOut || oversComplete;

        currentPlayers.classList.remove('hidden');
        var striker    = inn.batsmen && inn.batsmen.find(function (b) { return b.id === inn.striker; });
        var nonStriker = inn.batsmen && inn.batsmen.find(function (b) { return b.id === inn.nonStriker; });
        var bowler     = inn.bowlers && inn.bowlers.find(function (b) { return b.id === inn.bowler; });

        document.getElementById('currentStriker').textContent    = striker    ? striker.name    : '-';
        document.getElementById('strikerStats').textContent      = striker    ? striker.runs    + '(' + striker.balls    + ')' : '0(0)';
        document.getElementById('currentNonStriker').textContent = nonStriker ? nonStriker.name : '-';
        document.getElementById('nonStrikerStats').textContent   = nonStriker ? nonStriker.runs + '(' + nonStriker.balls + ')' : '0(0)';
        document.getElementById('currentBowler').textContent     = bowler     ? bowler.name     : '-';
        document.getElementById('bowlerStats').textContent       = bowler     ? bowler.wickets  + '-' + bowler.runs + ' (' + formatOvers(bowler.balls) + ')' : '0-0 (0.0)';

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

function _clearStatusBanners() {
    ['inningsCompleteBanner', 'allOutBanner'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.remove();
    });
}

function _showAllOutBanner(inn, match) {
    var banner = document.getElementById('allOutBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'allOutBanner';
        banner.className = 'all-out-banner';
        document.getElementById('currentPlayers').insertAdjacentElement('afterend', banner);
    }
    var action = match.current_innings === 1 ? 'Click "End Innings" to start the second innings.' : 'Click "End Match" to finish.';
    banner.innerHTML = '<span class="all-out-badge">ALL OUT!</span><span class="all-out-detail">' + inn.battingTeamName + ' all out for <strong>' + inn.runs + '</strong> (' + formatOvers(inn.balls) + ' overs, ' + inn.wickets + ' wickets) — ' + action + '</span>';
}

function _showOversCompleteBanner(match) {
    var banner = document.getElementById('inningsCompleteBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'inningsCompleteBanner';
        banner.className = 'innings-complete-banner';
        document.getElementById('currentPlayers').insertAdjacentElement('afterend', banner);
    }
    var action = match.current_innings === 1 ? 'Click "End Innings" to start the second innings.' : 'Click "End Match" to finish.';
    banner.textContent = 'All ' + match.total_overs + ' overs completed. ' + action;
}

// ========================================
// THIS OVER DISPLAY
// ========================================
function renderThisOver(inn) {
    var container = document.getElementById('thisOverBalls');
    container.innerHTML = '';
    (inn.thisOver || []).forEach(function (ball) {
        var span = document.createElement('span');
        span.className = 'over-ball';
        if (ball.isWicket) {
            span.classList.add('wicket');
            span.textContent = 'W';
        } else if (ball.extraType) {
            span.classList.add('extra');
            if (ball.extraType === 'wide')   span.textContent = 'Wd';
            else if (ball.extraType === 'noball') span.textContent = ball.batsmanRuns > 0 ? 'Nb+' + ball.batsmanRuns : 'Nb';
            else span.textContent = ball.runs > 0 ? ball.runs : '0';
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
function renderScoringCommentary(matchId) {
    db.from('balls').select('*').eq('match_id', matchId).order('created_at', { ascending: false }).limit(10)
        .then(function (result) {
            var container = document.getElementById('scoringCommentary');
            container.innerHTML = '';
            (result.data || []).forEach(function (ball) {
                var item = document.createElement('div');
                item.className = 'commentary-item';
                item.innerHTML = '<div class="ball-info">' + formatOvers(ball.over_ball) + '</div><div class="ball-desc">' + ball.description + '</div>';
                container.appendChild(item);
            });
        }).catch(function () {});
}

// ========================================
// TOSS
// ========================================
function confirmToss() {
    var winnerId = document.getElementById('tossWinnerSelect').value;
    var decision = document.getElementById('tossDecisionSelect').value;
    if (!winnerId || !decision) { showMessage('Please select toss winner and decision.'); return; }

    var match       = currentScoringMatch;
    var winnerName  = match.team1.id === winnerId ? match.team1.name : match.team2.name;
    var battingTeam = decision === 'bat'
        ? (match.team1.id === winnerId ? match.team1 : match.team2)
        : (match.team1.id === winnerId ? match.team2 : match.team1);
    var fieldingTeam = battingTeam.id === match.team1.id ? match.team2 : match.team1;

    db.from('matches').update({
        toss:                { winnerId: winnerId, winnerName: winnerName, decision: decision },
        batting_first_team:  battingTeam,
        fielding_first_team: fieldingTeam
    }).eq('id', match.id).then(function (result) {
        if (result.error) { showMessage('Error saving toss: ' + result.error.message); return; }
        currentScoringMatch = Object.assign({}, match, { toss: { winnerId: winnerId, winnerName: winnerName, decision: decision }, batting_first_team: battingTeam, fielding_first_team: fieldingTeam });
        refreshScoringUI();
    }).catch(function (e) { showMessage('Toss error: ' + e.message); });
}

// ========================================
// START INNINGS
// ========================================
function startInnings() {
    var match      = currentScoringMatch;
    var inningsIdx = match.innings ? match.innings.length : 0;
    var battingTeam, fieldingTeam;

    if (inningsIdx === 0) {
        battingTeam  = match.batting_first_team  || match.team1;
        fieldingTeam = match.fielding_first_team || match.team2;
    } else {
        battingTeam  = match.innings[0].battingTeamId === match.team1.id ? match.team2 : match.team1;
        fieldingTeam = match.innings[0].battingTeamId === match.team1.id ? match.team1 : match.team2;
    }

    db.from('teams').select('players').eq('id', battingTeam.id).single()
        .then(function (result) {
            var rosterSize  = result.data && result.data.players ? result.data.players.length : 11;
            var maxWickets  = Math.max(rosterSize - 1, 1);
            var newInnings  = {
                inningsNumber: inningsIdx + 1,
                battingTeamId: battingTeam.id, battingTeamName: battingTeam.name,
                fieldingTeamId: fieldingTeam.id, fieldingTeamName: fieldingTeam.name,
                runs: 0, wickets: 0, balls: 0,
                batsmen: [], bowlers: [],
                striker: null, nonStriker: null, bowler: null, thisOver: [],
                maxWickets: maxWickets, allOut: false
            };
            var updatedInnings = (match.innings || []).concat([newInnings]);

            return db.from('matches').update({
                status: 'live', innings: updatedInnings, current_innings: inningsIdx + 1
            }).eq('id', match.id).then(function (r2) {
                if (r2.error) { showMessage('Error starting innings: ' + r2.error.message); return; }
                currentScoringMatch = Object.assign({}, match, { status: 'live', innings: updatedInnings, current_innings: inningsIdx + 1 });
                showBatsmenSelection();
                refreshScoringUI();
            });
        }).catch(function (e) { showMessage('Innings error: ' + e.message); });
}

// ========================================
// BATSMEN / BOWLER SELECTION
// ========================================
function showBatsmenSelection() {
    var match = currentScoringMatch;
    var inn   = match.innings[match.current_innings - 1];

    db.from('teams').select('players').eq('id', inn.battingTeamId).single()
        .then(function (result) {
            var players = result.data ? result.data.players || [] : [];
            var usedIds = (inn.batsmen || []).filter(function (b) { return !b.isOut; }).map(function (b) { return b.id; });

            var strikerSel    = document.getElementById('strikerSelect');
            var nonStrikerSel = document.getElementById('nonStrikerSelect');
            strikerSel.innerHTML    = '<option value="">-- Select Striker --</option>';
            nonStrikerSel.innerHTML = '<option value="">-- Select Non-Striker --</option>';

            var available = players.filter(function (p) { return usedIds.indexOf(p.id) === -1; });
            if (!available.length) {
                strikerSel.innerHTML    = '<option value="">No available players</option>';
                nonStrikerSel.innerHTML = '<option value="">No available players</option>';
            } else {
                available.forEach(function (p) {
                    strikerSel.add(new Option(p.name, p.id + '||' + p.name));
                    nonStrikerSel.add(new Option(p.name, p.id + '||' + p.name));
                });
            }

            var heading = document.querySelector('#batsmenSelection h4');
            if (heading) heading.textContent = inn.inningsNumber === 1 ? 'Select Opening Batsmen' : 'Select Opening Batsmen (2nd Innings)';

            document.getElementById('batsmenSelection').classList.remove('hidden');
            document.getElementById('bowlerSelection').classList.add('hidden');
            document.getElementById('currentPlayers').classList.add('hidden');
            document.getElementById('scoringControls').classList.add('hidden');
        }).catch(function (e) { showMessage('Error loading batsmen: ' + e.message); });
}

// ========================================
// END OF OVER — CHANGE BOWLER PROMPT
// ========================================
function showEndOfOverPrompt() {
    var match  = currentScoringMatch;
    var inn    = match.innings[match.current_innings - 1];
    var bowler = inn.bowlers && inn.bowlers.find(function (b) { return b.id === inn.bowler; });
    var overNum = Math.floor(inn.balls / 6);

    var modal    = document.getElementById('endOfOverModal');
    var msgEl    = document.getElementById('endOfOverMsg');
    var keepBtn  = document.getElementById('keepBowlerBtn');
    var changBtn = document.getElementById('changeBowlerPromptBtn');

    msgEl.textContent    = 'Over ' + overNum + ' complete! ' + (bowler ? bowler.name + ' bowled that over.' : '');
    keepBtn.textContent  = 'Keep ' + (bowler ? bowler.name : 'Same Bowler');

    keepBtn.onclick = function () {
        modal.classList.add('hidden');
        if (inn.bowler) _reconfirmSameBowler(inn.bowler, bowler ? bowler.name : '');
    };
    changBtn.onclick = function () {
        modal.classList.add('hidden');
        showBowlerSelection();
    };
    modal.classList.remove('hidden');
}

function _reconfirmSameBowler(bid, bname) {
    var match   = currentScoringMatch;
    var idx     = match.current_innings - 1;
    var innings = match.innings.slice();
    var inn     = Object.assign({}, innings[idx]);
    inn.thisOver = [];
    innings[idx] = inn;

    db.from('matches').update({ innings: innings }).eq('id', match.id)
        .then(function (result) {
            if (result.error) { showMessage('Error starting new over: ' + result.error.message); return; }
            currentScoringMatch = Object.assign({}, match, { innings: innings });
            refreshScoringUI();
        }).catch(function (e) { showMessage('Error: ' + e.message); });
}

function showBowlerSelection() {
    var match = currentScoringMatch;
    var inn   = match.innings[match.current_innings - 1];

    db.from('teams').select('players').eq('id', inn.fieldingTeamId).single()
        .then(function (result) {
            var players  = result.data ? result.data.players || [] : [];
            var bowlerSel = document.getElementById('bowlerSelect');
            bowlerSel.innerHTML = '<option value="">-- Select Bowler --</option>';

            players.forEach(function (p) {
                var record = (inn.bowlers || []).find(function (b) { return b.id === String(p.id); });
                var label  = p.name;
                if (record && record.balls > 0) {
                    var completedOvers = Math.floor(record.balls / 6);
                    if (completedOvers > 0) label += ' \u2014 ' + completedOvers + ' over' + (completedOvers > 1 ? 's' : '') + ' completed';
                    else                   label += ' \u2014 ' + record.balls + ' ball' + (record.balls !== 1 ? 's' : '') + ' bowled';
                }
                bowlerSel.add(new Option(label, p.id + '||' + p.name));
            });

            document.getElementById('bowlerSelection').classList.remove('hidden');
            document.getElementById('batsmenSelection').classList.add('hidden');
            document.getElementById('scoringControls').classList.add('hidden');
            renderThisOver(inn);
        }).catch(function (e) { showMessage('Error loading bowlers: ' + e.message); });
}

function confirmBatsmen() {
    var sv = document.getElementById('strikerSelect').value;
    var nv = document.getElementById('nonStrikerSelect').value;
    if (!sv || !nv) { showMessage('Please select both batsmen.'); return; }
    if (sv === nv)  { showMessage('Please select two different batsmen.'); return; }

    var sidParts = sv.split('||'), sid = sidParts[0], sname = sidParts[1];
    var nidParts = nv.split('||'), nid = nidParts[0], nname = nidParts[1];

    var match   = currentScoringMatch;
    var idx     = match.current_innings - 1;
    var innings = match.innings.slice();
    var inn     = Object.assign({}, innings[idx]);
    var batsmen = (inn.batsmen || []).slice();

    if (!batsmen.find(function (b) { return b.id === sid; })) batsmen.push({ id: sid, name: sname, runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, isStriker: true,  status: 'Not Out' });
    if (!batsmen.find(function (b) { return b.id === nid; })) batsmen.push({ id: nid, name: nname, runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, isStriker: false, status: 'Not Out' });

    inn.batsmen    = batsmen;
    inn.striker    = sid;
    inn.nonStriker = nid;
    innings[idx]   = inn;

    db.from('matches').update({ innings: innings }).eq('id', match.id)
        .then(function (result) {
            if (result.error) { showMessage('Error confirming batsmen: ' + result.error.message); return; }
            currentScoringMatch = Object.assign({}, match, { innings: innings });
            document.getElementById('batsmenSelection').classList.add('hidden');
            showBowlerSelection();
        }).catch(function (e) { showMessage('Error: ' + e.message); });
}

function confirmBowler() {
    var bv = document.getElementById('bowlerSelect').value;
    if (!bv) { showMessage('Please select a bowler.'); return; }

    var parts  = bv.split('||'), bid = parts[0], bname = parts[1];
    var match  = currentScoringMatch;
    var idx    = match.current_innings - 1;
    var innings = match.innings.slice();
    var inn    = Object.assign({}, innings[idx]);
    var bowlers = (inn.bowlers || []).slice();

    if (!bowlers.find(function (b) { return b.id === bid; }))
        bowlers.push({ id: bid, name: bname, balls: 0, runs: 0, wickets: 0, maidens: 0, extras: 0 });

    inn.bowlers  = bowlers;
    inn.bowler   = bid;
    inn.thisOver = [];
    innings[idx] = inn;

    db.from('matches').update({ innings: innings }).eq('id', match.id)
        .then(function (result) {
            if (result.error) { showMessage('Error confirming bowler: ' + result.error.message); return; }
            currentScoringMatch = Object.assign({}, match, { innings: innings });
            document.getElementById('bowlerSelection').classList.add('hidden');
            refreshScoringUI();
        }).catch(function (e) { showMessage('Error: ' + e.message); });
}

// ========================================
// CHANGE STRIKE / CHANGE BOWLER
// ========================================
function changeStrike() {
    var match   = currentScoringMatch;
    var idx     = match.current_innings - 1;
    var innings = match.innings.slice();
    var inn     = Object.assign({}, innings[idx]);

    var t        = inn.striker;
    inn.striker    = inn.nonStriker;
    inn.nonStriker = t;
    inn.batsmen    = inn.batsmen.map(function (b) { return Object.assign({}, b, { isStriker: b.id === inn.striker }); });
    innings[idx]   = inn;

    db.from('matches').update({ innings: innings }).eq('id', match.id)
        .then(function (result) {
            if (result.error) { showMessage('Error changing strike: ' + result.error.message); return; }
            currentScoringMatch = Object.assign({}, match, { innings: innings });
            refreshScoringUI();
        }).catch(function (e) { showMessage('Error: ' + e.message); });
}

function showChangeBowler() { showBowlerSelection(); }

// ========================================
// WICKET MODAL
// ========================================
function showWicketModal() {
    if (!currentScoringMatch) return;
    var match = currentScoringMatch;
    var inn   = match.innings[match.current_innings - 1];

    var batsmanSel = document.getElementById('wicketBatsmanSelect');
    batsmanSel.innerHTML = '<option value="">-- Select --</option>';
    (inn.batsmen || []).filter(function (b) { return !b.isOut; }).forEach(function (b) {
        batsmanSel.add(new Option(b.name + (b.isStriker ? ' *' : ''), b.id));
    });

    var fielderSel = document.getElementById('fielderSelect');
    fielderSel.innerHTML = '<option value="">-- Select Fielder --</option>';

    db.from('teams').select('players').eq('id', inn.fieldingTeamId).single()
        .then(function (result) {
            var players = result.data ? result.data.players || [] : [];
            players.forEach(function (p) { fielderSel.add(new Option(p.name, p.id)); });
        }).catch(function () {});

    var newBatsmanSel = document.getElementById('newBatsmanSelect');
    newBatsmanSel.innerHTML = '<option value="">-- Select --</option>';
    var usedIds = (inn.batsmen || []).filter(function (b) { return !b.isOut; }).map(function (b) { return b.id; });
    db.from('teams').select('players').eq('id', inn.battingTeamId).single()
        .then(function (result) {
            var players = result.data ? result.data.players || [] : [];
            players.filter(function (p) { return usedIds.indexOf(p.id) === -1; }).forEach(function (p) {
                newBatsmanSel.add(new Option(p.name, p.id + '||' + p.name));
            });
        }).catch(function () {});

    document.getElementById('wicketModal').classList.remove('hidden');
}

function closeWicketModal() { document.getElementById('wicketModal').classList.add('hidden'); }

function handleWicket(e) {
    e.preventDefault();
    var batsmanId  = document.getElementById('wicketBatsmanSelect').value;
    var wicketType = document.getElementById('wicketType').value;
    var fielderVal = document.getElementById('fielderSelect').value;
    var newBatVal  = document.getElementById('newBatsmanSelect').value;

    if (!batsmanId || !wicketType) { showMessage('Please fill in all required fields.'); return; }

    var match   = currentScoringMatch;
    var idx     = match.current_innings - 1;
    var innings = match.innings.slice();
    var inn     = Object.assign({}, innings[idx]);
    var batsmen = inn.batsmen.slice();
    var bowlers = (inn.bowlers || []).slice();

    var batsmanIdx = batsmen.findIndex(function (b) { return b.id === batsmanId; });
    if (batsmanIdx === -1) { showMessage('Batsman not found.'); return; }

    var dismissalText = wicketType;
    if (fielderVal && (wicketType === 'Caught' || wicketType === 'Run Out')) {
        var fielderName = document.getElementById('fielderSelect').options[document.getElementById('fielderSelect').selectedIndex].text;
        dismissalText  = wicketType === 'Caught' ? 'c ' + fielderName + ' b ' + (inn.bowlers && inn.bowlers.find(function (b) { return b.id === inn.bowler; }) ? inn.bowlers.find(function (b) { return b.id === inn.bowler; }).name : '') : 'Run Out (' + fielderName + ')';
    }

    batsmen[batsmanIdx] = Object.assign({}, batsmen[batsmanIdx], { isOut: true, isStriker: false, status: dismissalText });

    var bowlerIdx = bowlers.findIndex(function (b) { return b.id === inn.bowler; });
    if (bowlerIdx !== -1 && wicketType !== 'Run Out') bowlers[bowlerIdx] = Object.assign({}, bowlers[bowlerIdx], { wickets: bowlers[bowlerIdx].wickets + 1 });

    inn.wickets += 1;

    if (wicketType !== 'Run Out' && wicketType !== 'Stumped') {
        var bowlerRec = bowlers.find(function (b) { return b.id === inn.bowler; });
        var striker   = batsmen.find(function (b) { return b.id === batsmanId; });
    }

    if (inn.striker === batsmanId) inn.striker = inn.nonStriker;
    batsmen = batsmen.map(function (b) { return Object.assign({}, b, { isStriker: b.id === inn.striker }); });

    var maxWickets = inn.maxWickets !== undefined ? inn.maxWickets : 10;
    if (inn.wickets >= maxWickets) inn.allOut = true;

    if (newBatVal) {
        var nbParts = newBatVal.split('||'), nbId = nbParts[0], nbName = nbParts[1];
        if (!batsmen.find(function (b) { return b.id === nbId; }))
            batsmen.push({ id: nbId, name: nbName, runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, isStriker: true, status: 'Not Out' });
        inn.striker = nbId;
        inn.nonStriker = inn.batsmen.find(function (b) { return !b.isOut && b.id !== nbId; }) ? inn.batsmen.find(function (b) { return !b.isOut && b.id !== nbId; }).id : inn.nonStriker;
        batsmen = batsmen.map(function (b) { return Object.assign({}, b, { isStriker: b.id === inn.striker }); });
    }

    inn.batsmen  = batsmen;
    inn.bowlers  = bowlers;
    inn.thisOver = (inn.thisOver || []).concat([{ runs: 0, isWicket: true, extraType: null, batsmanRuns: null }]);
    innings[idx] = inn;

    var overBall = inn.balls;
    var striker2 = batsmen.find(function (b) { return b.id === inn.striker; });
    var bowler2  = bowlers.find(function (b) { return b.id === inn.bowler; });
    var desc     = 'WICKET! ' + (batsmen[batsmanIdx] ? batsmen[batsmanIdx].name : '') + ' ' + dismissalText + (bowler2 ? ' b ' + bowler2.name : '');

    lastBalls.push({ innings: match.innings });

    db.from('matches').update({ innings: innings }).eq('id', match.id)
        .then(function (result) {
            if (result.error) { showMessage('Error recording wicket: ' + result.error.message); return; }
            return db.from('balls').insert({
                match_id: match.id, type: 'wicket', runs: 0, is_extra: false,
                extra_type: null, is_wicket: true, over_ball: overBall,
                description: desc, innings_number: match.current_innings
            });
        }).then(function () {
            currentScoringMatch = Object.assign({}, match, { innings: innings });
            closeWicketModal();
            if (inn.allOut) {
                showMessage(inn.battingTeamName + ' are ALL OUT for ' + inn.runs + '!');
            }
            refreshScoringUI();
        }).catch(function (e) { showMessage('Wicket error: ' + e.message); });
}

// ========================================
// NO BALL MODAL
// ========================================
function showNoBallModal()  { document.getElementById('noBallModal').classList.remove('hidden'); }
function closeNoBallModal() { document.getElementById('noBallModal').classList.add('hidden'); }

function confirmNoBall(batsmanRuns) {
    closeNoBallModal();
    recordBall(1 + batsmanRuns, true, 'noball', batsmanRuns);
}

// ========================================
// RECORD BALL
// ========================================
function recordBall(runs, isExtra, extraType, batsmanRuns) {
    if (batsmanRuns === undefined) batsmanRuns = 0;
    if (!currentScoringMatch) return;
    var match   = currentScoringMatch;
    var idx     = match.current_innings - 1;
    var innings = match.innings.slice();
    var inn     = Object.assign({}, innings[idx]);

    var striker    = inn.batsmen && inn.batsmen.find(function (b) { return b.id === inn.striker; });
    var nonStriker = inn.batsmen && inn.batsmen.find(function (b) { return b.id === inn.nonStriker; });
    var bowler     = inn.bowlers && inn.bowlers.find(function (b) { return b.id === inn.bowler; });

    if (!striker || !bowler) { showMessage('Please select batsmen and bowler first.'); return; }

    lastBalls.push({ innings: match.innings });

    var batsmen = inn.batsmen.map(function (b) { return Object.assign({}, b); });
    var bowlers = inn.bowlers.map(function (b) { return Object.assign({}, b); });
    var strikerIdx = batsmen.findIndex(function (b) { return b.id === inn.striker; });
    var bowlerIdx  = bowlers.findIndex(function (b) { return b.id === inn.bowler; });

    var isLegalBall = !isExtra || extraType === 'bye' || extraType === 'legbye';
    var overBall    = inn.balls;

    inn.runs += runs;
    if (strikerIdx !== -1) {
        batsmen[strikerIdx].runs += extraType === 'noball' ? batsmanRuns : (extraType === 'bye' || extraType === 'legbye' ? 0 : runs);
        if (isLegalBall) batsmen[strikerIdx].balls += 1;
        if (!isExtra || extraType === 'noball') {
            var actualRuns = extraType === 'noball' ? batsmanRuns : runs;
            if (actualRuns === 4) batsmen[strikerIdx].fours += 1;
            if (actualRuns === 6) batsmen[strikerIdx].sixes += 1;
        }
    }
    if (bowlerIdx !== -1) {
        bowlers[bowlerIdx].runs += runs;
        if (isExtra) bowlers[bowlerIdx].extras += 1;
        if (isLegalBall) bowlers[bowlerIdx].balls += 1;
    }

    if (isLegalBall) inn.balls += 1;

    var overComplete = isLegalBall && (inn.balls % 6 === 0) && inn.balls > 0;
    var strikerName  = striker.name, bowlerName = bowler ? bowler.name : '';
    var description  = '';

    if (isExtra) {
        if (extraType === 'wide')   description = 'Wide. +1 run.';
        else if (extraType === 'noball') {
            if      (batsmanRuns === 4) description = 'NO BALL + FOUR! ' + strikerName + ' hits for 4. Total: ' + runs + ' runs.';
            else if (batsmanRuns === 6) description = 'NO BALL + SIX! '  + strikerName + ' hits for 6. Total: ' + runs + ' runs.';
            else                        description = 'NO BALL + ' + batsmanRuns + ' run(s). Total: ' + runs + ' runs.';
        } else {
            description = extraType.toUpperCase() + ' + ' + runs + ' runs';
        }
    } else if (runs === 0) {
        description = 'Dot ball. ' + strikerName + ' to ' + bowlerName;
    } else if (runs === 4) {
        description = 'FOUR! ' + strikerName + ' hits ' + bowlerName + ' for 4';
    } else if (runs === 6) {
        description = 'SIX! '  + strikerName + ' hits ' + bowlerName + ' for 6';
    } else {
        description = runs + ' run(s). ' + strikerName + ' off ' + bowlerName;
    }

    var strikeSwitchOnRun = !isExtra || extraType === 'bye' || extraType === 'legbye' || extraType === 'noball';
    if (strikeSwitchOnRun && runs % 2 !== 0 && !overComplete) {
        var t2        = inn.striker;
        inn.striker    = inn.nonStriker;
        inn.nonStriker = t2;
        batsmen = batsmen.map(function (b) { return Object.assign({}, b, { isStriker: b.id === inn.striker }); });
    }

    if (overComplete) {
        var t3        = inn.striker;
        inn.striker    = inn.nonStriker;
        inn.nonStriker = t3;
        batsmen = batsmen.map(function (b) { return Object.assign({}, b, { isStriker: b.id === inn.striker }); });
        inn.thisOver = (inn.thisOver || []).concat([{ runs: runs, isWicket: false, extraType: isExtra ? extraType : null, batsmanRuns: extraType === 'noball' ? batsmanRuns : null }]);
        description += ' [End of Over]';
    } else {
        inn.thisOver = (inn.thisOver || []).concat([{ runs: runs, isWicket: false, extraType: isExtra ? extraType : null, batsmanRuns: extraType === 'noball' ? batsmanRuns : null }]);
    }

    inn.batsmen = batsmen;
    inn.bowlers = bowlers;
    innings[idx] = inn;

    db.from('matches').update({ innings: innings }).eq('id', match.id)
        .then(function (result) {
            if (result.error) { showMessage('Error recording ball: ' + result.error.message); return; }
            return db.from('balls').insert({
                match_id: match.id, type: isExtra ? 'extra' : 'normal',
                runs: runs, is_extra: isExtra, extra_type: extraType,
                is_wicket: false, over_ball: overBall,
                description: description, innings_number: match.current_innings
            });
        }).then(function () {
            currentScoringMatch = Object.assign({}, match, { innings: innings });
            var targetReached = match.current_innings === 2 && innings.length >= 2 && inn.runs >= innings[0].runs + 1;
            if (targetReached) {
                var maxW = inn.maxWickets !== undefined ? inn.maxWickets : 10;
                showMessage('TARGET ACHIEVED! ' + inn.battingTeamName + ' wins by ' + (maxW - inn.wickets) + ' wicket(s)!');
                refreshScoringUI();
                setTimeout(endMatch, 2000);
                return;
            }
            if (overComplete) showEndOfOverPrompt();
            else              refreshScoringUI();
        }).catch(function (e) { showMessage('Ball error: ' + e.message); });
}

// ========================================
// HANDLE EXTRA
// ========================================
function handleExtra(extraType) {
    if (extraType === 'noball') { showNoBallModal(); return; }
    var runs = 1;
    if (extraType === 'bye' || extraType === 'legbye') {
        var r = prompt('Enter runs for ' + extraType + ' (0-6):', '1');
        if (r === null) return;
        runs = parseInt(r) || 0;
    }
    recordBall(runs, true, extraType);
}

// ========================================
// END INNINGS
// ========================================
function endInnings() {
    if (!confirm('Are you sure you want to end this innings?')) return;
    var match   = currentScoringMatch;
    var innings = match.innings.slice();
    innings[match.current_innings - 1] = Object.assign({}, innings[match.current_innings - 1], { completed: true });

    db.from('matches').update({ innings: innings }).eq('id', match.id)
        .then(function (result) {
            if (result.error) { showMessage('Error ending innings: ' + result.error.message); return; }
            currentScoringMatch = Object.assign({}, match, { innings: innings });
            showMessage('Innings ended. Click "Start Innings" to begin the second innings.');
            document.getElementById('startInningsBtn').classList.remove('hidden');
            document.getElementById('endInningsBtn').classList.add('hidden');
            document.getElementById('currentPlayers').classList.add('hidden');
            document.getElementById('scoringControls').classList.add('hidden');
            _clearStatusBanners();
        }).catch(function (e) { showMessage('Error: ' + e.message); });
}

// ========================================
// END MATCH
// ========================================
function endMatch() {
    if (!confirm('Are you sure you want to end this match?')) return;
    var match   = currentScoringMatch;
    var innings = match.innings;
    var result  = 'Match result pending';
    var manOfTheMatch = null, bestBatsman = null, bestBowler = null;

    if (innings && innings.length >= 2) {
        var i1 = innings[0], i2 = innings[1];
        if      (i2.runs > i1.runs) result = i2.battingTeamName + ' won by ' + ((i2.maxWickets !== undefined ? i2.maxWickets : 10) - i2.wickets) + ' wicket(s)';
        else if (i1.runs > i2.runs) result = i1.battingTeamName + ' won by ' + (i1.runs - i2.runs) + ' run(s)';
        else                        result = 'Match Tied';

        var grouped = {};
        (i1.batsmen || []).concat(i2.batsmen || []).forEach(function (b) {
            if (!grouped[b.name]) grouped[b.name] = { name: b.name, runs: 0, balls: 0 };
            grouped[b.name].runs += b.runs; grouped[b.name].balls += b.balls;
        });
        bestBatsman = Object.values(grouped).sort(function (a, b) { return b.runs - a.runs; })[0] || null;

        var groupedB = {};
        (i1.bowlers || []).concat(i2.bowlers || []).forEach(function (b) {
            if (!groupedB[b.name]) groupedB[b.name] = { name: b.name, wickets: 0, runs: 0, balls: 0 };
            groupedB[b.name].wickets += b.wickets; groupedB[b.name].runs += b.runs; groupedB[b.name].balls += b.balls;
        });
        bestBowler    = Object.values(groupedB).sort(function (a, b) { return b.wickets !== a.wickets ? b.wickets - a.wickets : (a.runs / (a.balls || 1)) - (b.runs / (b.balls || 1)); })[0] || null;
        manOfTheMatch = bestBatsman;
    }

    db.from('matches').update({
        status: 'completed', result: result,
        man_of_the_match: manOfTheMatch, best_batsman: bestBatsman,
        best_bowler: bestBowler, completed_at: new Date().toISOString()
    }).eq('id', match.id).then(function (r) {
        if (r.error) { showMessage('Error ending match: ' + r.error.message); return; }
        currentScoringMatch = null;
        document.getElementById('scoringInterface').classList.add('hidden');
        document.getElementById('scoringMatchSelect').value = '';
        showMessage('Match ended! Result: ' + result);
        loadScoringInterface();
    }).catch(function (e) { showMessage('End match error: ' + e.message); });
}

// ========================================
// UNDO LAST BALL
// ========================================
function undoLastBall() {
    if (!lastBalls.length) { showMessage('Nothing to undo.'); return; }
    if (!confirm('Undo the last recorded ball?')) return;

    var last  = lastBalls.pop();
    var match = currentScoringMatch;

    db.from('matches').update({ innings: last.innings }).eq('id', match.id)
        .then(function (result) {
            if (result.error) { showMessage('Error undoing: ' + result.error.message); return; }
            return db.from('balls').select('id').eq('match_id', match.id).order('created_at', { ascending: false }).limit(1);
        }).then(function (result) {
            if (result && result.data && result.data.length) {
                return db.from('balls').delete().eq('id', result.data[0].id);
            }
        }).then(function () {
            currentScoringMatch = Object.assign({}, match, { innings: last.innings });
            refreshScoringUI();
            showMessage('Last ball undone.');
        }).catch(function (e) { showMessage('Undo error: ' + e.message); });
}