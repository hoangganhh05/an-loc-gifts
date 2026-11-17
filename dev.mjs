import {spawn} from 'node:child_process';
const children=[spawn(process.execPath,['--watch','--env-file-if-exists=.env','index.mjs'],{cwd:new URL('./backend/',import.meta.url),stdio:'inherit'}),spawn(process.execPath,['../node_modules/vite/bin/vite.js','--config','vite.config.js'],{cwd:new URL('./frontend/',import.meta.url),stdio:'inherit'})];
const stop=()=>children.forEach(p=>p.kill());process.on('SIGINT',stop);process.on('SIGTERM',stop);children.forEach(p=>p.on('exit',code=>{if(code){stop();process.exitCode=code;}}));
