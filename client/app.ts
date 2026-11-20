interface Meal { day: number; meal_type: string; explanation: string; name: string; cost: string; calories: number; protein: number; carbs: number; fat: number; ingredients: string[]; steps: string; }
interface Item { name: string; grams: number; calories: number; kpg?: number; unit?: 'g' | 'piece'; piece?: { name: string; grams: number } | null; source?: 'table' | 'ai' | 'custom'; }
interface FoodChoice { name: string; kcal: number; piece_name?: string | null; piece_grams?: number | null; }
interface Saved { id: number; name: string; }

const root = document.getElementById('app')!;
const tabs = document.getElementById('tabs')!;
let uid = Number(localStorage.getItem('uid')) || 0;          // last used profile
let tab = 'profile', sel = 1, data: any = null, dayData: any = null;
let items: Item[] = [], note = '', msg = '', fromPhoto = false, foodRes: any[] = [], ftimer = 0;
let quickFood: FoodChoice | null = null, quickResults: FoodChoice[] = [], quickGrams = 100, quickSearchTimer = 0;
let quickError = '', quickNotice = '';
let creating = false, formMode: 'new' | 'edit' = 'new';
let saved: Saved[] = [];
try { saved = JSON.parse(localStorage.getItem('profiles') || '[]'); } catch { saved = []; }

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const EMOJI: Record<string, string> = { breakfast: '🍳', lunch: '🍜', dinner: '🍲' };

async function api(url: string, body?: unknown, method?: string) {
  const r = await fetch(url, body || method
    ? { method: method || 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }
    : undefined);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}

// ---------- Profiles remembered on this device (ids and names only) ----------
function remember(id: number, name: string) {
  const f = saved.find(p => p.id === id);
  if (f) f.name = name; else saved.push({ id, name });
  localStorage.setItem('profiles', JSON.stringify(saved));
}
async function open(id: number) {
  uid = id; localStorage.setItem('uid', String(id));
  try { data = await api(`/api/users/${id}/challenge`); remember(id, data.name); sel = data.today; tab = 'home'; creating = false; msg = ''; }
  catch (x) { data = null; msg = (x as Error).message; tab = 'profile'; }
  render();
}
async function reload() { data = await api(`/api/users/${uid}/challenge`); render(); }

tabs.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.onclick = () => {
  if (!data && b.dataset.t !== 'profile') return;
  tab = b.dataset.t!; msg = ''; creating = false; render();
});

// ---------- Main render ----------
async function render() {
  if (!data) tab = 'profile';
  tabs.hidden = !data;
  tabs.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.setAttribute('aria-current', String(b.dataset.t === tab)));
  dayData = null;
  if (data && tab === 'photo' && sel > data.today) sel = data.today;
  if (data && ['home', 'plan', 'photo'].includes(tab) && sel <= data.today) {
    try { dayData = await api(`/api/users/${uid}/day/${sel}`); } catch { dayData = null; }
  }
  root.innerHTML = tab === 'profile' ? await profileView() : tab === 'home' ? homeView() : tab === 'plan' ? planView()
    : tab === 'photo' ? photoView() : await weekView();

  root.querySelectorAll<HTMLButtonElement>('[data-d]').forEach(b => b.onclick = () => {
    const next = Number(b.dataset.d);
    if (next !== sel) {
      quickFood = null; quickResults = []; quickError = ''; quickNotice = '';
    }
    sel = next;
    render();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab!; render(); });
  const c = document.getElementById('complete');
  if (c) c.onclick = async () => { await api(`/api/users/${uid}/complete`, { day: sel }); reload(); };
  bindLogDelete();
  if (tab === 'home') bindQuickAdd();
  root.querySelectorAll<HTMLInputElement>('[data-eat]').forEach(box => box.onchange = async () => {
    box.disabled = true;
    try {
      await api(`/api/users/${uid}/eat`, { day: sel, meal_type: box.dataset.eat, eaten: box.checked });
      msg = '';
    } catch (x) { msg = (x as Error).message; }
    render();
  });
  if (tab === 'profile') bindProfile();
  if (tab === 'photo') bindPhoto();
}

