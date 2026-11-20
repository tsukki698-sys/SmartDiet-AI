export type MealType = 'breakfast' | 'lunch' | 'dinner';

export interface Meal {
  id: number; name: string; meal_type: MealType;
  diet_tags: string[]; allergens: string[]; goal_tags: string[];
  cost: number; calories: number; protein: number; carbs: number; fat: number;
  ingredients: string[]; steps: string;
}

export interface Profile {
  goal: 'lose' | 'maintain' | 'gain';
  diet: 'none' | 'vegetarian' | 'vegan';
  budget: number;
  allergies: string[]; dislikes: string[]; preferences: string[];
  age?: number | null; sex?: string | null; height?: number | null; weight?: number | null; activity?: string | null
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '_');
const has = (text: string, term: string) => text.toLowerCase().includes(term.trim().toLowerCase());

/** STEP 1 - REQUIRED filter. Runs before ranking. AI can never add back a removed meal. */
export function safeMeals(meals: Meal[], p: Profile): Meal[] {
  const allergies = p.allergies.map(norm).filter(Boolean);
  return meals.filter(m => {
    // 1. Allergen tags on the meal
    if (m.allergens.some(a => allergies.includes(norm(a)))) return false;
    // 2. Typed allergies also checked against name and ingredients (e.g. "almond" blocks "almonds")
    const text = m.name + ' ' + m.ingredients.join(' ');
    if (allergies.some(a => has(text, a.replace(/_/g, ' ')))) return false;
    // 3. Foods the user avoids
    if (p.dislikes.filter(Boolean).some(d => has(text, d))) return false;
    // 4. Diet (vegetarian / vegan)
    if (p.diet !== 'none' && !m.diet_tags.includes(p.diet)) return false;
    return true;
  });
}

const CAL_TARGET = { lose: 1600, maintain: 2000, gain: 2500 };
const SHARE: Record<MealType, number> = { breakfast: 0.27, lunch: 0.38, dinner: 0.35 };

const ACTIVITY: Record<string, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };

/** Estimated daily calories (Mifflin-St Jeor). Adults only. Returns null if details are missing. */
export function calorieTarget(p: Profile) {
  if (!p.age || p.age < 18 || !p.sex || !p.height || !p.weight || !p.activity || !ACTIVITY[p.activity]) return null;
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'male' ? 5 : -161);
  const tdee = bmr * ACTIVITY[p.activity];
  const adjust = p.goal === 'lose' ? -400 : p.goal === 'gain' ? 300 : 0;
  const floor = p.sex === 'male' ? 1500 : 1200; // never suggest below a safe minimum
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), target: Math.round(Math.max(floor, tdee + adjust) / 10) * 10 };
}

/** STEP 2 - rank the meals that already passed the filter. */
export function rank(meals: Meal[], p: Profile): { meal: Meal; score: number }[] {
  const target = calorieTarget(p)?.target ?? CAL_TARGET[p.goal];
  return meals.map(m => {
    let s = 0;
    if (m.goal_tags.includes(p.goal)) s += 3;
    if (m.cost <= p.budget) s += 2; else s -= (m.cost - p.budget) / 10;
    s -= Math.abs(m.calories - target * SHARE[m.meal_type]) / 100;
    if (p.preferences.some(f => f && has(m.name + ' ' + m.ingredients.join(' '), f))) s += 1.5;
    return { meal: m, score: s };
  }).sort((a, b) => b.score - a.score);
}

/** Plain-language reasons. The AI later only rewords these. */
export function reasons(m: Meal, p: Profile): string[] {
  const r: string[] = [];
  if (p.diet !== 'none') r.push(`fits your ${p.diet} diet`);
  if (p.allergies.length) r.push(`contains none of your listed allergens (${p.allergies.join(', ')})`);
  if (Number(m.cost) <= p.budget) r.push(`costs about ฿${Math.round(Number(m.cost))}, within your ฿${Math.round(p.budget)} budget`);
  if (m.goal_tags.includes(p.goal)) r.push(`suits your "${p.goal}" goal at about ${m.calories} kcal and ${m.protein} g protein (estimates)`);
  const pref = p.preferences.find(f => f && has(m.name + ' ' + m.ingredients.join(' '), f));
  if (pref) r.push(`includes ${pref}, which you like`);
  return r;
}

const CHALLENGES: Record<Profile['goal'], string[]> = {
  lose: ['Add one vegetable to every meal', 'Drink water before each meal', 'Swap one sugary drink for water or tea', 'Eat slowly: put your fork down between bites', 'Choose a protein-rich breakfast', "Prep tomorrow's lunch tonight", "Plan next week's meals"],
  maintain: ['Eat 3 balanced meals today', 'Add one vegetable to every meal', 'Try a whole grain instead of refined', 'Drink 6-8 glasses of water', 'Eat one new vegetable or legume', 'Cook one meal at home from scratch', "Plan next week's meals"],
  gain: ['Add a protein source to every meal', 'Add a healthy fat (nuts, avocado, olive oil)', 'Eat a snack between meals', 'Drink a smoothie with fruit and protein', 'Add a whole-grain side to dinner', "Prep tomorrow's lunch tonight", "Plan next week's meals"],
};

export function dailyChallenge(day: number, p: Profile): string {
  let c = CHALLENGES[p.goal][day - 1];
  if (p.budget < 80 && day === 7) c = "Plan next week's meals around low-cost staples (beans, oats, rice)";
  return c;
}

/** Filter FIRST, then rank, then fill 7 days x 3 meals. */
export function pickPlan(rows: Meal[], p: Profile) {
  // DECIMAL columns arrive from the database as strings, so convert them to numbers
  const all = rows.map(m => ({ ...m, cost: Number(m.cost) }));
  const safe = safeMeals(all, p);
  const plan: { day: number; meal: Meal }[] = [];
  for (const type of ['breakfast', 'lunch', 'dinner'] as MealType[]) {
    const ranked = rank(safe.filter(m => m.meal_type === type), p).map(x => x.meal);
    if (!ranked.length) continue; // no safe meal: leave the slot empty rather than risk it
    for (let d = 1; d <= 7; d++) plan.push({ day: d, meal: ranked[(d - 1) % ranked.length] });
  }
  return plan;
}