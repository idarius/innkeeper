import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { botReady, guildMember } from '$lib/server/bot';
import { db, schema } from '$lib/server/db';
import { requireOfficer } from '$lib/server/guards';
import { listRoles } from '$lib/server/permissions';
import {
	acceptApplication,
	ensureArrival,
	getApplication,
	refuseApplication,
	removeVote,
	vote,
	voterOf,
	votesFor
} from '$lib/server/recruitment';
import type { Application } from '$lib/server/db/schema';
import { getCharter } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

function candidateOf(app: Application) {
	return db().select().from(schema.users).where(eq(schema.users.discordId, app.userId)).get();
}

function loadApplication(locals: App.Locals, rawId: string) {
	requireOfficer(locals);
	const app = getApplication(Number(rawId));
	if (!app) error(404, 'Candidature introuvable');
	return { app, voter: voterOf(locals)! };
}

const target = (app: Application) => ({ label: candidateOf(app)?.displayName ?? app.character.name, url: `/admin/candidatures/${app.id}` });

export const load: PageServerLoad = async ({ locals, params }) => {
	const { app, voter } = loadApplication(locals, params.id);
	const user = candidateOf(app);

	// Situation actuelle du candidat sur le serveur Discord (via le bot).
	let discord: { member: boolean; roles: string[] } | null = null;
	if (botReady()) {
		const member = await guildMember(app.userId).catch(() => undefined);
		if (member !== undefined) {
			const names = new Map(listRoles().map((r) => [r.id, r.name ?? r.label ?? r.id]));
			discord = { member: Boolean(member), roles: (member?.roles ?? []).map((id) => names.get(id) ?? id) };
		}
	}

	const votes = votesFor(app.id);
	// Charte modifiée après son acceptation : le candidat a accepté une version antérieure.
	const charterUpdatedAt = getCharter()?.updatedAt ?? null;
	const charterChangedAt =
		app.charterAcceptedAt && charterUpdatedAt && charterUpdatedAt > app.charterAcceptedAt.getTime() + 1000 ? new Date(charterUpdatedAt) : null;

	return {
		app,
		charterChangedAt,
		candidate: { name: user?.displayName ?? '?', username: user?.discordUsername ?? '', avatar: user?.avatar ?? null },
		discord,
		votes,
		myVote: votes.find((v) => v.voterId === voter.id) ?? null
	};
};

export const actions: Actions = {
	vote: async ({ locals, params, request }) => {
		const { app, voter } = loadApplication(locals, params.id);
		if (app.status !== 'pending') return fail(400, { error: 'La décision est déjà prise.' });
		const form = await request.formData();
		const value = Number(form.get('value')) === -1 ? -1 : 1;
		const comment = String(form.get('comment') ?? '').trim().slice(0, 1000) || null;
		if (value === -1 && !comment) return fail(400, { error: 'Explique ton avis défavorable en quelques mots.' });
		vote(app, voter, value, comment);
		audit(locals, 'application.vote', target(app), { avis: value > 0 ? '+1' : '−1', commentaire: comment ?? undefined });
	},
	unvote: ({ locals, params }) => {
		const { app, voter } = loadApplication(locals, params.id);
		if (app.status === 'pending') removeVote(app, voter);
	},
	accept: async ({ locals, params, request }) => {
		const { app, voter } = loadApplication(locals, params.id);
		if (app.status !== 'pending') return fail(400, { error: 'La décision est déjà prise.' });
		const form = await request.formData();
		const down = votesFor(app.id).filter((v) => v.value < 0).length;
		if (down > 0 && form.get('confirm') !== 'on')
			return fail(400, { error: 'Il y a des avis défavorables : coche la case de confirmation pour accepter quand même.' });
		const message = String(form.get('message') ?? '').trim().slice(0, 1000) || null;
		const accepted = await acceptApplication(app, voter, message);
		if (!accepted) return fail(400, { error: 'La décision est déjà prise.' });
		audit(locals, 'application.accept', target(app), { avisDefavorables: down || undefined, message: message ?? undefined });
		return { decided: 'accepted', arrivalError: accepted.arrivalError };
	},
	refuse: async ({ locals, params, request }) => {
		const { app, voter } = loadApplication(locals, params.id);
		if (app.status !== 'pending') return fail(400, { error: 'La décision est déjà prise.' });
		const message = String((await request.formData()).get('message') ?? '').trim().slice(0, 1000) || null;
		if (!refuseApplication(app, voter, message)) return fail(400, { error: 'La décision est déjà prise.' });
		audit(locals, 'application.refuse', target(app), { message: message ?? undefined });
		return { decided: 'refused' };
	},
	retry: async ({ locals, params }) => {
		const { app } = loadApplication(locals, params.id);
		return { arrivalError: await ensureArrival(app), retried: true };
	}
};