function bindQuickAdd() {
  const search = document.getElementById('qfs') as HTMLInputElement | null;
  const results = document.getElementById('qfres');
  if (search && results) search.oninput = () => {
    clearTimeout(quickSearchTimer);
    const query = search.value.trim();
    quickError = '';
    quickNotice = '';
    if (!query) { results.innerHTML = ''; return; }
    results.innerHTML = '<p class="muted">Searching foods…</p>';
    quickSearchTimer = window.setTimeout(async () => {
      try {
        quickResults = await api('/api/foods?q=' + encodeURIComponent(query));
        if ((document.getElementById('qfs') as HTMLInputElement | null)?.value.trim() !== query) return;
        if (quickResults.length) {
          results.innerHTML = quickResults.map((f, n) =>
            `<button class="ghost" data-qfood="${n}">${esc(f.name)} <small>(${Math.round(f.kcal)} kcal per 100 g)</small></button>`).join('');
          results.querySelectorAll<HTMLButtonElement>('[data-qfood]').forEach(button => button.onclick = () => {
            quickFood = quickResults[Number(button.dataset.qfood)];
            quickGrams = quickFood.piece_name && quickFood.piece_grams ? Number(quickFood.piece_grams) : 100;
            quickError = ''; quickNotice = '';
            render();
          });
        } else {
          results.innerHTML = '<p class="muted">No match found in the food table.</p>';
        }
      } catch (x) {
        if ((document.getElementById('qfs') as HTMLInputElement | null)?.value.trim() === query) {
          results.innerHTML = `<p class="err">${esc((x as Error).message)}</p>`;
        }
      }
    }, 250);
  };

  const grams = document.getElementById('qgrams') as HTMLInputElement | null;
  if (grams) grams.oninput = () => {
    quickGrams = Number(grams.value) || 0;
    const estimate = document.getElementById('qestimate');
    if (estimate && quickFood) estimate.textContent = `${Math.round(quickGrams * quickFood.kcal / 100)} kcal`;
    const add = document.getElementById('qadd') as HTMLButtonElement | null;
    if (add) add.disabled = quickGrams < 1 || quickGrams > 3000;
  };

  const change = document.getElementById('qchange');
  if (change) change.onclick = () => { quickFood = null; quickResults = []; render(); };

  const photo = document.getElementById('qphoto');
  if (photo) photo.onclick = () => { tab = 'photo'; msg = ''; render(); };

  const add = document.getElementById('qadd') as HTMLButtonElement | null;
  if (add && quickFood) add.onclick = async () => {
    if (quickGrams < 1 || quickGrams > 3000) {
      quickError = 'Enter an amount between 1 and 3000 grams.';
      render();
      return;
    }
    add.disabled = true;
    const food = quickFood!;
    const calories = Math.round(quickGrams * food.kcal / 100);
    try {
      await api(`/api/users/${uid}/logs`, {
        day: sel, source: 'manual',
        items: [{ name: food.name, grams: Math.round(quickGrams), calories }],
      });
      quickNotice = `Added ${food.name} to Day ${sel} · about ${calories} kcal.`;
      quickError = '';
      quickFood = null; quickResults = []; quickGrams = 100;
    } catch (x) {
      quickError = (x as Error).message;
      quickNotice = '';
    }
    render();
  };
}

function bindLogDelete() {
  root.querySelectorAll<HTMLButtonElement>('[data-dl]').forEach(button => button.onclick = async () => {
    button.disabled = true;
    try {
      await api(`/api/users/${uid}/logs/${button.dataset.dl}`, undefined, 'DELETE');
      quickNotice = 'Food entry deleted.';
      quickError = '';
      msg = '';
    } catch (x) {
      if (tab === 'home') quickError = (x as Error).message;
      else msg = (x as Error).message;
    }
    render();
  });
}

// ---------- Shared pieces ----------
function rack() {
  const jar = (d: number) => {
    const fin = data.completed.includes(d);
    return `<button data-d="${d}" style="--c:var(--d${d})" class="jar${d === sel ? ' on' : ''}${fin ? ' done' : ''}${d > data.today ? ' locked' : ''}" aria-label="Day ${d}${fin ? ', completed' : ''}" aria-pressed="${d === sel}"><span>${d}</span></button>`;
  };
  return `<div class="rack" aria-label="Your 7 days">${[1, 2, 3, 4, 5, 6, 7].map(jar).join('')}</div>`;
}

