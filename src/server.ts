import crypto from 'crypto';
import express, { Request, Response } from 'express';
import path from 'path';
import { createPool } from 'mysql2/promise';
import { Meal, Profile, pickPlan, reasons, dailyChallenge, calorieTarget } from './rules';
import { explain, estimateFromPhoto } from './ai';

// TiDB connection (TLS required)
const db = createPool({
  uri: process.env.DATABASE_URL!,
  ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  connectionLimit: 10,
});

const app = express();
app.use(express.json({ limit: '8mb' })); // photos arrive as base64
app.use(express.static(path.join(__dirname, '..', 'public')));

// Wraps async routes so errors return JSON instead of crashing
const h = (fn: (q: Request, s: Response) => Promise<unknown>) => (q: Request, s: Response) =>
  fn(q, s).catch(e => {
    console.error(e);
    s.status(500).json({ error: e.message || 'Server error' });
  });

// "peanut, egg" -> ["peanut","egg"]
const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : String(v || '').split(',')).map(x => String(x).trim()).filter(Boolean).slice(0, 20);

const toProfile = (r: any): Profile => ({
  goal: r.goal, diet: r.diet, budget: Number(r.budget),
  allergies: r.allergies, dislikes: r.dislikes, preferences: r.preferences,
  age: r.age, sex: r.sex, activity: r.activity,
  height: r.height_cm == null ? null : Number(r.height_cm),
  weight: r.weight_kg == null ? null : Number(r.weight_kg),
});

const num = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return v !== '' && v != null && n >= min && n <= max ? n : null;
};

// Validate profile input (shared by create and edit)
function cleanProfile(b: any) {
  return {
    name: String(b.name || 'Guest').slice(0, 80),
    goal: ['lose', 'maintain', 'gain'].includes(b.goal) ? b.goal : 'maintain',
    diet: ['none', 'vegetarian', 'vegan'].includes(b.diet) ? b.diet : 'none',
    budget: Math.min(500, Math.max(20, Number(b.budget) || 60)),
    allergies: list(b.allergies), dislikes: list(b.dislikes), preferences: list(b.preferences),
    age: num(b.age, 10, 100),
    sex: ['male', 'female'].includes(b.sex) ? b.sex : null,
    height: num(b.height, 100, 230),
    weight: num(b.weight, 30, 250),
    activity: ['sedentary', 'light', 'moderate', 'active'].includes(b.activity) ? b.activity : null,
  };
}

// Which challenge day is it (1-7) based on start date
const currentDay = (started: string | Date) =>
  Math.min(7, Math.max(1, Math.floor((Date.now() - new Date(started).getTime()) / 864e5) + 1));

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(8), b => ALPHA[b % ALPHA.length]).join('');
const tries = new Map<string, number[]>();

// Check a day is valid (1..today) for this user
async function userDay(id: string, d: unknown) {
  const [u]: any = await db.query('SELECT started_on FROM users WHERE id=?', [id]);
  if (!u[0]) return null;
  const today = currentDay(u[0].started_on);
  const day = Number(d) || today;
  return day >= 1 && day <= today ? { day, today } : null;
}

// Save the plan right away with plain explanations, then improve the wording with AI in the background
async function buildPlan(uid: number, p: Profile) {
  const [rows] = await db.query('SELECT * FROM meals');
  const plan = pickPlan(rows as Meal[], p);
  const plain = (r: string[]) => `Recommended because it ${r.join(', ') || 'fits your profile'}.`;

  await db.query('DELETE FROM plan_meals WHERE user_id=?', [uid]);
  for (const x of plan) {
    await db.query('INSERT INTO plan_meals VALUES (?,?,?,?,?)',
      [uid, x.day, x.meal.meal_type, x.meal.id, plain(reasons(x.meal, p))]);
  }

  // Not awaited: the page never waits for (or depends on) the AI
  explain(plan.map(x => ({ key: `${x.day}-${x.meal.meal_type}`, meal: x.meal.name, reasons: reasons(x.meal, p) })))
    .then(async exp => {
      for (const x of plan) {
        await db.query('UPDATE plan_meals SET explanation=? WHERE user_id=? AND day=? AND meal_type=? AND meal_id=?',
          [exp[`${x.day}-${x.meal.meal_type}`], uid, x.day, x.meal.meal_type, x.meal.id]);
      }
    })
    .catch(e => console.error('AI explanations skipped:', e.message));
}

const COLS = 'name,goal,diet,budget,allergies,dislikes,preferences,age,sex,height_cm,weight_kg,activity';
const vals = (c: ReturnType<typeof cleanProfile>) => [c.name, c.goal, c.diet, c.budget,
  JSON.stringify(c.allergies), JSON.stringify(c.dislikes), JSON.stringify(c.preferences),
  c.age, c.sex, c.height, c.weight, c.activity];

async function readProfile(id: string) {
  const sql = `SELECT ${COLS} FROM users WHERE id=?`;
  try {
    return await db.query(sql, [id]);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') throw e;
    return db.query(sql, [id]);
  }
}

