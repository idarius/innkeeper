import { SvelteKitAuth } from '@auth/sveltekit';
import Discord from '@auth/sveltekit/providers/discord';
import { fetchGuildMember } from '$lib/server/discord';
import { recordDiscordLogin } from '$lib/server/permissions';
import { getAuthSecret, getDiscord } from '$lib/server/settings';

// Configuration lue à chaque requête : l'appli Discord se règle depuis l'interface
// d'administration. Session en JWT (pas d'adapter Auth.js) : la table `users` est
// tenue par le callback `signIn`, qui rafraîchit les rôles Discord à chaque connexion.
export const { handle, signIn, signOut } = SvelteKitAuth(async () => {
	const discord = getDiscord();
	return {
		secret: getAuthSecret(),
		// @auth/sveltekit force `trustHost = dev` et ignore AUTH_TRUST_HOST. Sans risque
		// ici : adapter-node construit l'URL des requêtes à partir de ORIGIN.
		trustHost: true,
		providers: discord
			? [
					Discord({
						clientId: discord.clientId,
						clientSecret: discord.clientSecret,
						// Discord renvoie désormais `iss` au callback ; sans issuer déclaré,
						// Auth.js le compare à sa valeur par défaut (https://authjs.dev) et rejette.
						issuer: 'https://discord.com',
						authorization: { params: { scope: 'identify guilds.members.read' } }
					})
				]
			: [],
		pages: { signIn: '/connexion', error: '/connexion' },
		callbacks: {
			async signIn({ account, profile, user }) {
				if (account?.provider !== 'discord' || !account.access_token || !profile || !discord) return false;

				// Tout compte Discord peut se connecter : les membres accèdent au site, les
				// autres (pas sur le serveur, ou sans rôle autorisé) seulement à leur candidature.
				const member = await fetchGuildMember(account.access_token, discord.guildId);
				recordDiscordLogin(account.providerAccountId, { username: String(profile.username), name: user.name, image: user.image }, member);
				return true;
			},
			jwt({ token, account }) {
				if (account) token.discordId = account.providerAccountId;
				return token;
			},
			session({ session, token }) {
				session.user.id = token.discordId as string;
				return session;
			}
		}
	};
});