function hero() {
  const done = data.completed.includes(sel);
  return `<div class="hero" style="--c:var(--d${sel})" data-day="${sel}">
    <p class="muted">Hi ${esc(data.name)} - today is day ${data.today} of 7</p>
    <h2>Day ${sel} challenge</h2><p class="goal">${esc(data.challenges[sel - 1])}</p>
    ${done ? '<span class="stamp">Done!</span>' : sel <= data.today ? '<button id="complete">Mark challenge complete</button>' : '<p class="muted">This day unlocks later.</p>'}</div>`;
}

function ringCard() {
  const t = dayData.totals, goal = data.target?.target || 0;
  const pct = goal ? Math.min(1, t.kcal / goal) : 0, C = 2 * Math.PI * 52;
  return `<div class="panel ringcard"><svg class="ring" viewBox="0 0 120 120" role="img" aria-label="${t.kcal} kcal eaten${goal ? ' of about ' + goal : ''}">
    <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22C55E"/><stop offset="1" stop-color="#FBBF24"/></linearGradient></defs>
    <circle cx="60" cy="60" r="52" class="rbg"/><circle cx="60" cy="60" r="52" class="rfg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" text-anchor="middle" class="rnum">${t.kcal}</text><text x="60" y="76" text-anchor="middle" class="rsub">kcal</text></svg>
    <div><h3>Day ${sel} intake</h3><p class="muted">${goal ? `Target about ${goal} kcal.` : 'Add your body details in Profile to see a target.'}</p>
    <p>Protein ${t.protein} g · Carbs ${t.carbs} g · Fat ${t.fat} g</p>
    <p class="muted">Macros count only the planned meals you tick. Photo and manual logs add calories only. All numbers are estimates.</p></div></div>`;
}

function targetCard() {
  const t = data.target;
  if (!t) return `<div class="panel"><h3>Daily calorie target</h3><p class="muted">Add your age, sex, height, weight and activity level in the Profile tab to see an estimated daily calorie target. Targets are only calculated for adults (18+).</p></div>`;
  return `<div class="panel"><h3>Daily calorie target</h3><p class="goal">about ${t.target} kcal</p>
  <p class="muted">Estimated from your profile: resting energy about ${t.bmr} kcal and daily use about ${t.tdee} kcal, adjusted for your goal. This is a general estimate, not medical advice. If you are pregnant, under 18 or have a medical condition, ask a doctor or dietitian.</p></div>`;
}

const eatBox = (m: Meal) => `<label class="eat"><input type="checkbox" data-eat="${m.meal_type}"${dayData?.eaten.includes(m.meal_type) ? ' checked' : ''}${dayData ? '' : ' disabled'}> I ate this</label>`;

// ---------- Home dashboard ----------
function quickAddView() {
  if (sel > data.today) {
    return `<div class="panel"><h3>Quick add food</h3><p class="muted">Day ${sel} has not started yet. You can log food when the day unlocks.</p></div>`;
  }
  const calories = quickFood ? Math.round(quickGrams * quickFood.kcal / 100) : 0;
  return `<div class="panel quick-add"><h3>Quick add food · Day ${sel}</h3>
    <p class="muted">Search a food and enter the amount. Calories are estimated from the food table. Use “I ate this” for planned meals; add extras here to avoid counting a meal twice.</p>
    <label for="qfs">Food name</label>
    <input id="qfs" placeholder="e.g. rice, egg, banana" autocomplete="off">
    <div id="qfres" class="fres"></div>
    ${quickFood ? `<div class="quick-selected"><p><b>${esc(quickFood.name)}</b> · about ${Math.round(quickFood.kcal)} kcal per 100 g</p>
      ${quickFood.piece_name && quickFood.piece_grams ? `<p class="muted">One ${esc(quickFood.piece_name)} is about ${Number(quickFood.piece_grams)} g.</p>` : ''}
      <label for="qgrams">Amount (grams)</label>
      <input id="qgrams" type="number" min="1" max="3000" step="1" inputmode="numeric" value="${quickGrams}">
      <p class="est">Estimated: about <b id="qestimate">${calories} kcal</b></p>
      <button id="qadd">Add to Day ${sel}</button>
      <button class="ghost" id="qchange">Choose another food</button></div>` : ''}
    ${quickError ? `<p class="err" role="alert">${esc(quickError)}</p>` : ''}
    ${quickNotice ? `<p class="muted" role="status">${esc(quickNotice)}</p>` : ''}
    <p class="muted">Can’t find it? <button class="ghost" id="qphoto">Estimate with a photo</button></p></div>`;
}

