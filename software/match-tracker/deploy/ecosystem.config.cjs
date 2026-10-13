// PM2 process for Capek-Web (same setup as the other /srv/apps services).
//   pm2 start deploy/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [{
    name: 'wpfl-match-tracker',
    cwd: __dirname + '/..',
    script: 'server.js',
    node_args: '--env-file=.env',
    max_memory_restart: '200M',
    kill_timeout: 3000,     // SIGINT → flush data/event.json before exit
  }],
};
