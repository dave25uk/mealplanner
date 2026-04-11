const supabaseUrl = 'https://qysscushyrhgrodlpovg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5c3NjdXNoeXJoZ3JvZGxwb3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE3NzEsImV4cCI6MjA5MTM5Nzc3MX0.1KMpTrpzmi6d-r3nbPzGunpiYHkAjpUxuB32RtAlJqI';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let currentViewDate = new Date();
let touchstartX = 0;
let touchendX = 0;
let activePickerDate = null;

async function init() {
    renderUI();
    
    const gestureArea = document.getElementById('calendar-container');
    
    gestureArea.addEventListener('touchstart', e => { 
        touchstartX = e.changedTouches[0].screenX; 
    }, {passive: true});
    
    gestureArea.addEventListener('touchend', e => { 
        touchendX = e.changedTouches[0].screenX; 
        if (touchendX < touchstartX - 70) moveWeek(7);
        if (touchendX > touchstartX + 70) moveWeek(-7);
    }, {passive: true});

    document.addEventListener('touchmove', function (e) {
        if (e.target.closest('.modal-content') || e.target.closest('#calendar-container')) {
            return;
        }
        e.preventDefault();
    }, { passive: false });
}

window.moveWeek = (days) => {
    currentViewDate.setDate(currentViewDate.getDate() + days);
    renderUI();
};

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

    let dStart = new Date(currentViewDate);
    let dEnd = new Date(currentViewDate);
    dEnd.setDate(dEnd.getDate() + 6);

    const { data: savedMeals } = await _supabase.from('calendar')
        .select('date, meal_name')
        .gte('date', dStart.toISOString().split('T')[0])
        .lte('date', dEnd.toISOString().split('T')[0]);

    for (let i = 0; i < 7; i++) {
        let d = new Date(currentViewDate);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const mealEntry = savedMeals?.find(m => m.date === dateStr);

        const card = document.createElement('div');
        card.className = 'date-card';
        card.innerHTML = `
            <div class="card-header">
                <span class="card-label">${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' })}</span>
                <button class="clear-btn">×</button>
            </div>
            <div class="meal-display ${!mealEntry ? 'empty' : ''}">${mealEntry ? mealEntry.meal_name : 'Plan dinner...'}</div>
        `;
        
        const display = card.querySelector('.meal-display');
        const clearBtn = card.querySelector('.clear-btn');

        display.onclick = () => openPicker(dateStr, d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' }));
        clearBtn.onclick = (e) => { e.stopPropagation(); deleteEntry(dateStr); };
        wrapper.appendChild(card);
    }
}

async function openPicker(dateStr, readableDate) {
    activePickerDate = dateStr;
    const modal = document.getElementById('picker-modal');
    const input = document.getElementById('meal-search-input');
    const list = document.getElementById('meal-selection-list');
    
    document.getElementById('picker-date-label').innerText = readableDate;
    input.value = '';
    modal.style.display = 'block';
    input.focus();

    const { data: allMeals } = await _supabase.from('meals').select('name').order('name');

    const renderFilteredList = (filter = '') => {
        const filtered = allMeals.filter(m => 
            m.name.toLowerCase().includes(filter.toLowerCase())
        );

        list.innerHTML = filtered.map(m => `
            <div class="picker-item" onclick="selectMeal('${m.name.replace(/'/g, "\\'")}')">${m.name}</div>
        `).join('');

        if (filter.trim() !== '' && !allMeals.some(m => m.name.toLowerCase() === filter.toLowerCase())) {
            list.innerHTML = `
                <div class="picker-item" style="color: var(--accent); font-weight: 600;" onclick="selectMeal('${filter.replace(/'/g, "\\'")}')">
                    + Add "${filter}"
                </div>
            ` + list.innerHTML;
        }
    };

    input.oninput = (e) => renderFilteredList(e.target.value);
    renderFilteredList(); 

    input.onkeydown = (e) => {
        if (e.key === 'Enter' && input.value.trim() !== '') {
            selectMeal(input.value.trim());
        }
    };
}

window.selectMeal = async (name) => {
    let rawName = name.trim();
    if (!rawName) return;

    // Convert to Sentence case (e.g., "spicy tacos" -> "Spicy tacos")
    const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

    // Case-insensitive check in Supabase
    const { data: existing } = await _supabase
        .from('meals')
        .select('name')
        .ilike('name', formattedName) // 'ilike' is the Postgres case-insensitive operator
        .maybeSingle();

    if (!existing) {
        // Only insert if it doesn't exist in any case format
        await _supabase.from('meals').insert({ name: formattedName });
    }

    // Use the existing name format if found, otherwise use our new one
    const finalName = existing ? existing.name : formattedName;

    await _supabase.from('calendar').upsert({ 
        date: activePickerDate, 
        meal_name: finalName 
    });

    closePicker();
    renderMeals();
};

async function deleteEntry(dateStr) {
    // Added confirmation dialog
    if (confirm("Are you sure you want to remove this meal from the calendar?")) {
        await _supabase.from('calendar').delete().eq('date', dateStr);
        renderMeals();
    }
}

window.closePicker = () => { document.getElementById('picker-modal').style.display = 'none'; };

window.openMealEditor = async () => {
    document.getElementById('meal-modal').style.display = 'block';
    const { data } = await _supabase.from('meals').select('*').order('name');
    const container = document.getElementById('meal-list-edit');
    container.innerHTML = `
        <div style="display:flex; gap:10px; margin-bottom:15px;">
            <input type="text" id="new-meal-input" placeholder="New meal..." style="flex-grow:1; padding:10px; border:1px solid #ddd; border-radius:8px;">
            <button onclick="addNewMeal()" style="background:var(--accent); color:white; border:none; padding:10px; border-radius:8px; font-weight:600;">Add</button>
        </div>
    ` + data.map(m => `
        <div style="display:flex; justify-content:space-between; padding:12px 0; border-bottom:1px solid #eee; align-items:center;">
            <span>${m.name}</span>
            <button onclick="deleteFromMaster('${m.name.replace(/'/g, "\\'")}')" style="color:#ff3b30; border:none; background:none; font-weight:600;">Delete</button>
        </div>
    `).join('');
};

window.addNewMeal = async () => {
    const input = document.getElementById('new-meal-input');
    const name = input.value.trim();
    if (name) {
        await _supabase.from('meals').upsert({ name: name });
        input.value = '';
        openMealEditor();
    }
};

window.deleteFromMaster = async (name) => {
    if(confirm(`Delete "${name}"?`)) {
        await _supabase.from('meals').delete().eq('name', name);
        openMealEditor();
    }
};

window.closeMealEditor = () => { document.getElementById('meal-modal').style.display = 'none'; };

init();