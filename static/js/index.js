
// ── Auth Toggle ──
function toggleAuth() {
    const login = document.getElementById('login-form');
    const signup = document.getElementById('signup-form');
    login.style.display = login.style.display === 'none' ? '' : 'none';
    signup.style.display = signup.style.display === 'none' ? '' : 'none';
}

function showApp() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = '';
}

function showAuth() {
    document.getElementById('auth-screen').style.display = '';
    document.getElementById('app-screen').style.display = 'none';
}

// ── View Switching ──
function switchView(el) {
    const view = el.dataset ? el.dataset.view : el.getAttribute('data-view');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    el.classList.add('active');
}

// ── Modal Helper ──
function showModal(id) {
    const modal = new bootstrap.Modal(document.getElementById(id));
    modal.show();
}

// ── AI Form Generate Simulation ──
function simulateAIGenerate() {
    const btn = document.querySelector('.btn-generate');
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Generating...';
    btn.disabled = true;
    setTimeout(() => {
        document.getElementById('ai-result').style.display = '';
        btn.innerHTML = '<i class="bi bi-lightning-charge me-1"></i> Generate';
        btn.disabled = false;
    }, 1500);
}

// ── Autonomy Selector ──
function selectAutonomy(el) {
    el.parentElement.querySelectorAll('.autonomy-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
}