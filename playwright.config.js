import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./test/browser',workers:1,use:{baseURL:'http://127.0.0.1:4173',launchOptions:{executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']}},webServer:{command:'node test/serve.js',port:4173,reuseExistingServer:false}});