function homeView() {
  const meals: Meal[] = data.meals.filter((m: Meal) => m.day === sel);
  const logged = dayData?.logs || [];
  return `${rack()}${hero()}${dayData ? ringCard() : ''}${quickAddView()}${targetCard()}
  ${logged.length ? `<div class="panel"><h3>Foods you added · Day ${sel}</h3><ul class="plist">${logged.map((l: any) =>
    `<li class="who"><span class="wname"><b>${l.items.map((i: any) => esc(i.name)).join(', ')}</b><br>
      <small class="muted">${l.items.map((i: any) => `${esc(i.name)} · ${Number(i.grams)} g · ${Number(i.calories)} kcal`).join(' / ')} · about ${Number(l.kcal)} kcal total</small></span>
      <button class="ghost" data-dl="${l.id}" aria-label="Delete logged food">Delete</button></li>`).join('')}</ul></div>` : ''}
  <div class="panel"><h3>Day ${sel} meals</h3>${msg ? `<p class="err">${esc(msg)}</p>` : ''}${meals.length ? meals.map(m =>
    `<div class="meal t-${m.meal_type}"><span class="emoji" aria-hidden="true">${EMOJI[m.meal_type] || '🍽️'}</span>
    <div><span class="tag">${esc(m.meal_type)}</span> <b>${esc(m.name)}</b><br><small class="muted">~${m.calories} kcal</small><br>${eatBox(m)}</div></div>`).join('')
    : '<p>No meals match your restrictions. Loosen a preference in Profile.</p>'}
  <div class="quick"><button data-tab="plan">See the full meal plan</button></div></div>`;
}

// ---------- AI meal plan ----------
function planView() {
  const meals: Meal[] = data.meals.filter((m: Meal) => m.day === sel);
  return `${rack()}<div class="panel"><h2>Meal plan - Day ${sel}</h2>
  <p class="muted">Allergy and diet rules filter the meals first, then they are ranked for your goal, budget and calorie target.</p>
  ${meals.length ? meals.map(m =>
    `<div class="meal t-${m.meal_type}"><span class="emoji" aria-hidden="true">${EMOJI[m.meal_type] || '🍽️'}</span>
    <div><span class="tag">${esc(m.meal_type)}</span> <b>${esc(m.name)}</b><br><small class="muted">~${m.calories} kcal, ${m.protein} g protein, about ฿${Math.round(Number(m.cost))} (estimates)</small>
    <p>${esc(m.explanation)}</p>${eatBox(m)}
    <details><summary>Ingredients and steps</summary>${esc(m.ingredients.join(', '))}. ${esc(m.steps)}</details></div></div>`).join('')
    : '<p>No meals match your restrictions. Loosen a preference in Profile.</p>'}</div>`;
}

