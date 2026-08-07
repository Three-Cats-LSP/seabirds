const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
 testDir:'./tests',
 timeout:30000,
 use:{baseURL:'http://127.0.0.1:4175',headless:true},
 webServer:{command:'node tests/server.cjs',url:'http://127.0.0.1:4175',reuseExistingServer:!process.env.CI}
});
