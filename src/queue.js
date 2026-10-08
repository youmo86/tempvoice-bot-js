// Toutes les mutations passent par cette file, y compris les minuteurs.
// Une erreur n'empêche pas l'exécution des opérations suivantes.
export class SerialQueue {
  #tail = Promise.resolve();

  run(task) {
    const next = this.#tail.then(task);
    this.#tail = next.catch(() => {});
    return next;
  }

  idle() {
    return this.#tail;
  }
}
