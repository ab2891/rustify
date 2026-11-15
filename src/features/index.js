// Every feature module, in load order. Add new features here.
import devices from "./devices.js";
import island from "./island.js";
import system from "./system.js";
import sleep from "./sleep.js";
import lyrics from "./lyrics.js";
import rules from "./rules.js";
import transitions from "./transitions.js";
import stats from "./stats.js";
import home from "./home.js";
import suggestions from "./suggestions.js";

export default [devices, island, lyrics, rules, transitions, stats, home, suggestions, sleep, system];
