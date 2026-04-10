const supabaseUrl = 'https://qysscushyrhgrodlpovg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5c3NjdXNoeXJoZ3JvZGxwb3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjE3NzEsImV4cCI6MjA5MTM5Nzc3MX0.1KMpTrpzmi6d-r3nbPzGunpiYHkAjpUxuB32RtAlJqI';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

let startDate = new Date();

async function init() {
    await updateMealDatalist();
    renderWeek();
    
    document.getElementById('prevWeek').onclick = () => { 
        startDate.setDate(startDate.getDate() - 7); 
        renderWeek(); 
    };
    document.getElementById('nextWeek').onclick = () => { 
        startDate.setDate(startDate.getDate() + 7); 
        renderWeek(); 
    };
}

async function updateMealDatalist() {
    const { data } = await _supabase.from('meals').select('name');
    const list = document.getElementById('meal-options');
    if (data) {
        list.innerHTML = data.map(m => `<option value="${m.name}">`).join('');
    }
}

function renderWeek() {
    const container = document.getElementById('calendar-container');
    container.innerHTML = '';
    
    // Update the title to show the current range
    const options = { month: 'short', day: 'numeric' };
    document.getElementById('viewTitle').innerText = startDate.toLocaleDateString('en-GB', options);

    for (let i = 0; i < 7; i++) {
        let d = new Date(startDate);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        
        const card = document.createElement('div');
        card.className = 'date-card';
        card.innerHTML = `
            <label>${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</label>
            <div style="display: flex; align-items: center;">
                <input type="text" list="meal-options" data-date="${dateStr}" placeholder="What's for dinner?" autocomplete="off">
                <button class="clear-btn" style="background:none; border:none; color:#ccc; font-size:20px; padding:0 5px;">×</button>
            </div>
        `;
        container.appendChild(card);
        
        const input = card.querySelector('input');
        const clearBtn = card.querySelector('.clear-btn');

        // Fetch existing data
        fetchEntry(dateStr, input);

        // iOS FIX: Refresh datalist on focus
        input.onfocus = () => updateMealDatalist();

        // Keyboard FIX: Blur on Enter to force save
        input.onkeyup = (e) => { if (e.key === 'Enter') input.blur(); };

        // Save and Delete Logic
        input.onchange = async (e) => {
            const val = e.target.value.trim();
            
            if (val === "") {
                // DELETE logic
                await _supabase.from('calendar').delete().eq('date', dateStr);
            } else {
                // SAVE logic
                await _supabase.from('meals').upsert({ name: val }, { onConflict: 'name' });
                await _supabase.from('calendar').upsert({ date: dateStr, meal_name: val });
                updateMealDatalist();
            }
        };

        // Clear button logic
        clearBtn.onclick = () => {
            input.value = "";
            input.onchange({ target: input }); 
        };
    }
}

async function fetchEntry(date, input) {
    const { data } = await _supabase.from('calendar').select('meal_name').eq('date', date).maybeSingle();
    if (data) input.value = data.meal_name;
}

init();
