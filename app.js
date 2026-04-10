const supabase = supabase.createClient('https://qysscushyrhgrodlpovg.supabase.co', 'sb_publishable_2NasP-YEWWFAw7g2IJRUnQ_NjdUN0Jv');
let startDate = new Date();

async function init() {
    await updateMealDatalist();
    renderWeek();
}

async function updateMealDatalist() {
    const { data } = await supabase.from('meals').select('name');
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
            <label>${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</label>
            <input type="text" list="meal-options" data-date="${dateStr}" placeholder="Search or add meal...">
        `;
        container.appendChild(card);
        fetchEntry(dateStr, card.querySelector('input'));
    }
}

async function fetchEntry(date, input) {
    const { data } = await supabase.from('calendar').select('meal_name').eq('date', date).single();
    if (data) input.value = data.meal_name;

    input.onchange = async (e) => {
        const val = e.target.value;
        if (!val) return;

        await supabase.from('meals').upsert({ name: val }, { onConflict: 'name' });
        await supabase.from('calendar').upsert({ date: date, meal_name: val });
        updateMealDatalist();
    };
}

init();