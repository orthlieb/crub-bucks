/**
 * PM2 ecosystem config — production process management for Crub Bucks.
 *
 * Start with:   cd ~/app && pm2 start ecosystem.config.cjs
 * Reload with:  cd ~/app && pm2 reload crub-bucks
 * Logs with:    pm2 logs crub-bucks
 * Monitor with: pm2 monit
 *
 * Notes:
 *   - File is .cjs (not .js) because package.json has "type": "module".
 *     PM2 needs CommonJS to load the config; loading an ESM file fails
 *     with "ecosystem.config.js: ECMAScript module is not supported".
 *   - PM2 + nvm requires an interactive login shell. Always
 *       su - crubbucks
 *     (with the leading dash) so .bashrc / nvm initialize.
 *   - We load .env via Node's built-in `--env-file` flag (Node 20.6+)
 *     rather than PM2's `env_file` directive. PM2's env_file has been
 *     flaky in 7.x (silently doesn't load) and `--env-file` survives
 *     `pm2 save` + `pm2 resurrect` cleanly. Edit .env then reload —
 *     Node re-reads the file on each process start.
 */

module.exports = {
	apps: [
		{
			name: 'crub-bucks',
			// adapter-node writes a Node HTTP server to ./build/index.js
			script: 'build/index.js',
			cwd: '/home/crubbucks/app',

			// Load production env vars via Node's native --env-file flag
			// (Node 20.6+). See note above about why this beats PM2's
			// env_file directive on PM2 7.x.
			node_args: '--env-file=/home/crubbucks/app/.env',

			// SvelteKit SSR is single-threaded per process. One worker is
			// enough for a friends-and-family scale app; switch to cluster
			// mode + instances:2 once response time under load justifies it.
			instances: 1,
			exec_mode: 'fork',

			autorestart: true,
			max_restarts: 10,
			min_uptime: '10s',
			restart_delay: 1000,
			kill_timeout: 10000,
			listen_timeout: 8000,

			out_file: '/home/crubbucks/logs/out.log',
			error_file: '/home/crubbucks/logs/error.log',
			merge_logs: true,
			log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

			env: {
				NODE_ENV: 'production',
				// Nginx proxies 443 → 3000. Override here if you change the
				// upstream port in /etc/nginx/sites-available/crubbucks.
				PORT: '3000',
				HOST: '127.0.0.1'
			}
		}
	]
};
