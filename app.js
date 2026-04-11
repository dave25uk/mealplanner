const supabaseUrl = 'https://qysscushyrhgrodlpovg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5c3NjdXNoeXJoZ3JvZGxwb3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE3NzEsImV4cCI6MjA5MTM5Nzc3MX0.1KMpTrpzmi6d-r3nbPzGunpiYHkAjpUxuB32RtAlJqI';
const _supabase = supabase.createClient(URL, KEY);

let currentWeekStart = new Date();
// Set to previous Monday
currentWeekStart.setDate(currentWeekStart.getDate() - (currentWeekStart.getDay() || 7) + 1);

const swiper = new Swiper('.swiper', {
    loop: false,
    on: {
        slideNextTransitionEnd: () => moveWeek(7),
        slidePrevTransitionEnd: () => moveWeek(-7),
    }
});

async function init() {
    renderUI();
    updateMealDatalist();
}

function renderUI() {
    renderHeader();
    renderSlides();
}

function renderHeader() {
    const monthLabel = document.getElementById('month-label');
    const strip = document.getElementById('date-strip');
    strip.innerHTML = '';
    
    monthLabel.innerText = currentWeekStart.toLocaleDateString('en-GB', { month: 'long' });

    for (let i = 0; i < 7; i++) {
        let d = new Date(currentWeekStart);
        d.setDate(d.getDate() + i);
        const day = d.getDay();
        const isWeekend = (day === 0 || day === 6);
        
        strip.innerHTML += `
            <div class="date-item ${isWeekend ? 'is-weekend' : ''}">
                <div class="day-name">${d.toLocaleDateString('en-GB', { weekday: 'narrow' })}</div>
                <div class="date-num">${d.getDate()}</div>
            </div>
        `;
    }
}

async function renderSlides() {
    const wrapper = document.getElementById('calendar-wrapper');
    wrapper.innerHTML = '<div class="swiper-slide" id="current-week"></div>';
    const container = document.getElementById('current-week');

    for (let i = 0; i < 7; i++) {
        let d = new Date(currentWeekStart);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];

        const card = document.createElement('div');
        card.className = 'date-card';
        card.innerHTML = `
            <label style="font-size:12px; color:#8e8e93; text-transform:uppercase;">${d.toLocaleDateString('en-GB', { weekday: 'long' })}</label>
            <input type="text" list="meal-options" data-date="${dateStr}" placeholder="Tap to plan...">
        `;
        container.appendChild(card);
        fetchEntry(dateStr, card.querySelector('input'));
    }
}

async function moveWeek(days) {
    currentWeekStart.setDate(currentWeekStart.getDate() + days);
    renderUI();
    swiper.slideTo(0, 0); // Reset slide position silently
}

// MEAL EDITOR LOGIC
async function openMealEditor() {
    document.getElementById('meal-modal').style.display = 'block';
    const { data } = await _supabase.from('meals').select('*').order('name');
    const listDiv = document.getElementById('meal-list-edit');
    listDiv.innerHTML = data.map(m => `
        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
            <span>${m.name}</span>
            <button onclick="deleteMeal('${m.name}')" style="color:red; border:none; background:none;">Delete</button>
        </div>
    `).join('');
}

async function deleteMeal(name) {
    if(confirm(`Delete "${name}" from your master list?`)) {
        await _supabase.from('meals').delete().eq('name', name);
        openMealEditor();
        updateMealDatalist();
    }
}

function closeMealEditor() { document.getElementById('meal-modal').style.display = 'none'; }

// Reuse your existing fetchEntry and updateMealDatalist functions here...

init();
