// Every feature module, in load order. Add new features here.
import devices from "./devices.js";
import island from "./island.js";
import system from "./system.js";
import sleep from "./sleep.js";

export default [devices, island, sleep, system];
