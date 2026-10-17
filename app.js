const supabaseUrl = 'https://qysscushyrhgrodlpovg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5c3NjdXNoeXJoZ3JvZGxwb3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE3NzEsImV4cCI6MjA5MTM5Nzc3MX0.1KMpTrpzmi6d-r3nbPzGunpiYHkAjpUxuB32RtAlJqI';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let currentViewDate = new Date();
let touchstartX = 0;
let touchendX = 0;
let suppressClick = false;
let activePickerDate = null;
let activeNoteDate = null;

// ---------------- Utilities ----------------

function toLocalISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseLocalISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function todayISO() { return toLocalISO(new Date()); }

function formatMealName(raw) {
    return raw.trim().toLowerCase().split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

function getSimilarMeals(newName, existingMeals) {
    const normalize = s => s.toLowerCase().replace(/ & /g, ' and ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const target = normalize(newName);
    if (!target) return [];

    const getWords = str => str.split(' ').filter(w => w.length >= 4);
    const targetWords = getWords(target);

    return existingMeals.filter(m => {
        const current = normalize(m.name);
        if (current === target) return true;
        const currentWords = getWords(current);
        
        if (targetWords.length === 0) return current.includes(target);

        let overlap = 0;
        for (const tw of targetWords) {
            if (currentWords.some(cw => {
                if (tw === cw) return true;
                if (tw.startsWith(cw) || cw.startsWith(tw)) return true;
                return false;
            })) overlap++;
        }

        if (overlap > 0) return true;
        if (current.includes(target) || target.includes(current)) return true;
        return false;
    });
}

// ---------------- Toast ----------------

let toastTimer;
function showToast(message, isError = false) {
    let el = document.getElementById('toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.className = 'toast';
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle('error', isError);
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ---------------- Offline queue ----------------

const QUEUE_KEY = 'mealPlannerQueue';

function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
    catch { return []; }
}

function setQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

function opKey(op) {
    if (op.type === 'upsert-calendar' || op.type === 'delete-calendar') {
        return 'calendar::' + op.payload.date;
    }
    if (op.type === 'upsert-note') {
        return 'note::' + op.payload.date;
    }
    if (op.type === 'insert-meal' || op.type === 'delete-meal') {
        return 'meal::' + (op.payload.name || '').toLowerCase();
    }
    return JSON.stringify(op);
}

function enqueue(op) {
    const q = getQueue().filter(o => opKey(o) !== opKey(op));
    q.push(op);
    setQueue(q);
}

function removeFromQueue(op) {
    setQueue(getQueue().filter(o => opKey(o) !== opKey(op)));
}

async function flushQueue() {
    if (!navigator.onLine) return;
    const q = getQueue();
    if (q.length === 0) return;

    const remaining = [];
    for (const op of q) {
        try {
            let error = null;
            if (op.type === 'upsert-calendar') {
                ({ error } = await _supabase.from('calendar').upsert(op.payload));
            } else if (op.type === 'delete-calendar') {
                ({ error } = await _supabase.from('calendar').delete().eq('date', op.payload.date));
            } else if (op.type === 'upsert-note') {
                ({ error } = await _supabase.from('calendar').update({ note: op.payload.note }).eq('date', op.payload.date));
            } else if (op.type === 'insert-meal') {
                ({ error } = await _supabase.from('meals').insert(op.payload));
                if (error && error.code === '23505') error = null;
            } else if (op.type === 'delete-meal') {
                ({ error } = await _supabase.from('meals').delete().eq('name', op.payload.name));
            }
            if (error) throw error;
        } catch (e) {
            console.warn('Queue flush failed for', op, e);
            remaining.push(op);
        }
    }
    setQueue(remaining);

    if (remaining.length === 0 && q.length > 0) {
        showToast('Synced offline changes');
        renderMeals();
    }
}

window.addEventListener('online', flushQueue);

// ---------------- Local caches ----------------

const CACHE_KEY = 'mealPlannerCache';
const MEALS_CACHE_KEY = 'mealPlannerMeals';

function getCache() {
    try {
        const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        // Handle upgrade from old string-based cache to object-based
        for (const key in cache) {
            if (typeof cache[key] === 'string') {
                cache[key] = { meal_name: cache[key], note: null };
            }
        }
        return cache;
    }
    catch { return {}; }
}
function setCache(c) { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); }

function getMealsCache() {
    try { return JSON.parse(localStorage.getItem(MEALS_CACHE_KEY) || '[]'); }
    catch { return []; }
}
function setMealsCache(m) { localStorage.setItem(MEALS_CACHE_KEY, JSON.stringify(m)); }

// ---------------- Init ----------------

async function init() {
    currentViewDate.setHours(0, 0, 0, 0);

    try {
        await _supabase.auth.signInAnonymously();
    } catch (err) {
        console.warn("Anonymous auth failed. Ensure it's enabled in Supabase.", err);
    }

    _supabase.channel('calendar_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar' }, payload => {
            const changedDate = payload.new?.date || payload.old?.date;
            if (!changedDate) return;

            const dStart = new Date(currentViewDate);
            const dEnd = new Date(currentViewDate);
            dEnd.setDate(dEnd.getDate() + 6);
            const startISO = toLocalISO(dStart);
            const endISO = toLocalISO(dEnd);

            if (changedDate >= startISO && changedDate <= endISO) {
                renderMeals(); 
            }
        })
        .subscribe();

    document.querySelectorAll('.nav-arrow').forEach(btn => {
        btn.addEventListener('click', () => moveWeek(btn.dataset.dir === 'prev' ? -7 : 7));
    });

    document.getElementById('manage-meals-btn').addEventListener('click', openMealEditor);
    document.getElementById('popular-btn').addEventListener('click', openPopular);
    document.getElementById('random-meal-btn').addEventListener('click', pickRandomMeal);
    document.getElementById('save-note-btn').addEventListener('click', saveNote);

    document.getElementById('popular-range-selector').addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (btn && btn.dataset.range && btn.dataset.range !== currentPopularRange) {
            renderPopularList(btn.dataset.range);
        }
    });

    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById(btn.dataset.close).style.display = 'none';
            if (btn.dataset.close === 'picker-modal') activePickerDate = null;
            if (btn.dataset.close === 'note-modal') activeNoteDate = null;
        });
    });

    const gestureArea = document.getElementById('calendar-container');
    gestureArea.addEventListener('touchstart', e => {
        touchstartX = e.changedTouches[0].screenX;
    }, { passive: true });
    gestureArea.addEventListener('touchend', e => {
        touchendX = e.changedTouches[0].screenX;
        if (touchendX < touchstartX - 70) { suppressClick = true; moveWeek(7); }
        if (touchendX > touchstartX + 70) { suppressClick = true; moveWeek(-7); }
        if (suppressClick) setTimeout(() => { suppressClick = false; }, 350);
    }, { passive: true });

    document.getElementById('calendar-wrapper').addEventListener('click', e => {
        if (suppressClick) return;
        
        const card = e.target.closest('.date-card');
        if (!card) return;
        const dateStr = card.dataset.date;

        if (e.target.closest('[data-action="clear"]')) {
            deleteEntry(dateStr);
        } else if (e.target.closest('[data-action="note"]')) {
            openNoteEditor(dateStr);
        } else if (e.target.closest('[data-action="pick"]')) {
            openPicker(
                dateStr,
                parseLocalISO(dateStr).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' })
            );
        }
    });

    document.getElementById('meal-selection-list').addEventListener('click', e => {
        const item = e.target.closest('.picker-item');
        if (!item) return;
        const name = item.dataset.newMeal || item.dataset.meal;
        if (name) selectMeal(name);
    });

    document.getElementById('meal-list-edit').addEventListener('click', e => {
        if (e.target.id === 'add-meal-btn') {
            addNewMeal();
        } else if (e.target.id === 'toggle-merge-btn') {
            isMergeMode = !isMergeMode;
            selectedMergeMeals.clear();
            openMealEditor();
        } else if (e.target.id === 'confirm-merge-btn') {
            if (selectedMergeMeals.size >= 2) {
                mergeMeals(Array.from(selectedMergeMeals));
            }
        } else if (e.target.classList.contains('editor-delete')) {
            deleteFromMaster(e.target.dataset.meal);
        }
    });

    document.getElementById('meal-list-edit').addEventListener('change', e => {
        if (e.target.classList.contains('merge-checkbox')) {
            if (e.target.checked) selectedMergeMeals.add(e.target.value);
            else selectedMergeMeals.delete(e.target.value);
            updateMergeBtn();
        }
    });

    document.addEventListener('touchmove', e => {
        if (e.target.closest('.modal-content') || e.target.closest('#calendar-container')) return;
        e.preventDefault();
    }, { passive: false });

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch(err => console.warn(err));
        });
    }

    renderUI();
    flushQueue();
}

