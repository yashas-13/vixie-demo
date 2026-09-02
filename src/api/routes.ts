import { Router } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function setupDashboardRoutes(app: Router): void {
  // Serve the dashboard HTML
  app.get('/', (_req, res) => {
    const dashboardPath = join(__dirname, '..', 'web', 'dashboard', 'index.html');
    res.sendFile(dashboardPath);
  });
}