app.post('/api/users', h(async (q, s) => {
  const c = cleanProfile(q.body);
  const [r]: any = await db.query(
    `INSERT INTO users (${COLS},started_on) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURDATE())`, vals(c));
  let codeCreated = false;
  for (let i = 0; i < 5; i++) {
    try {
      await db.query('UPDATE users SET access_code=? WHERE id=?', [newCode(), r.insertId]);
      codeCreated = true;
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ER_DUP_ENTRY') throw e;
    }
  }
  if (!codeCreated) throw new Error('Could not generate a unique profile code.');
  await buildPlan(r.insertId, c);
  s.json({ id: r.insertId });
}));

app.get('/api/users/:id/profile', h(async (q, s) => {
  const [u]: any = await readProfile(q.params.id);
  if (!u[0]) return s.status(404).json({ error: 'User not found' });
  const r = u[0];
  s.json({ ...r, budget: Number(r.budget), height: r.height_cm == null ? null : Number(r.height_cm), weight: r.weight_kg == null ? null : Number(r.weight_kg) });
}));

app.put('/api/users/:id', h(async (q, s) => {
  const [u]: any = await db.query('SELECT id FROM users WHERE id=?', [q.params.id]);
  if (!u[0]) return s.status(404).json({ error: 'User not found' });
  const c = cleanProfile(q.body);
  await db.query(
    'UPDATE users SET name=?,goal=?,diet=?,budget=?,allergies=?,dislikes=?,preferences=?,age=?,sex=?,height_cm=?,weight_kg=?,activity=? WHERE id=?',
    [...vals(c), q.params.id]);
  await buildPlan(Number(q.params.id), c);
  s.json({ ok: true });
}));

// Challenges, meals and progress for the dashboard
app.get('/api/users/:id/challenge', h(async (q, s) => {
  const [u]: any = await db.query('SELECT * FROM users WHERE id=?', [q.params.id]);
  if (!u[0]) return s.status(404).json({ error: 'User not found' });
  const p = toProfile(u[0]);
  if (p.budget < 20) {
    p.budget = 60;
    await db.query('UPDATE users SET budget=? WHERE id=?', [p.budget, q.params.id]);
    await buildPlan(Number(q.params.id), p);
  }
  const [meals]: any = await db.query(
    `SELECT p.day, p.meal_type, p.explanation, m.* FROM plan_meals p JOIN meals m ON m.id=p.meal_id
     WHERE p.user_id=? ORDER BY p.day, FIELD(p.meal_type,'breakfast','lunch','dinner')`, [q.params.id]);
  const [done]: any = await db.query('SELECT day FROM challenge_progress WHERE user_id=?', [q.params.id]);
  s.json({
    name: u[0].name,
    code: u[0].access_code,
    today: currentDay(u[0].started_on),
    target: calorieTarget(p),
    completed: done.map((d: any) => d.day),
    challenges: [1, 2, 3, 4, 5, 6, 7].map(d => dailyChallenge(d, p)),
    meals: meals.map((m: any) => ({
      ...m,
      explanation: String(m.explanation || '').replace(/\$/g, '฿'),
    })),
  });
}));

// Mark a day complete (only days that have started)
app.post('/api/users/:id/complete', h(async (q, s) => {
  const day = Number(q.body.day);
  const [u]: any = await db.query('SELECT started_on FROM users WHERE id=?', [q.params.id]);
  if (!u[0] || !(day >= 1 && day <= currentDay(u[0].started_on))) {
    return s.status(400).json({ error: 'You can only complete days that have started.' });
  }
  await db.query('INSERT IGNORE INTO challenge_progress (user_id,day) VALUES (?,?)', [q.params.id, day]);
  s.json({ ok: true });
}));

// Search the foods table by name (no AI involved)
app.get('/api/foods', h(async (q, s) => {
  const term = String(q.query.q || '').trim().slice(0, 40).replace(/[%_\\]/g, m => '\\' + m);
  if (!term) return s.json([]);
  const [rows]: any = await db.query(
    'SELECT name,kcal,protein,carbs,fat,piece_name,piece_grams FROM foods WHERE name LIKE ? ORDER BY name LIMIT 8', [`%${term}%`]);
  s.json(rows.map((r: any) => ({ ...r, kcal: Number(r.kcal), protein: Number(r.protein), carbs: Number(r.carbs), fat: Number(r.fat) })));
}));

// Photo -> estimated foods (not saved yet; user edits first)
app.post('/api/estimate', h(async (q, s) => {
  const result = await estimateFromPhoto(String(q.body.image || ''));
  s.json({ ...result, isEstimate: true });
}));

