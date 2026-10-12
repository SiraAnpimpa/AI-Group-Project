import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'browser.spec.js',timeout:240000,workers:1,
  use:{baseURL:'http://127.0.0.1:4183',channel:'chrome',headless:true,viewport:{width:1440,height:1040},acceptDownloads:true,launchOptions:{downloadsPath:process.env.G07_WEB_DOWNLOADS}},
  webServer:{command:'npm run preview -- --port 4183',url:'http://127.0.0.1:4183',reuseExistingServer:false},reporter:'list'});
