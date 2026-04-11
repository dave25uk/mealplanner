const supabaseUrl = 'https://qysscushyrhgrodlpovg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5c3NjdXNoeXJoZ3JvZGxwb3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE3NzEsImV4cCI6MjA5MTM5Nzc3MX0.1KMpTrpzmi6d-r3nbPzGunpiYHkAjpUxuB32RtAlJqI';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let currentViewDate = new Date();
let touchstartX = 0;
let touchendX = 0;
let activePickerDate = null; // Tracks which day we are currently planning

async function init() {
    renderUI();
    const gestureArea = document.getElementById('calendar-container');
    gestureArea.addEventListener('touchstart', e => { touchstartX = e.changedTouches[0].screenX; }, {passive: true});
    gestureArea.addEventListener('touchend', e => { 
        touchendX = e.changedTouches[0].screenX; 
        if (touchendX < touchstartX - 70) moveWeek(7);
        if (touchendX > touchstartX + 70) moveWeek(-7);
    }, {passive: true});
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
            <div class="meal-display empty" id="display-${dateStr}">Plan dinner...</div>
        `;
        
        const display = card.querySelector('.meal-display');
        const clearBtn = card.querySelector('.clear-btn');

        const { data } = await _supabase.from('calendar').select('meal_name').eq('date', dateStr).maybeSingle();
        if (data && data.meal_name) {
            display.innerText = data.meal_name;
            display.classList.remove('empty');
        }

        display.onclick = () => openPicker(dateStr, d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' }));
        clearBtn.onclick = (e) => { 
            e.stopPropagation(); 
            deleteEntry(dateStr); 
        };
        wrapper.appendChild(card);
    }
}

async function openPicker(dateStr, readableDate) {
    activePickerDate = dateStr;
    document.getElementById('picker-date-label').innerText = readableDate;
    document.getElementById('picker-modal').style.display = 'block';
    
    const { data } = await _supabase.from('meals').select('name').order('name');
    const list = document.getElementById('meal-selection-list');
    list.innerHTML = data.map(m => `
        <div class="picker-item" onclick="selectMeal('${m.name}')">${m.name}</div>
    `).join('');
}

async function selectMeal(name) {
    await _supabase.from('calendar').upsert({ date: activePickerDate, meal_name: name });
    closePicker();
    renderMeals();
}

async function deleteEntry(dateStr) {
    await _supabase.from('calendar').delete().eq('date', dateStr);
    renderMeals();
}

function closePicker() {
    document.getElementById('picker-modal').style.display = 'none';
    activePickerDate = null;
}

// Master List Management
async function openMealEditor() {
    document.getElementById('meal-modal').style.display = 'block';
    const { data } = await _supabase.from('meals').select('*').order('name');
    document.getElementById('meal-list-edit').innerHTML = `
        <div style="margin-bottom: 20px;">
            <input type="text" id="new-meal-input" placeholder="Add new meal..." 
                   style="border: 1px solid #ccc; border-radius: 8px; padding: 10px; width: calc(100% - 60px);">
            <button onclick="addNewMeal()" style="padding: 10px; border-radius: 8px; background: var(--accent); color:white; border:none;">Add</button>
        </div>
    ` + data.map(m => `
        <div style="display:flex; justify-content:space-between; padding: 15px 0; border-bottom: 1px solid #eee; align-items:center;">
            <span>${m.name}</span>
            <button onclick="deleteFromMaster('${m.name}')" style="color:red; border:none; background:none; font-weight:600;">Delete</button>
        </div>
    `).join('');
}

async function addNewMeal() {
    const input = document.getElementById('new-meal-input');
    const name = input.value.trim();
    if (name) {
        await _supabase.from('meals').upsert({ name: name });
        input.value = '';
        openMealEditor();
    }
}

async function deleteFromMaster(name) {
    if(confirm(`Remove "${name}" from master list?`)) {
        await _supabase.from('meals').delete().eq('name', name);
        openMealEditor();
    }
}

function closeMealEditor() {
    document.getElementById('meal-modal').style.display = 'none';
}

init();