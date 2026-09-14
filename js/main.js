// js/main.js
// Minimal placeholder bootstrap for the shell page. t009's real UI will
// import js/engine.js directly and drive its own DOM/progress screens;
// this file only proves the module graph wires up under Vite.
console.log('Ulysses engine module graph loaded. Call initEngine() to load models.');
window.UlyssesEngine = await import('./engine.js');
