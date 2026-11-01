import { describe, expect, it } from 'vitest';
import { withSecurityHeaders } from './security-headers';

describe('en-têtes de sécurité', () => {
	it('interdit l’intégration dans une autre page et le reniflage des types', () => {
		const res = withSecurityHeaders(new Response('ok', { headers: { 'Content-Type': 'text/html' } }));
		expect(res.headers.get('X-Frame-Options')).toBe('DENY');
		expect(res.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
		expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
		expect(res.headers.get('Content-Type')).toBe('text/html');
	});

	it('fonctionne aussi sur une redirection aux en-têtes figés (Response.redirect)', async () => {
		const res = withSecurityHeaders(Response.redirect('https://discord.com/oauth2/authorize', 302));
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('https://discord.com/oauth2/authorize');
		expect(res.headers.get('X-Frame-Options')).toBe('DENY');
	});

	it('garde une politique de contenu déjà posée', () => {
		const res = withSecurityHeaders(new Response('', { headers: { 'Content-Security-Policy': "default-src 'self'" } }));
		expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
	});
});