app.post('/api/users/:id/logs', h(async (q, s) => {
  const items = (Array.isArray(q.body.items) ? q.body.items : []).slice(0, 20)
    .map((i: any) => ({
      name: String(i.name || '').slice(0, 80),
      grams: Math.min(3000, Math.max(0, Math.round(Number(i.grams) || 0))),
      calories: Math.min(5000, Math.max(0, Math.round(Number(i.calories) || 0))),
    }))
    .filter((i: any) => i.name);
  if (!items.length) return s.status(400).json({ error: 'Add at least one food.' });
  const ud = await userDay(q.params.id, q.body.day);
  if (!ud) return s.status(400).json({ error: 'You can only log days that have started.' });
  const total = items.reduce((a: number, i: any) => a + i.calories, 0);
  await db.query(
    'INSERT INTO meal_logs (user_id,day,source,items,total_calories,is_estimate) VALUES (?,?,?,?,?,TRUE)',
    [q.params.id, ud.day, q.body.source === 'manual' ? 'manual' : 'photo', JSON.stringify(items), total]);
  s.json({ total });
}));

app.delete('/api/users/:id/logs/:logId', h(async (q, s) => {
  await db.query('DELETE FROM meal_logs WHERE id=? AND user_id=?', [q.params.logId, q.params.id]);
  s.json({ ok: true });
}));

// Tick or untick "I ate this" for a planned meal
app.post('/api/users/:id/eat', h(async (q, s) => {
  const ud = await userDay(q.params.id, q.body.day);
  const type = ['breakfast', 'lunch', 'dinner'].includes(q.body.meal_type) ? q.body.meal_type : null;
  if (!ud || !type) return s.status(400).json({ error: 'You can only track days that have started.' });
  if (q.body.eaten) await db.query('INSERT IGNORE INTO meal_checks (user_id,day,meal_type) VALUES (?,?,?)', [q.params.id, ud.day, type]);
  else await db.query('DELETE FROM meal_checks WHERE user_id=? AND day=? AND meal_type=?', [q.params.id, ud.day, type]);
  s.json({ ok: true });
}));

// Everything tracked for one day
app.get('/api/users/:id/day/:day', h(async (q, s) => {
  const ud = await userDay(q.params.id, q.params.day);
  if (!ud) return s.status(400).json({ error: 'That day has not started yet.' });
  const [checks]: any = await db.query(
    `SELECT c.meal_type, m.calories, m.protein, m.carbs, m.fat FROM meal_checks c
     JOIN plan_meals p ON p.user_id=c.user_id AND p.day=c.day AND p.meal_type=c.meal_type
     JOIN meals m ON m.id=p.meal_id WHERE c.user_id=? AND c.day=?`, [q.params.id, ud.day]);
  const [logs]: any = await db.query('SELECT id,source,items,total_calories FROM meal_logs WHERE user_id=? AND day=? ORDER BY id', [q.params.id, ud.day]);
  const sum = (k: string) => checks.reduce((a: number, c: any) => a + Number(c[k]), 0);
  s.json({
    day: ud.day,
    eaten: checks.map((c: any) => c.meal_type),
    logs: logs.map((l: any) => ({ id: l.id, items: l.items, kcal: l.total_calories })),
    totals: {
      kcal: sum('calories') + logs.reduce((a: number, l: any) => a + l.total_calories, 0),
      protein: Math.round(sum('protein')), carbs: Math.round(sum('carbs')), fat: Math.round(sum('fat')),
    },
  });
}));

// Weekly completion summary
app.get('/api/users/:id/summary', h(async (q, s) => {
  const [done]: any = await db.query('SELECT day FROM challenge_progress WHERE user_id=? ORDER BY day', [q.params.id]);
  const [logs]: any = await db.query(
    `SELECT day, SUM(k) kcal, COUNT(*) n FROM (
       SELECT day, total_calories k FROM meal_logs WHERE user_id=?
       UNION ALL
       SELECT c.day, m.calories k FROM meal_checks c
         JOIN plan_meals p ON p.user_id=c.user_id AND p.day=c.day AND p.meal_type=c.meal_type
         JOIN meals m ON m.id=p.meal_id WHERE c.user_id=?
     ) t GROUP BY day ORDER BY day`, [q.params.id, q.params.id]);
  const days = done.map((d: any) => d.day);
  let streak = 0, best = 0;
  for (let d = 1; d <= 7; d++) { streak = days.includes(d) ? streak + 1 : 0; best = Math.max(best, streak); }
  const avg = logs.length ? Math.round(logs.reduce((a: number, l: any) => a + Number(l.kcal), 0) / logs.length) : null;
  s.json({
    completedDays: days.length, percent: Math.round((days.length / 7) * 100),
    bestStreak: best, loggedDays: logs.length, avgLoggedKcal: avg, logs,
  });
}));

// Open an existing profile on a new device with its code
app.post('/api/open', h(async (q, s) => {
  const ip = q.ip || 'x', now = Date.now();
  const recent = (tries.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 10) return s.status(429).json({ error: 'Too many tries. Wait a minute and try again.' });
  tries.set(ip, [...recent, now]);
  const code = String(q.body.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const [rows]: any = code.length >= 6 ? await db.query('SELECT id,name FROM users WHERE access_code=?', [code]) : [[]];
  if (!rows[0]) return s.status(404).json({ error: 'No profile found for that code.' });
  s.json({ id: rows[0].id, name: rows[0].name });
}));

app.listen(Number(process.env.PORT) || 3000, () => console.log('SmartDiet AI running on port ' + (process.env.PORT || 3000)));