// ---------- Profile: choose, create, edit ----------
const opt = (v: string, l: string, cur: string) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`;
function profileForm(p: any, title: string, button: string, extra = '') {
  return `<form class="panel" id="f"><h2>${title}</h2>
  <label for="name">Your name</label><input id="name" required maxlength="80" value="${esc(p.name)}">
  <label for="goal">Goal</label><select id="goal">${opt('lose', 'Lose weight', p.goal)}${opt('maintain', 'Maintain weight', p.goal)}${opt('gain', 'Gain weight', p.goal)}</select>
  <label for="diet">Diet</label><select id="diet">${opt('none', 'No restriction', p.diet)}${opt('vegetarian', 'Vegetarian', p.diet)}${opt('vegan', 'Vegan', p.diet)}</select>
  <label for="budget">Budget per meal (THB)</label><input id="budget" type="number" min="20" max="500" step="5" value="${esc(p.budget)}">
  <label for="age">Age (optional, for a calorie target)</label><input id="age" type="number" min="10" max="100" value="${esc(p.age ?? '')}">
  <label for="sex">Sex (used by the calorie formula)</label><select id="sex"><option value="">Prefer not to say</option>${opt('female', 'Female', p.sex || '')}${opt('male', 'Male', p.sex || '')}</select>
  <label for="height">Height (cm)</label><input id="height" type="number" min="100" max="230" value="${esc(p.height ?? '')}">
  <label for="weight">Weight (kg)</label><input id="weight" type="number" min="30" max="250" step="0.5" value="${esc(p.weight ?? '')}">
  <label for="activity">Activity level</label><select id="activity"><option value="">Not set</option>${opt('sedentary', 'Sedentary (little exercise)', p.activity || '')}${opt('light', 'Light (1-3 days a week)', p.activity || '')}${opt('moderate', 'Moderate (3-5 days a week)', p.activity || '')}${opt('active', 'Active (6-7 days a week)', p.activity || '')}</select>
  <label for="allergies">Allergies (comma separated, e.g. peanut, egg)</label><input id="allergies" value="${esc(p.allergies.join(', '))}">
  <label for="dislikes">Foods you avoid</label><input id="dislikes" value="${esc(p.dislikes.join(', '))}">
  <label for="preferences">Foods you like</label><input id="preferences" value="${esc(p.preferences.join(', '))}">
  <p class="muted">Allergies are applied as a required filter before any meal is recommended. Always check labels yourself.</p>
  <button id="go">${button}</button>${extra}<p class="err" id="e"></p></form>`;
}
function readForm() {
  const v = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
  return { name: v('name'), goal: v('goal'), diet: v('diet'), budget: v('budget'),
    allergies: v('allergies'), dislikes: v('dislikes'), preferences: v('preferences'),
    age: v('age'), sex: v('sex'), height: v('height'), weight: v('weight'), activity: v('activity') };
}

async function profileView() {
  const blank = { name: '', goal: 'maintain', diet: 'none', budget: 60, allergies: [], dislikes: [], preferences: [], age: null, sex: null, height: null, weight: null, activity: null };
  if (creating) {
    formMode = 'new';
    return profileForm(blank, 'Create your profile', 'Create my plan',
      saved.length ? '<button type="button" class="ghost" id="cancel">Cancel</button>' : '');
  }
  const list = saved.map(s => `<li class="who"><span class="avatar">${esc(s.name.slice(0, 1).toUpperCase() || '?')}</span>
    <span class="wname">${esc(s.name)}${s.id === uid ? ' <small class="muted">(last used)</small>' : ''}</span>
    <button data-go="${s.id}">${data && s.id === uid ? 'Open home' : 'Continue'}</button>
    <button class="ghost" data-forget="${s.id}" aria-label="Forget ${esc(s.name)} on this device">x</button></li>`).join('');
  const chooser = `<div class="panel"><h2>Who's eating today?</h2><ul class="plist">${list}</ul>
    <button class="alt" id="newp">+ New profile</button><p class="err">${esc(msg)}</p>
    <label for="code">Have a profile code? Use it on a new phone</label>
    <input id="code" placeholder="e.g. K7M2QX9P" maxlength="12" autocapitalize="characters" autocomplete="off">
    <button class="ghost" id="usecode">Open profile</button>
    ${data?.code ? `<p>Your profile code: <b class="code">${esc(data.code)}</b><br><span class="muted">Write it down. Anyone with this code can open your profile, so keep it private.</span></p>` : ''}
    <p class="muted">The x only forgets a profile on this device. Its data stays in the database.</p></div>`;
  if (!data) return chooser;
  formMode = 'edit';
  const p = await api(`/api/users/${uid}/profile`);
  return chooser + profileForm(p, 'Edit your profile', 'Save and rebuild my plan');
}

function bindProfile() {
  const f = document.getElementById('f');
  if (f) f.onsubmit = async e => {
    e.preventDefault();
    const go = $<HTMLButtonElement>('go'), label = go.textContent || '';
    go.disabled = true; go.textContent = 'Building your plan...';
    try {
      const body = readForm();
      if (formMode === 'new') { const r = await api('/api/users', body); remember(r.id, body.name); await open(r.id); }
      else { await api(`/api/users/${uid}`, body, 'PUT'); await open(uid); }
    } catch (x) { $('e').textContent = (x as Error).message; go.disabled = false; go.textContent = label; }
  };
  const cancel = document.getElementById('cancel');
  if (cancel) cancel.onclick = () => { creating = false; render(); };
  const newp = document.getElementById('newp');
  if (newp) newp.onclick = () => { creating = true; render(); };
  root.querySelectorAll<HTMLButtonElement>('[data-go]').forEach(b => b.onclick = () => open(Number(b.dataset.go)));
  root.querySelectorAll<HTMLButtonElement>('[data-forget]').forEach(b => b.onclick = () => {
    const id = Number(b.dataset.forget);
    saved = saved.filter(s => s.id !== id); localStorage.setItem('profiles', JSON.stringify(saved));
    if (id === uid) { data = null; uid = 0; localStorage.removeItem('uid'); }
    render();
  });
  const uc = document.getElementById('usecode');
  if (uc) uc.onclick = async () => {
    const code = (document.getElementById('code') as HTMLInputElement).value.trim();
    try { const r = await api('/api/open', { code }); remember(r.id, r.name); await open(r.id); }
    catch (x) { msg = (x as Error).message; render(); }
  };
}

// ---------- Photo and manual food log ----------
const total = () => items.reduce((a, i) => a + (Number(i.calories) || 0), 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const srcLabel = (i: Item) => i.source === 'table' ? 'Calories calculated from the food table (approximate)'
  : i.source === 'ai' ? 'AI guess - please check' : 'Custom value';
const amountOf = (i: Item) => i.unit === 'piece' && i.piece ? round1(i.grams / i.piece.grams) : Math.round(i.grams);

function photoView() {
  const rows = items.map((i, n) =>
    `<div class="row"><input data-n="${n}" data-k="name" value="${esc(i.name)}" placeholder="Food name" aria-label="Food">
    <input data-n="${n}" data-k="amount" type="number" min="0" step="any" value="${amountOf(i)}" aria-label="Amount">
    <select data-u="${n}" aria-label="Unit"><option value="g"${i.unit !== 'piece' ? ' selected' : ''}>g</option>${i.piece ? `<option value="piece"${i.unit === 'piece' ? ' selected' : ''}>${esc(i.piece.name)}</option>` : ''}</select>
    <input data-n="${n}" data-k="calories" type="number" min="0" value="${i.calories}" aria-label="Calories">
    <button class="ghost" data-rm="${n}" aria-label="Remove">x</button>
    <small class="muted src">${srcLabel(i)}</small></div>`).join('');
  return `${rack()}<div class="panel"><h2>Log a meal</h2>
  <p class="muted">Search a food and enter how much you ate. Calories are calculated for you. Or take a photo and AI will guess the foods and portions. Everything is an estimate, so check it before saving.</p>
  <p>Saving to <b>Day ${sel}</b>${sel === data.today ? ' (today)' : ''}. Pick another open day above.</p>
  ${dayData && dayData.logs.length ? `<ul class="plist">${dayData.logs.map((l: any) => `<li class="who"><span class="wname">${l.items.map((i: any) => esc(i.name)).join(', ')} - ${l.kcal} kcal</span><button class="ghost" data-dl="${l.id}">Delete</button></li>`).join('')}</ul>` : ''}
  <label for="fs">Search a food</label>
  <input id="fs" placeholder="e.g. egg, rice, banana" autocomplete="off"><div id="fres" class="fres"></div>
  <button class="ghost" id="addc">Add custom food</button>
  <label class="btn alt" for="img">Take or upload photo</label>
  <input id="img" type="file" accept="image/*" capture="environment" hidden>
  <p class="err" id="e">${esc(msg)}</p><p id="busy"></p>
  ${items.length ? `<div class="est"><b>Estimated total: about <span id="total">${total()}</span> kcal</b> (not exact). ${esc(note)}</div>
  <div class="row muted"><span>Food</span><span>Amount</span><span>Unit</span><span>kcal</span><span></span></div>${rows}
  <p class="muted">Change the amount and the calories update to match.</p><button id="save">Save estimate</button>` : ''}</div>`;
}

function addFood(f: any) {
  const piece = f.piece_name && f.piece_grams ? { name: f.piece_name as string, grams: Number(f.piece_grams) } : null;
  const grams = piece ? piece.grams : 100;
  items.push({ name: f.name, grams, calories: Math.round(grams * f.kcal / 100), kpg: f.kcal / 100, piece, unit: piece ? 'piece' : 'g', source: 'table' });
  render();
}

function bindPhoto() {
  $<HTMLInputElement>('img').onchange = async e => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    $('busy').textContent = 'Estimating...'; msg = '';
    try {
      const r = await api('/api/estimate', { image: await shrink(f) });
      items = r.items.map((i: any) => ({ name: i.name, grams: i.grams, calories: i.calories, source: i.source, unit: 'g', piece: null,
        kpg: i.grams > 0 ? i.calories / i.grams : undefined }));
      note = r.notes || ''; fromPhoto = true;
      if (!items.length) msg = 'No food found. Search a food or add a custom one.';
    } catch (x) { msg = (x as Error).message; }
    render();
  };

  $<HTMLInputElement>('fs').oninput = e => {
    clearTimeout(ftimer);
    const q = (e.target as HTMLInputElement).value.trim();
    ftimer = window.setTimeout(async () => {
      const box = $('fres');
      if (!q) { box.innerHTML = ''; return; }
      try {
        foodRes = await api('/api/foods?q=' + encodeURIComponent(q));
        box.innerHTML = foodRes.length
          ? foodRes.map((f, n) => `<button class="ghost" data-f="${n}">${esc(f.name)} <small>(${Math.round(f.kcal)} kcal per 100 g)</small></button>`).join('')
          : '<p class="muted">No match. Use "Add custom food".</p>';
        box.querySelectorAll<HTMLButtonElement>('[data-f]').forEach(b => b.onclick = () => addFood(foodRes[Number(b.dataset.f)]));
      } catch { /* ignore search errors */ }
    }, 250);
  };

  $('addc').onclick = async () => {
    items.push({ name: '', grams: 100, calories: 0, unit: 'g', piece: null, source: 'custom' });
    await render();
    root.querySelector<HTMLInputElement>(`[data-n="${items.length - 1}"][data-k="name"]`)?.focus();
  };

  // Edit in place: update data and numbers without redrawing the page
  root.querySelectorAll<HTMLInputElement>('input[data-n]').forEach(inp => inp.oninput = () => {
    const it = items[Number(inp.dataset.n)], k = inp.dataset.k!, row = inp.closest('.row')!;
    if (k === 'name') it.name = inp.value;
    else if (k === 'amount') {
      const v = Math.max(0, Number(inp.value) || 0);
      it.grams = it.unit === 'piece' && it.piece ? v * it.piece.grams : v;
      if (it.kpg) {
        it.calories = Math.round(it.grams * it.kpg);
        row.querySelector<HTMLInputElement>('[data-k="calories"]')!.value = String(it.calories);
      }
    } else {
      it.calories = Math.max(0, Number(inp.value) || 0);
      if (it.grams > 0) it.kpg = it.calories / it.grams;
      it.source = 'custom';
      row.querySelector('.src')!.textContent = srcLabel(it);
    }
    const t = document.getElementById('total');
    if (t) t.textContent = String(total());
  });

  root.querySelectorAll<HTMLSelectElement>('select[data-u]').forEach(s => s.onchange = () => {
    const it = items[Number(s.dataset.u)];
    it.unit = s.value as 'g' | 'piece';
    s.closest('.row')!.querySelector<HTMLInputElement>('[data-k="amount"]')!.value = String(amountOf(it));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-rm]').forEach(b => b.onclick = () => { items.splice(Number(b.dataset.rm), 1); render(); });
  const s = document.getElementById('save');
  if (s) s.onclick = async () => {
    try {
      const clean = items.map(({ name, grams, calories }) => ({ name, grams: Math.round(grams), calories }));
      const r = await api(`/api/users/${uid}/logs`, { day: sel, source: fromPhoto ? 'photo' : 'manual', items: clean });
      items = []; fromPhoto = false; note = ''; msg = `Saved as an estimate: about ${r.total} kcal.`;
    } catch (x) { msg = (x as Error).message; }
    render();
  };
}

// Shrink the photo before upload so requests stay small
function shrink(f: File): Promise<string> {
  return new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = img.width * k; c.height = img.height * k;
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      ok(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => no(new Error('Could not read that image.'));
    img.src = URL.createObjectURL(f);
  });
}

// ---------- Weekly summary ----------
async function weekView() {
  const s = await api(`/api/users/${uid}/summary`);
  const rackHtml = [1, 2, 3, 4, 5, 6, 7].map(d =>
    `<span class="jar${data.completed.includes(d) ? ' done' : ''}" style="--c:var(--d${d})" aria-label="Day ${d}${data.completed.includes(d) ? ', completed' : ''}"><span>${d}</span></span>`).join('');
  const daily = [1, 2, 3, 4, 5, 6, 7].map(day => {
    const log = s.logs.find((entry: any) => Number(entry.day) === day);
    return { day, kcal: log ? Number(log.kcal) : 0, entries: log ? Number(log.n) : 0 };
  });
  const maxKcal = Math.max(1, ...daily.map(d => d.kcal));
  const mostTracked = daily.reduce((best, d) => d.entries > best.entries ? d : best, daily[0]);
  const nextStep = s.loggedDays === 0 ? 'Start by logging one meal or snack to begin your food story.'
    : s.loggedDays < 4 ? `You tracked food on ${s.loggedDays} of 7 days. Logging snacks too can make the picture more complete.`
      : `You tracked food on ${s.loggedDays} of 7 days. Keep noticing the patterns that work for you.`;
  return `<div class="panel"><h2>Your 7-day food story</h2>
  <p class="muted">A week of your meal and food notes. Calorie totals are estimates, not a score.</p>
  <div class="rack">${rackHtml}</div>
  <div class="story-stats">
    <div><b>${s.completedDays}/7</b><span>challenges completed</span></div>
    <div><b>${s.loggedDays}/7</b><span>days with food entries</span></div>
    <div><b>${s.bestStreak}</b><span>best challenge streak</span></div>
  </div>
  <h3>Daily food trail</h3>
  <p class="muted">Estimated calories from planned meals you checked and foods you logged.</p>
  <div class="story-list">${daily.map(d => {
    const width = d.kcal ? Math.max(4, Math.round(d.kcal / maxKcal * 100)) : 0;
    return `<div class="story-row" style="--c:var(--d${d.day})">
      <strong>Day ${d.day}</strong>
      <div class="story-track" role="img" aria-label="Day ${d.day}: ${d.kcal ? `${d.kcal} estimated kcal` : 'no food logged'}"><i style="width:${width}%"></i></div>
      <b>${d.kcal ? `${d.kcal} kcal` : '—'}</b>
      <small class="muted">${d.entries ? `${d.entries} tracked ${d.entries === 1 ? 'entry' : 'entries'}` : 'No food entries'}</small>
    </div>`;
  }).join('')}</div>
  <div class="est"><b>Your week highlight</b><p>${mostTracked.entries
    ? `Day ${mostTracked.day} was your most-tracked day, with ${mostTracked.entries} food ${mostTracked.entries === 1 ? 'entry' : 'entries'}.`
    : 'Your food trail will appear here as you log meals and snacks.'}
    ${s.completedDays === 7 ? ' You also completed all seven challenges—great consistency.' : ` You completed ${s.completedDays} of 7 challenges.`}</p></div>
  ${s.avgLoggedKcal != null ? `<p>Average on tracked days: about ${s.avgLoggedKcal} kcal/day.</p>` : ''}
  <p class="muted">${esc(nextStep)}</p></div>`;
}

// Always start on the Profile screen
render();