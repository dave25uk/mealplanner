const supabaseUrl = 'https://qysscushyrhgrodlpovg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5c3NjdXNoeXJoZ3JvZGxwb3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE3NzEsImV4cCI6MjA5MTM5Nzc3MX0.1KMpTrpzmi6d-r3nbPzGunpiYHkAjpUxuB32RtAlJqI';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let currentViewDate = new Date();
let touchstartX = 0;
let touchendX = 0;

async function init() {
    renderUI();
    updateMealDatalist();

    const gestureArea = document.getElementById('calendar-container');
    gestureArea.addEventListener('touchstart', e => { touchstartX = e.changedTouches[0].screenX; }, {passive: true});
    gestureArea.addEventListener('touchend', e => { 
        touchendX = e.changedTouches[0].screenX; 
        if (touchendX < touchstartX - 70) moveWeek(7);
        if (touchendX > touchstartX + 70) moveWeek(-7);
    }, {passive: true});

    window.addEventListener('focusin', (e) => {
        if (e.target.tagName === 'INPUT') document.body.classList.add('keyboard-open');
    });
    window.addEventListener('focusout', (e) => {
        if (e.target.tagName === 'INPUT') document.body.classList.remove('keyboard-open');
    });
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
    const wrapper = document.getElementById('calendar-wrapper');
    wrapper.innerHTML = '';

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

        const { data } = await _supabase.from('calendar').select('meal_name').eq('date', dateStr).maybeSingle();
        if (data) input.value = data.meal_name;

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
        wrapper.appendChild(card);
    }
}

async function updateMealDatalist() {
    const { data } = await _supabase.from('meals').select('name');
    if (data) document.getElementById('meal-options').innerHTML = data.map(m => `<option value="${m.name}">`).join('');
}

window.moveWeek = (days) => {
    currentViewDate.setDate(currentViewDate.getDate() + days);
    renderUI();
    document.getElementById('calendar-container').scrollTop = 0;
};

async function openMealEditor() {
    document.getElementById('meal-modal').style.display = 'block';
    const { data } = await _supabase.from('meals').select('*').order('name');
    document.getElementById('meal-list-edit').innerHTML = data.map(m => `
        <div style="display:flex; justify-content:space-between; padding: 15px 0; border-bottom: 1px solid #eee; align-items:center;">
            <span style="font-size: 17px;">${m.name}</span>
            <button onclick="deleteMeal('${m.name}')" style="color:#ff3b30; border:none; background:none; font-weight:600; font-size:15px;">Delete</button>
        </div>
    `).join('');
}

async function deleteMeal(name) {
    if(confirm(`Delete "${name}"?`)) {
        await _supabase.from('meals').delete().eq('name', name);
        openMealEditor();
    }
}

window.closeMealEditor = () => { 
    document.getElementById('meal-modal').style.display = 'none'; 
};

init();