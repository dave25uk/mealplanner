const supabaseUrl = 'https://qysscushyrhgrodlpovg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5c3NjdXNoeXJoZ3JvZGxwb3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE3NzEsImV4cCI6MjA5MTM5Nzc3MX0.1KMpTrpzmi6d-r3nbPzGunpiYHkAjpUxuB32RtAlJqI';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let today = new Date();
let currentViewDate = new Date(); // Tracks the start of the visible 7 days

async function init() {
    renderUI();
    updateMealDatalist();
}

function renderUI() {
    renderHeader();
    renderMeals();
}

function renderHeader() {
    document.getElementById('month-label').innerText = currentViewDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const strip = document.getElementById('date-strip');
    strip.innerHTML = '';

    for (let i = 0; i < 7; i++) {
        let d = new Date(currentViewDate);
        d.setDate(d.getDate() + i);
        const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
        strip.innerHTML += `
            <div class="date-item ${isWeekend ? 'is-weekend' : ''}">
                <div class="day-name">${d.toLocaleDateString('en-GB', { weekday: 'narrow' })}</div>
                <div class="date-num">${d.getDate()}</div>
            </div>
        `;
    }
}

async function renderMeals() {
    const container = document.getElementById('calendar-wrapper');
    container.innerHTML = ''; // Clear for re-render
    
    const weekPage = document.createElement('div');
    weekPage.className = 'week-page';

    for (let i = 0; i < 7; i++) {
        let d = new Date(currentViewDate);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];

        const card = document.createElement('div');
        card.className = 'date-card';
        card.innerHTML = `
            <div class="card-header">
                <span class="card-label">${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' })}</span>
                <button class="clear-btn">×</button>
            </div>
            <input type="text" list="meal-options" placeholder="Plan dinner..." autocomplete="off">
        `;
        
        const input = card.querySelector('input');
        const clearBtn = card.querySelector('.clear-btn');

        // Load existing meal
        const { data } = await _supabase.from('calendar').select('meal_name').eq('date', dateStr).maybeSingle();
        if (data) input.value = data.meal_name;

        // Save/Delete Logic
        input.onchange = async () => {
            const val = input.value.trim();
            if (val === "") {
                await _supabase.from('calendar').delete().eq('date', dateStr);
            } else {
                await _supabase.from('meals').upsert({ name: val }, { onConflict: 'name' });
                await _supabase.from('calendar').upsert({ date: dateStr, meal_name: val });
                updateMealDatalist();
            }
        };

        input.onfocus = () => updateMealDatalist();
        clearBtn.onclick = () => { input.value = ""; input.onchange(); };
        
        weekPage.appendChild(card);
    }
    container.appendChild(weekPage);
}

async function updateMealDatalist() {
    const { data } = await _supabase.from('meals').select('name');
    if (data) {
        document.getElementById('meal-options').innerHTML = data.map(m => `<option value="${m.name}">`).join('');
    }
}

// Simple Nav buttons for swiping (Instead of complex Swiper library)
window.moveWeek = (days) => {
    currentViewDate.setDate(currentViewDate.getDate() + days);
    renderUI();
};

init();