// ---------------- Navigation ----------------

function moveWeek(days) {
    currentViewDate.setDate(currentViewDate.getDate() + days);
    renderUI();
}

function renderUI() {
    renderHeader();
    renderMeals();
}

function renderHeader() {
    document.getElementById('month-label').innerText =
        currentViewDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    const strip = document.getElementById('date-strip');
    strip.innerHTML = '';
    const today = todayISO();

    for (let i = 0; i < 7; i++) {
        const d = new Date(currentViewDate);
        d.setDate(d.getDate() + i);
        const dateStr = toLocalISO(d);
        const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
        const isToday = dateStr === today;

        const el = document.createElement('div');
        el.className = 'date-item' + (isWeekend ? ' is-weekend' : '') + (isToday ? ' is-today' : '');

        const nameEl = document.createElement('div');
        nameEl.className = 'day-name';
        nameEl.textContent = d.toLocaleDateString('en-GB', { weekday: 'narrow' });

        const numEl = document.createElement('div');
        numEl.className = 'date-num';
        numEl.textContent = d.getDate();

        el.appendChild(nameEl);
        el.appendChild(numEl);
        strip.appendChild(el);
    }
}

// ---------------- Meal list ----------------

async function renderMeals() {
    const wrapper = document.getElementById('calendar-wrapper');
    wrapper.innerHTML = '';

    const dStart = new Date(currentViewDate);
    const dEnd = new Date(currentViewDate);
    dEnd.setDate(dEnd.getDate() + 6);
    const startISO = toLocalISO(dStart);
    const endISO = toLocalISO(dEnd);

    let savedMeals = [];
    const cache = getCache();

    if (navigator.onLine) {
        const { data, error } = await _supabase.from('calendar')
            .select('date, meal_name, note')
            .gte('date', startISO)
            .lte('date', endISO);

        if (error) {
            showToast('Could not load meals', true);
        } else {
            savedMeals = data || [];
            const newCache = { ...cache };
            for (let i = 0; i < 7; i++) {
                const d = new Date(currentViewDate);
                d.setDate(d.getDate() + i);
                delete newCache[toLocalISO(d)];
            }
            for (const m of savedMeals) newCache[m.date] = { meal_name: m.meal_name, note: m.note };
            setCache(newCache);
        }
    } else {
        for (let i = 0; i < 7; i++) {
            const d = new Date(currentViewDate);
            d.setDate(d.getDate() + i);
            const k = toLocalISO(d);
            if (cache[k]) savedMeals.push({ date: k, ...cache[k] });
        }
    }

    const pending = {};
    for (const op of getQueue()) {
        const date = op.payload.date;
        if (!date || date < startISO || date > endISO) continue;
        
        if (!pending[date]) pending[date] = {};
        if (op.type === 'upsert-calendar') pending[date].meal_name = op.payload.meal_name;
        else if (op.type === 'delete-calendar') pending[date].meal_name = null;
        else if (op.type === 'upsert-note') pending[date].note = op.payload.note;
    }

    const today = todayISO();

    for (let i = 0; i < 7; i++) {
        const d = new Date(currentViewDate);
        d.setDate(d.getDate() + i);
        const dateStr = toLocalISO(d);

        let entry = savedMeals.find(m => m.date === dateStr) || {};
        if (dateStr in pending) {
            entry = { ...entry, ...pending[dateStr] };
        }

        const mealName = entry.meal_name;
        const note = entry.note;

        const isToday = dateStr === today;
        const card = document.createElement('div');
        card.className = 'date-card' + (isToday ? ' is-today' : '');
        card.dataset.date = dateStr;

        const header = document.createElement('div');
        header.className = 'card-header';

        const label = document.createElement('span');
        label.className = 'card-label';
        label.textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' }) + (isToday ? ' · Today' : '');

        const actions = document.createElement('div');
        actions.className = 'card-actions';

        if (mealName) {
            const noteBtn = document.createElement('button');
            noteBtn.className = 'note-btn' + (note && note.trim() !== '' ? ' has-note' : '');
            noteBtn.dataset.action = 'note';
            noteBtn.setAttribute('aria-label', 'Edit note');
            // Notepad SVG icon
            noteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
            </svg>`;
            actions.appendChild(noteBtn);
        }

        const clearBtn = document.createElement('button');
        clearBtn.className = 'clear-btn';
        clearBtn.dataset.action = 'clear';
        clearBtn.setAttribute('aria-label', 'Clear meal');
        clearBtn.textContent = '×';
        actions.appendChild(clearBtn);

        header.appendChild(label);
        header.appendChild(actions);

        const display = document.createElement('div');
        display.className = 'meal-display' + (mealName ? '' : ' empty');
        display.dataset.action = 'pick';
        display.textContent = mealName || 'Plan dinner...';

        card.appendChild(header);
        card.appendChild(display);
        wrapper.appendChild(card);
    }
}

// ---------------- Note Editor ----------------

function openNoteEditor(dateStr) {
    activeNoteDate = dateStr;
    const modal = document.getElementById('note-modal');
    const input = document.getElementById('note-input');
    const label = document.getElementById('note-date-label');
    
    const cache = getCache();
    const existingNote = cache[dateStr]?.note || '';

    label.textContent = 'Note · ' + parseLocalISO(dateStr).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric' });
    input.value = existingNote;
    modal.style.display = 'block';
    setTimeout(() => input.focus(), 50);
}

async function saveNote() {
    const dateStr = activeNoteDate;
    if (!dateStr) return;

    const input = document.getElementById('note-input');
    const noteText = input.value.trim();
    
    document.getElementById('note-modal').style.display = 'none';
    activeNoteDate = null;

    // Optimistic UI
    enqueue({ type: 'upsert-note', payload: { date: dateStr, note: noteText || null } });
    renderMeals();

    if (navigator.onLine) {
        const { error } = await _supabase.from('calendar').update({ note: noteText || null }).eq('date', dateStr);
        if (error) {
            showToast(`Failed to save note: ${error.message}`, true);
        } else {
            removeFromQueue({ type: 'upsert-note', payload: { date: dateStr } });
            renderMeals();
        }
    } else {
        showToast('Note saved offline — will sync');
    }
}

// ---------------- Picker ----------------

async function openPicker(dateStr, readableDate) {
    activePickerDate = dateStr;
    const modal = document.getElementById('picker-modal');
    const input = document.getElementById('meal-search-input');
    const list = document.getElementById('meal-selection-list');

    document.getElementById('picker-date-label').innerText = readableDate;
    input.value = '';
    modal.style.display = 'block';
    setTimeout(() => input.focus(), 50);

    let allMeals = [];

    if (navigator.onLine) {
        const { data, error } = await _supabase.from('meals').select('name').order('name');
        if (error) {
            showToast('Could not load meal list', true);
            allMeals = getMealsCache();
        } else {
            allMeals = data || [];
            setMealsCache(allMeals);
        }
    } else {
        allMeals = getMealsCache();
    }

    for (const op of getQueue()) {
        if (op.type === 'insert-meal') {
            if (!allMeals.some(m => m.name.toLowerCase() === op.payload.name.toLowerCase())) {
                allMeals.push({ name: op.payload.name });
            }
        } else if (op.type === 'delete-meal') {
            allMeals = allMeals.filter(m => m.name.toLowerCase() !== op.payload.name.toLowerCase());
        }
    }

    const renderFilteredList = (filter = '') => {
        list.innerHTML = '';
        const trimmed = filter.trim();
        const lower = trimmed.toLowerCase();
        const filtered = allMeals.filter(m => m.name.toLowerCase().includes(lower));

        if (trimmed !== '' && !allMeals.some(m => m.name.toLowerCase() === lower)) {
            const add = document.createElement('div');
            add.className = 'picker-item add-new';
            add.dataset.newMeal = trimmed;
            add.textContent = `+ Add "${trimmed}"`;
            list.appendChild(add);
        }

        for (const m of filtered) {
            const el = document.createElement('div');
            el.className = 'picker-item';
            el.dataset.meal = m.name;
            el.textContent = m.name;
            list.appendChild(el);
        }
    };

    input.oninput = e => renderFilteredList(e.target.value);
    input.onkeydown = e => {
        if (e.key === 'Enter' && input.value.trim() !== '') {
            selectMeal(input.value.trim());
        }
    };
    renderFilteredList();
}

function pickRandomMeal() {
    const allMeals = getMealsCache();
    if (allMeals.length === 0) {
        showToast('No meals to choose from', true);
        return;
    }
    const randomMeal = allMeals[Math.floor(Math.random() * allMeals.length)].name;
    selectMeal(randomMeal);
}

async function selectMeal(name) {
    const rawName = name.trim();
    if (!rawName) return;

    const formattedName = formatMealName(rawName);
    let finalName = formattedName;
    
    const targetDate = activePickerDate;
    if (!targetDate) return;

    closePicker();

    // Preserve any existing note for this day
    const cache = getCache();
    const existingNote = cache[targetDate]?.note || null;

    // Optimistic UI: Enqueue immediately so renderMeals picks it up
    enqueue({ type: 'upsert-calendar', payload: { date: targetDate, meal_name: finalName, note: existingNote } });
    renderMeals();

    if (navigator.onLine) {
        const { data: existing } = await _supabase.from('meals').select('name').ilike('name', formattedName).maybeSingle();
        
        if (existing) {
            finalName = existing.name;
            enqueue({ type: 'upsert-calendar', payload: { date: targetDate, meal_name: finalName, note: existingNote } });
            renderMeals();
        } else {
            await _supabase.from('meals').insert({ name: formattedName });
        }

        const { error: upsertError } = await _supabase.from('calendar').upsert({
            date: targetDate,
            meal_name: finalName,
            note: existingNote
        });

        if (upsertError) {
            console.error("Upsert error:", upsertError);
            removeFromQueue({ type: 'upsert-calendar', payload: { date: targetDate } });
            renderMeals();
            showToast(`Save failed: ${upsertError.message}`, true);
        } else {
            removeFromQueue({ type: 'upsert-calendar', payload: { date: targetDate } });
            renderMeals();
        }
    } else {
        showToast('Saved offline — will sync');
    }
}

function closePicker() {
    document.getElementById('picker-modal').style.display = 'none';
    activePickerDate = null;
}

// ---------------- Calendar delete ----------------

async function deleteEntry(dateStr) {
    if (!confirm('Are you sure you want to remove this meal from the calendar?')) return;

    enqueue({ type: 'delete-calendar', payload: { date: dateStr } });
    renderMeals();

    if (navigator.onLine) {
        const { error } = await _supabase.from('calendar').delete().eq('date', dateStr);
        if (error) {
            console.error("Delete error:", error);
            removeFromQueue({ type: 'delete-calendar', payload: { date: dateStr } });
            renderMeals();
            showToast(`Could not delete: ${error.message}`, true);
            return;
        }
        removeFromQueue({ type: 'delete-calendar', payload: { date: dateStr } });
        renderMeals();
    } else {
        showToast('Deleted offline — will sync');
    }
}

// ---------------- Master meal editor ----------------

let isMergeMode = false;
let selectedMergeMeals = new Set();

async function openMealEditor() {
    document.getElementById('meal-modal').style.display = 'block';
    const container = document.getElementById('meal-list-edit');
    container.innerHTML = '';

    const addRow = document.createElement('div');
    addRow.className = 'editor-add-row';
    addRow.style.display = isMergeMode ? 'none' : 'flex';
    addRow.innerHTML = `
        <input type="text" id="new-meal-input" placeholder="New meal..." class="editor-input">
        <button id="add-meal-btn" class="editor-add-btn">Add</button>
    `;
    container.appendChild(addRow);

    const mergeHeader = document.createElement('div');
    mergeHeader.style.display = 'flex';
    mergeHeader.style.justifyContent = 'space-between';
    mergeHeader.style.alignItems = 'center';
    mergeHeader.style.marginBottom = '15px';
    mergeHeader.innerHTML = `
        <button id="toggle-merge-btn" class="toggle-merge-btn">
            ${isMergeMode ? 'Cancel Merge' : 'Combine / Merge Meals'}
        </button>
        <button id="confirm-merge-btn" class="confirm-merge-btn" style="display:${isMergeMode ? 'block' : 'none'};" disabled>
            Merge Selected (0)
        </button>
    `;
    container.appendChild(mergeHeader);

    let meals = [];

    if (navigator.onLine) {
        const { data, error } = await _supabase.from('meals').select('*').order('name');
        if (error) {
            showToast('Could not load meals', true);
            meals = getMealsCache();
        } else {
            meals = data || [];
            setMealsCache(meals);
        }
    } else {
        meals = getMealsCache();
        if (meals.length === 0) showToast('Offline — no cached meals');
    }

    for (const op of getQueue()) {
        if (op.type === 'insert-meal') {
            if (!meals.some(m => m.name.toLowerCase() === op.payload.name.toLowerCase())) {
                meals.push({ name: op.payload.name });
            }
        } else if (op.type === 'delete-meal') {
            meals = meals.filter(m => m.name.toLowerCase() !== op.payload.name.toLowerCase());
        }
    }
    meals.sort((a, b) => a.name.localeCompare(b.name));

    const listEl = document.createElement('div');
    listEl.id = 'meal-list-items';

    for (const m of meals) {
        const row = document.createElement('div');
        row.className = 'editor-row';

        if (isMergeMode) {
            const label = document.createElement('label');
            label.className = 'merge-label';
            
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'merge-checkbox';
            cb.value = m.name;
            cb.checked = selectedMergeMeals.has(m.name);
            
            const span = document.createElement('span');
            span.textContent = m.name;
            
            label.appendChild(cb);
            label.appendChild(span);
            row.appendChild(label);
        } else {
            const span = document.createElement('span');
            span.textContent = m.name;
            row.appendChild(span);

            const btn = document.createElement('button');
            btn.className = 'editor-delete';
            btn.dataset.meal = m.name;
            btn.textContent = 'Delete';
            row.appendChild(btn);
        }

        listEl.appendChild(row);
    }

    container.appendChild(listEl);
    updateMergeBtn();
}

function updateMergeBtn() {
    const btn = document.getElementById('confirm-merge-btn');
    if (btn) {
        btn.textContent = `Merge Selected (${selectedMergeMeals.size})`;
        btn.disabled = selectedMergeMeals.size < 2;
    }
}

async function addNewMeal() {
    const input = document.getElementById('new-meal-input');
    const name = input.value.trim();
    if (!name) return;

    const formatted = formatMealName(name);

    if (navigator.onLine) {
        const { data: allMeals } = await _supabase.from('meals').select('name');
        if (allMeals) {
            const similar = getSimilarMeals(formatted, allMeals);
            if (similar.length > 0) {
                const similarNames = similar.slice(0, 4).map(m => m.name).join(', ') + (similar.length > 4 ? ` and ${similar.length - 4} more` : '');
                if (!confirm(`Similar meal(s) exist:\n\n${similarNames}\n\nAdd "${formatted}" anyway?`)) {
                    return;
                }
            }
        }

        const { error } = await _supabase.from('meals').insert({ name: formatted });
        if (error && error.code !== '23505') {
            showToast(`Could not add meal: ${error.message}`, true);
            return;
        }
    } else {
        const localMeals = getMealsCache();
        const similar = getSimilarMeals(formatted, localMeals);
        if (similar.length > 0) {
            const similarNames = similar.slice(0, 4).map(m => m.name).join(', ') + (similar.length > 4 ? ` and ${similar.length - 4} more` : '');
            if (!confirm(`Similar meal(s) exist:\n\n${similarNames}\n\nAdd "${formatted}" anyway?`)) {
                return;
            }
        }
        enqueue({ type: 'insert-meal', payload: { name: formatted } });
        showToast('Saved offline — will sync');
    }

    openMealEditor();
}

async function deleteFromMaster(name) {
    let count = 0;
    if (navigator.onLine) {
        const { count: c, error } = await _supabase
            .from('calendar')
            .select('*', { count: 'exact', head: true })
            .eq('meal_name', name);
        if (!error) count = c || 0;
    }

    if (count > 0) {
        showToast(`Cannot delete: planned on ${count} day${count === 1 ? '' : 's'}. Use "Combine / Merge Meals" to combine it.`, true);
        return;
    }

    if (!confirm(`Delete "${name}"?`)) return;

    if (navigator.onLine) {
        const { error } = await _supabase.from('meals').delete().eq('name', name);
        if (error) {
            showToast(`Could not delete meal: ${error.message}`, true);
            return;
        }
    } else {
        enqueue({ type: 'delete-meal', payload: { name } });
        showToast('Deleted offline — will sync');
    }

    openMealEditor();
    renderMeals();
}

async function mergeMeals(selectedNames) {
    if (!navigator.onLine) {
        showToast('You must be online to merge meals', true);
        return;
    }

    const keepName = prompt(`Which name should we keep for these ${selectedNames.length} meals?\n\nOptions: ${selectedNames.join(', ')}`, selectedNames[0]);
    if (!keepName || !keepName.trim()) return;
    
    const formattedKeep = formatMealName(keepName);
    
    const otherMeals = getMealsCache().filter(m => !selectedNames.includes(m.name));
    const similar = getSimilarMeals(formattedKeep, otherMeals);
    if (similar.length > 0) {
        const similarNames = similar.slice(0, 4).map(m => m.name).join(', ') + (similar.length > 4 ? ` and ${similar.length - 4} more` : '');
        if (!confirm(`Warning: Similar meals exist outside your selection:\n\n${similarNames}\n\nUse "${formattedKeep}" anyway?`)) {
            return;
        }
    }
    
    if (!confirm(`Merge ${selectedNames.length} meals into "${formattedKeep}"?\n\nAll calendar days using the other names will be updated.`)) return;

    const { error: e1 } = await _supabase.from('calendar')
        .update({ meal_name: formattedKeep })
        .in('meal_name', selectedNames);
        
    if (e1) {
        showToast(`Error updating calendar: ${e1.message}`, true);
        return;
    }
    
    const toDelete = selectedNames.filter(n => n !== formattedKeep);
    if (toDelete.length > 0) {
        const { error: e2 } = await _supabase.from('meals')
            .delete()
            .in('name', toDelete);
        if (e2) showToast(`Error deleting old meals: ${e2.message}`, true);
    }
    
    const { data: existing } = await _supabase.from('meals').select('name').ilike('name', formattedKeep).maybeSingle();
    if (!existing) {
        const { error: e3 } = await _supabase.from('meals').insert({ name: formattedKeep });
        if (e3 && e3.code !== '23505') showToast(`Error adding new meal name: ${e3.message}`, true);
    }
    
    showToast('Meals merged successfully');
    isMergeMode = false;
    selectedMergeMeals.clear();
    openMealEditor();
    renderMeals();
}

// ---------------- Popular meals ----------------

let currentPopularRange = '30';
let popularRequestId = 0;

async function openPopular() {
    document.getElementById('popular-modal').style.display = 'block';
    renderPopularList(currentPopularRange);
}

async function renderPopularList(range) {
    currentPopularRange = range;
    const reqId = ++popularRequestId;

    const container = document.getElementById('popular-list');
    const selector = document.getElementById('popular-range-selector');

    selector.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.range === range);
    });

    container.innerHTML = '<div class="popular-empty">Loading…</div>';

    if (!navigator.onLine) {
        container.innerHTML = '<div class="popular-empty">You\'re offline — connect to see this.</div>';
        return;
    }

    const endISO = todayISO();
    const dStart = new Date();
    dStart.setHours(0, 0, 0, 0);

    let startISO = null;
    if (range === '30') {
        dStart.setDate(dStart.getDate() - 29);
        startISO = toLocalISO(dStart);
    } else if (range === '90') {
        dStart.setDate(dStart.getDate() - 89);
        startISO = toLocalISO(dStart);
    }

    let query = _supabase.from('calendar')
        .select('date, meal_name')
        .lte('date', endISO);

    if (startISO) {
        query = query.gte('date', startISO);
    }

    const { data, error } = await query;

    if (reqId !== popularRequestId) return;

    if (error) {
        showToast('Could not load popular meals', true);
        container.innerHTML = '<div class="popular-empty">Could not load.</div>';
        return;
    }

    const queuedDates = new Map();
    for (const op of getQueue()) {
        if (op.type === 'upsert-calendar') {
            const date = op.payload.date;
            if ((!startISO || date >= startISO) && date <= endISO) {
                queuedDates.set(date, op.payload.meal_name);
            }
        }
    }

    const counts = {};
    for (const row of data || []) {
        if (queuedDates.has(row.date)) continue;
        counts[row.meal_name] = (counts[row.meal_name] || 0) + 1;
    }
    for (const mealName of queuedDates.values()) {
        counts[mealName] = (counts[mealName] || 0) + 1;
    }

    const ranked = Object.entries(counts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const totalDays = (data?.length || 0) + queuedDates.size;
    const totalMeals = ranked.length;

    container.innerHTML = '';

    if (ranked.length === 0) {
        container.innerHTML = '<div class="popular-empty">No meals planned in this period.</div>';
        return;
    }

    const subtitle = document.createElement('div');
    subtitle.className = 'popular-subtitle';
    subtitle.textContent = `${totalMeals} distinct meal${totalMeals === 1 ? '' : 's'} across ${totalDays} planned day${totalDays === 1 ? '' : 's'}`;
    container.appendChild(subtitle);

    ranked.forEach((entry, i) => {
        const row = document.createElement('div');
        row.className = 'popular-row';

        const rank = document.createElement('div');
        rank.className = 'popular-rank' + (i < 3 ? ' top' : '');
        rank.textContent = i + 1;

        const name = document.createElement('div');
        name.className = 'popular-name';
        name.textContent = entry.name;

        const count = document.createElement('div');
        count.className = 'popular-count';
        count.textContent = entry.count + '×';

        row.appendChild(rank);
        row.appendChild(name);
        row.appendChild(count);
        container.appendChild(row);
    });
}

// ---------------- Go ----------------

init();