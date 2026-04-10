const supabaseUrl = 'https://qysscushyrhgrodlpovg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5c3NjdXNoeXJoZ3JvZGxwb3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE3NzEsImV4cCI6MjA5MTM5Nzc3MX0.1KMpTrpzmi6d-r3nbPzGunpiYHkAjpUxuB32RtAlJqI';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);
console.log("Supabase Key Loaded:", supabaseKey.substring(0, 5) + "...");

let startDate = new Date();

async function init() {
    await updateMealDatalist();
    renderWeek();
    
    document.getElementById('prevWeek').onclick = () => { startDate.setDate(startDate.getDate() - 7); renderWeek(); };
    document.getElementById('nextWeek').onclick = () => { startDate.setDate(startDate.getDate() + 7); renderWeek(); };
}

async function updateMealDatalist() {
    const { data } = await _supabase.from('meals').select('name');
    const list = document.getElementById('meal-options');
    list.innerHTML = data.map(m => `<option value="${m.name}">`).join('');
}

function renderWeek() {
    const container = document.getElementById('calendar-container');
    container.innerHTML = '';
    
    for (let i = 0; i < 7; i++) {
        let d = new Date(startDate);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        
        const card = document.createElement('div');
        card.className = 'date-card';
        card.innerHTML = `
            <label>${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</label>
            <input type="text" list="meal-options" data-date="${dateStr}" placeholder="What's for dinner?">
        `;
        container.appendChild(card);
        fetchEntry(dateStr, card.querySelector('input'));
    }
}

async function fetchEntry(date, input) {
    const { data } = await _supabase.from('calendar').select('meal_name').eq('date', date).maybeSingle();
    if (data) input.value = data.meal_name;

    input.onchange = async (e) => {
        const val = e.target.value;
        if (!val) return;
        await _supabase.from('meals').upsert({ name: val }, { onConflict: 'name' });
        await _supabase.from('calendar').upsert({ date: date, meal_name: val });
        updateMealDatalist();
    };
}

init();
