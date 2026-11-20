-- TiDB (MySQL-compatible)
CREATE DATABASE IF NOT EXISTS smartdiet;
USE smartdiet;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  access_code VARCHAR(12) NULL,
  name VARCHAR(80) NOT NULL,
  goal ENUM('lose','maintain','gain') NOT NULL,
  diet ENUM('none','vegetarian','vegan') NOT NULL DEFAULT 'none',
  budget DECIMAL(6,2) NOT NULL,              -- max cost per meal (THB)
  allergies JSON NOT NULL,
  dislikes JSON NOT NULL,
  preferences JSON NOT NULL,
  age TINYINT NULL,
  sex ENUM('male','female') NULL,
  height_cm DECIMAL(5,1) NULL,
  weight_kg DECIMAL(5,1) NULL,
  activity ENUM('sedentary','light','moderate','active') NULL,
  started_on DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_access_code (access_code)
);

CREATE TABLE IF NOT EXISTS meals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  meal_type ENUM('breakfast','lunch','dinner') NOT NULL,
  diet_tags JSON NOT NULL,                   -- e.g. ["vegetarian","vegan"]
  allergens JSON NOT NULL,                   -- e.g. ["egg","gluten"]
  goal_tags JSON NOT NULL,
  cost DECIMAL(5,2) NOT NULL,
  calories INT NOT NULL,                     -- nutrition values are estimates
  protein INT NOT NULL,
  carbs INT NOT NULL,
  fat INT NOT NULL,
  ingredients JSON NOT NULL,
  steps TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_meals (
  user_id BIGINT NOT NULL,
  day TINYINT NOT NULL,
  meal_type ENUM('breakfast','lunch','dinner') NOT NULL,
  meal_id INT NOT NULL,
  explanation TEXT NOT NULL,
  PRIMARY KEY (user_id, day, meal_type)
);

CREATE TABLE IF NOT EXISTS challenge_progress (
  user_id BIGINT NOT NULL,
  day TINYINT NOT NULL,
  completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS meal_checks (
  user_id BIGINT NOT NULL,
  day TINYINT NOT NULL,
  meal_type ENUM('breakfast','lunch','dinner') NOT NULL,
  PRIMARY KEY (user_id, day, meal_type)
);

CREATE TABLE IF NOT EXISTS meal_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  day TINYINT NOT NULL,
  source ENUM('photo','manual') NOT NULL,
  items JSON NOT NULL,                       -- user-confirmed [{name, grams, calories}]
  total_calories INT NOT NULL,
  is_estimate BOOLEAN NOT NULL DEFAULT TRUE, -- photo logs are always estimates
  logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_day (user_id, day)
);

INSERT INTO meals (name,meal_type,diet_tags,allergens,goal_tags,cost,calories,protein,carbs,fat,ingredients,steps) VALUES
('Berry oatmeal with chia','breakfast','["vegetarian","vegan"]','["gluten"]','["maintain","lose"]',1.50,320,10,52,8,'["oats","blueberries","chia seeds","soy milk"]','Simmer oats in milk 5 min. Top with berries and chia.'),
('Veggie egg scramble on toast','breakfast','["vegetarian"]','["egg","gluten"]','["maintain","lose"]',2.20,350,22,30,16,'["eggs","spinach","tomato","whole-wheat toast"]','Scramble eggs with spinach and tomato. Serve on toast.'),
('Peanut butter banana smoothie','breakfast','["vegetarian","vegan"]','["peanut"]','["gain"]',2.00,520,18,62,22,'["banana","peanut butter","oats","soy milk"]','Blend everything until smooth.'),
('Greek yogurt parfait','breakfast','["vegetarian"]','["milk","tree_nut"]','["lose","maintain"]',2.40,300,20,34,9,'["greek yogurt","honey","almonds","strawberries"]','Layer yogurt, fruit and almonds.'),
('Chickpea quinoa bowl','lunch','["vegetarian","vegan"]','[]','["maintain","lose","gain"]',3.00,520,19,78,14,'["chickpeas","quinoa","cucumber","lemon","olive oil"]','Cook quinoa. Toss with chickpeas, cucumber, lemon and oil.'),
('Grilled chicken salad','lunch','["none"]','[]','["lose","maintain"]',3.80,430,38,18,22,'["chicken breast","lettuce","tomato","olive oil"]','Grill chicken 6 min per side. Slice over salad.'),
('Tofu stir-fry with brown rice','lunch','["vegetarian","vegan"]','["soy"]','["maintain","gain"]',3.20,560,26,76,16,'["tofu","broccoli","brown rice","soy sauce"]','Pan-fry tofu, add broccoli and sauce, serve over rice.'),
('Tuna avocado wrap','lunch','["none"]','["fish","gluten"]','["gain","maintain"]',4.10,590,32,48,28,'["tuna","avocado","whole-wheat wrap","lettuce"]','Mash avocado, add tuna and lettuce, roll up.'),
('Lentil vegetable soup','dinner','["vegetarian","vegan"]','[]','["lose","maintain"]',2.50,380,22,58,6,'["red lentils","carrot","onion","cumin"]','Simmer lentils and vegetables 25 min. Season with cumin.'),
('Baked salmon with sweet potato','dinner','["none"]','["fish"]','["maintain","gain"]',6.20,610,38,48,28,'["salmon","sweet potato","green beans"]','Bake salmon and potato at 200C for 20 min.'),
('Turkey chili','dinner','["none"]','[]','["gain","maintain"]',3.90,540,40,50,16,'["ground turkey","kidney beans","tomato","chili"]','Brown turkey, add beans and tomato, simmer 30 min.'),
('Veggie pasta primavera','dinner','["vegetarian","vegan"]','["gluten"]','["maintain","gain"]',3.10,500,16,84,10,'["whole-wheat pasta","zucchini","bell pepper","garlic"]','Boil pasta. Saute vegetables and toss together.');