# SmartDiet AI - 7-Day Healthy Eating Challenge

A web app that gives each user a 7-day healthy eating challenge, personalized to their goal, food preferences, allergies and budget.

**Stack:** TypeScript (Node.js + Express server, browser client), CSS, SQL for TiDB, Google Gemini API for AI.
**Language:** English for the interface and documentation.

## Features
- **Profile:** goal (lose, maintain, gain), diet (none, vegetarian, vegan), budget per meal, allergies, foods to avoid, foods liked.
- **Daily challenges:** one personalized challenge per day for 7 days.
- **AI meal recommendations and explanations:** 3 meals per day, each with a short reason it was recommended.
- **Progress tracking:** mark each day complete on the "spice rack" of 7 jars.
- **Weekly food story:** daily estimated-intake bars, logged-food days, challenge progress, streaks and a positive weekly highlight.
- **Quick food logging:** search the food table from the Home dashboard, enter an amount and save its estimated calories; use photo estimation when a food is not found.
- **Meal photo estimate:** take or upload a food photo, a vision model suggests foods, portions and calories, and the user edits everything before saving.

## How recommendations work
1. **Rule-based filter (required, runs first):** removes any meal that matches an allergy, a disliked food, or the wrong diet.
2. **Ranking:** the remaining meals are scored by goal, budget, calorie target and liked foods.
3. **AI explanations:** the AI only rewords the reasons for meals that already passed the filter. It cannot add or restore meals. If the AI fails, plain-text reasons are shown.

If no safe meal exists for a slot, the slot stays empty instead of showing an unsafe meal.

## Photo calorie estimates
- Photo results are **estimates, not exact values**, and are labelled that way in the interface.
- Users can edit foods, portions and calories before saving.
- Saved photo logs are stored with `is_estimate = TRUE`.

## Project structure
```
smartdiet/
├── db/schema.sql        TiDB tables and 12 sample meals
├── src/rules.ts         allergy filter, ranking, daily challenges
├── src/ai.ts            AI explanations and photo estimates (Gemini)
├── src/server.ts        Express API and database access
├── client/app.ts        browser app (compiled to public/app.js)
└── public/              index.html, styles.css, manifest, icon
```

## Setup
1. Create a TiDB Cloud cluster and run `db/schema.sql` in the SQL Editor. For an existing database, run `node --env-file=.env add-code.js` once after configuring `DATABASE_URL` to add unique profile codes to existing users.
2. Create a free Gemini API key in Google AI Studio and choose a Flash model that accepts images.
3. Copy `.env.example` to `.env` and fill it in:
   ```
   DATABASE_URL=mysql://USER:PASSWORD@HOST:4000/smartdiet
   GEMINI_API_KEY=your_key
   GEMINI_MODEL=model_id_from_ai_studio
   PORT=3000
   ```
4. Install and run (Node 20.6 or newer):
   ```
   npm install
   npm run build
   npm start
   ```
5. Open http://localhost:3000

After changing any `.ts` file, run `npm run build` again and restart the server.

## Safety and limits
- Nutrition values are estimates and this app is not medical advice.
- Allergy filtering depends on the allergen tags and ingredients in the `meals` table. Always check real food labels.
- The sample catalogue has only 12 meals. More meals can be added, for example from USDA FoodData Central.
- Never commit `.env` or share its keys.

## Not included yet
- User login and authentication (users are identified by an id stored in the browser)
- Rate limiting and automated tests
- Offline mode (service worker)