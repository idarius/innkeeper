<script lang="ts">
	import { enhance } from '$app/forms';
	import { professionNames } from '$lib/labels';

	let { data, form } = $props();
	const cfg = $derived(data.config);
	const plan = $derived(form && 'plan' in form ? form.plan : null);
	const changes = $derived(plan?.updates.filter((u) => u.level || u.professions || u.recipes) ?? []);
	const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
	const dayFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
	let sending = $state(false);
</script>

<h1>Import du jeu</h1>
<p class="muted intro">
	L'addon <strong>InnkeeperSync</strong> exporte depuis le jeu le registre de guilde (niveaux, dernière connexion),
	les métiers de tous les membres et les recettes de ton perso. Le site met à jour les fiches en reliant les persos par
	leur nom : il faut que le nom de la fiche soit exactement celui du jeu.
</p>

<section class="card steps">
	<h2>Comment faire</h2>
	<ol>
		<li>
			Installer l'addon <strong>Innkeeper Sync</strong> : dans l'application CurseForge ou Wago (version de jeu
			World of Warcraft: Forever), ou <a href="/addon/InnkeeperSync.zip" download>en zip</a> à décompresser dans le
			dossier <code>Interface/AddOns</code> du jeu.
		</li>
		<li>En jeu, avec un perso de la guilde : tape <code>/innkeeper</code> (ou <code>/ik</code>), puis <code>/reload</code> pour que le jeu écrive le fichier.</li>
		<li>Pour exporter aussi tes recettes : ouvre la fenêtre de chacun de tes métiers avant le <code>/reload</code>.</li>
		<li>
			Dépose ci-dessous le fichier <code>WTF/Account/&lt;TON COMPTE&gt;/SavedVariables/InnkeeperSync.lua</code>
			(dans le dossier du jeu).
		</li>
	</ol>
	<p class="muted small">
		L'addon n'envoie rien sur Internet : il écrit seulement ce fichier. Un officier suffit pour toute la guilde ;
		refais-le de temps en temps (une fois par semaine par exemple).
	</p>
</section>

{#if form?.error}<p class="card error">{form.error}</p>{/if}
{#if form?.applied !== undefined && form?.synced !== undefined}
	{@const n = form.applied}
	{@const synced = form.synced}
	<p class="card ok">
		Import terminé : {n} fiche{n > 1 ? 's' : ''} mise{n > 1 ? 's' : ''} à jour, {synced} perso{synced > 1 ? 's' : ''}
		synchronisé{synced > 1 ? 's' : ''} (dernière connexion).
	</p>
{/if}

<form
	method="POST"
	action="?/preview"
	enctype="multipart/form-data"
	class="card upload"
	use:enhance={() => {
		sending = true;
		return async ({ update }) => {
			await update();
			sending = false;
		};
	}}
>
	<label for="file">Fichier InnkeeperSync.lua</label>
	<div class="row">
		<input id="file" name="file" type="file" accept=".lua" required />
		<button disabled={sending}>{sending ? 'Lecture…' : 'Voir les changements'}</button>
	</div>
</form>

{#if plan && form && 'token' in form}
	<section class="card preview">
		<h2>Aperçu</h2>
		<p>
			Export du {dateFormat.format(plan.exportedAt)}{plan.guild ? ` · ${plan.guild}` : ''} · {plan.rosterSize} membres en jeu
		</p>
		<p>
			<strong>{changes.length}</strong> fiche{changes.length > 1 ? 's' : ''} à mettre à jour ·
			<strong>{plan.updates.length}</strong> perso{plan.updates.length > 1 ? 's' : ''} reconnu{plan.updates.length > 1 ? 's' : ''} ·
			<strong>{plan.withoutSheet.length}</strong> membre{plan.withoutSheet.length > 1 ? 's' : ''} sans fiche
		</p>

		{#if changes.length}
			<div class="table-wrap">
				<table>
					<thead><tr><th>Perso</th><th>Niveau</th><th>Métiers</th><th>Recettes</th></tr></thead>
					<tbody>
						{#each changes as u (u.characterId)}
							<tr>
								<td><strong>{u.name}</strong><br /><span class="muted small">{u.player}</span></td>
								<td>{#if u.level}{u.level.from} → <strong>{u.level.to}</strong>{:else}<span class="muted">—</span>{/if}</td>
								<td>
									{#if u.professions}
										<span class="muted">{professionNames(cfg, u.professions.from) || 'aucun'}</span><br />→ {professionNames(cfg, u.professions.to)}
									{:else}<span class="muted">—</span>{/if}
								</td>
								<td>{#if u.recipes}{u.recipes.reduce((n, r) => n + r.recipes.length, 0)} recettes{:else}<span class="muted">—</span>{/if}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="muted">Aucune fiche à modifier : les niveaux et métiers sont déjà à jour.</p>
		{/if}

		{#if plan.ambiguous.length}
			<p class="warn">Plusieurs fiches portent ces noms, elles ne sont pas mises à jour : {plan.ambiguous.join(', ')}.</p>
		{/if}
		{#if plan.outdated.length}
			<p class="warn">Ces fiches ont déjà des données d'un export plus récent, elles ne sont pas remplacées : {plan.outdated.join(', ')}.</p>
		{/if}

		<form method="POST" action="?/apply" use:enhance class="row">
			<input type="hidden" name="token" value={form.token} />
			<button>Appliquer l'import</button>
			<span class="muted small">La dernière connexion en jeu des {plan.updates.length} persos reconnus est aussi enregistrée.</span>
		</form>
	</section>

	{#if plan.notFound.length}
		<section class="card">
			<h2>Fiches du site introuvables dans la guilde en jeu <span class="muted">({plan.notFound.length})</span></h2>
			<p class="muted small">
				Nom mal orthographié sur la fiche, perso pas encore dans la guilde, ou ancien perso. Elles seront marquées « pas
				trouvé en jeu » après l'import.
			</p>
			<ul class="without">
				{#each plan.notFound as n (n.characterId)}
					<li><a href="/persos/{n.characterId}"><strong>{n.name}</strong></a> <span class="muted">{n.player}</span></li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if plan.withoutSheet.length}
		<section class="card">
			<h2>Membres de la guilde sans fiche sur le site <span class="muted">({plan.withoutSheet.length})</span></h2>
			<p class="muted small">Nom en jeu introuvable sur le site : pas de compte, pas de fiche, ou nom différent sur la fiche.</p>
			<ul class="without">
				{#each plan.withoutSheet as m (m.name)}
					<li><strong>{m.name}</strong> <span class="muted">niv. {m.level}{m.class ? ` · ${m.class}` : ''}{m.rank ? ` · ${m.rank}` : ''}</span></li>
				{/each}
			</ul>
		</section>
	{/if}
{/if}

<style>
	.intro {
		max-width: 70ch;
	}
	section,
	.upload {
		display: grid;
		gap: 0.6rem;
		margin-bottom: 1rem;
	}
	h2 {
		margin: 0;
		font-size: 1.1rem;
	}
	section p {
		margin: 0;
	}
	.steps ol {
		margin: 0;
		padding-left: 1.25rem;
		display: grid;
		gap: 0.35rem;
	}
	code {
		background: var(--surface-2);
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		word-break: break-all;
	}
	.small {
		font-size: 0.85rem;
	}
	.upload input[type='file'] {
		flex: 1;
		min-width: 0;
	}
	.without {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: 0.3rem 1rem;
	}
	.warn {
		color: var(--gold);
	}
	.ok {
		border-color: var(--gold);
		margin-bottom: 1rem;
	}
	p.card.error {
		margin-bottom: 1rem;
	}
</style>
