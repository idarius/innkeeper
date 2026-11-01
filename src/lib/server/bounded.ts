// Caches en mémoire à taille bornée : un visiteur qui demande des milliers d'identifiants
// différents ne doit pas faire grossir le processus sans fin. Les entrées les plus anciennes
// (ordre d'insertion des Map et Set) partent en premier.

export function remember<K, V>(store: Map<K, V> | Set<K>, key: K, value: V, max: number) {
	store.delete(key);
	if (store instanceof Map) store.set(key, value);
	else store.add(key);
	for (const oldest of store.keys()) {
		if (store.size <= max) break;
		store.delete(oldest);
	}
}
