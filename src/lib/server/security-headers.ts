// En-têtes de sécurité ajoutés à toutes les réponses du site :
// - aucune intégration dans une page d'un autre site (clics détournés sur les actions d'admin) ;
// - pas de « reniflage » : une image envoyée est servie pour ce qu'elle est déclarée ;
// - l'adresse complète des pages ne part pas vers les sites externes (liens, images).
const HEADERS: Record<string, string> = {
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin'
};
// Équivalent moderne de X-Frame-Options, posé seulement si la réponse n'a pas déjà sa politique.
const FRAME_ANCESTORS = "frame-ancestors 'none'";

function apply(headers: Headers) {
	for (const [name, value] of Object.entries(HEADERS)) headers.set(name, value);
	if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', FRAME_ANCESTORS);
}

export function withSecurityHeaders(response: Response) {
	try {
		apply(response.headers);
		return response;
	} catch {
		// En-têtes figés (Response.redirect, réponse reçue d'un fetch) : copie modifiable.
		const copy = new Response(response.body, { status: response.status, statusText: response.statusText, headers: new Headers(response.headers) });
		apply(copy.headers);
		return copy;
	}
}
