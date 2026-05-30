/**
 * PM2 ecosystem config — production process management for Crub Bucks.
 *
 * Start with:   cd ~/app && pm2 start ecosystem.config.cjs
 * Reload with:  cd ~/app && pm2 reload ecosystem.config.cjs --update-env
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
 *   - reload must be run from the directory containing this file.
 *     `pm2 reload crub-bucks --update-env` alone won't pick up env_file
 *     changes — use the full reload form with the config path.
 */

module.exports = {
	apps: [
		{
			name: 'crub-bucks',
			// adapter-node writes a Node HTTP server to ./build/index.js
			script: 'build/index.js',
			cwd: '/home/crubbucks/app',
			env_file: '/home/crubbucks/app/.env',

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
