import { SerialQueue } from './queue.js';
import { VoiceService } from './voice-service.js';
import { safeError } from './errors.js';

// Une configuration, une file et un état d'exécution distincts par serveur.
// La base est partagée ; chaque lecture/écriture reste filtrée par guildId.
export class GuildManager {
  constructor({ store, config, log = console }) {
    Object.assign(this, { store, config, log });
    this.contexts = new Map();
    this.retired = new Set();
    this.closing = false;
  }

  getContext(guild) {
    if (this.closing || !guild?.available) return null;
    let context = this.contexts.get(guild.id);
    if (!context) {
      // Une réinvitation attend la fin d'une requête déjà commencée sur ce serveur.
      const previous = [...this.retired].find(value => value.config.guildId === guild.id);
      const queue = previous?.queue ?? new SerialQueue();
      const config = { ...this.config, guildId: guild.id };
      const service = new VoiceService({ store: this.store, config, queue, log: this.log });
      context = { config, queue, service, store: this.store, retired: false, maintenance: null };
      this.contexts.set(guild.id, context);
    }
    return context;
  }

  run(guild, operation) {
    const context = this.getContext(guild);
    if (!context) return Promise.resolve();
    return context.queue.run(() => {
      if (this.closing || context.retired || !guild.available) return;
      return operation(context);
    });
  }

  reconcile(guild) {
    const context = this.getContext(guild);
    if (!context) return Promise.resolve();
    if (context.maintenance) return context.maintenance;
    const pending = this.run(guild, async () => {
      context.service.active = true;
      try { await context.service.reconcile(guild); }
      catch (error) { context.service.active = false; throw error; }
    });
    context.maintenance = pending.finally(() => { context.maintenance = null; });
    return context.maintenance;
  }

  async reconcileAll(guilds) {
    const available = [...guilds].filter(guild => guild.available);
    const results = await Promise.allSettled(available.map(guild => this.reconcile(guild)));
    for (let index = 0; index < results.length; index++) {
      if (results[index].status === 'rejected') {
        this.log.error(`[serveur ${available[index].id}] Reprise : ${safeError(results[index].reason)}`);
      }
    }
  }

  remove(guildId) {
    const context = this.contexts.get(guildId);
    if (!context) return;
    context.retired = true;
    context.service.dispose();
    this.contexts.delete(guildId);
    this.retired.add(context);
    context.queue.idle().then(() => this.retired.delete(context));
    // Conserver la configuration SQLite pour une éventuelle réinvitation.
  }

  dispose() {
    this.closing = true;
    for (const context of this.contexts.values()) context.service.dispose();
  }

  async idle() {
    await Promise.all([...this.contexts.values(), ...this.retired].map(context => context.queue.idle()));
  }
}
