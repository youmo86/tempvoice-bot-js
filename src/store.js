import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS pilots (
        guildId TEXT NOT NULL,
        channelId TEXT PRIMARY KEY,
        categoryId TEXT NOT NULL,
        nameTemplate TEXT NOT NULL,
        userLimit INTEGER NOT NULL CHECK(userLimit BETWEEN 0 AND 99)
      );
      CREATE TABLE IF NOT EXISTS rooms (
        guildId TEXT NOT NULL,
        channelId TEXT PRIMARY KEY,
        pilotId TEXT NOT NULL,
        categoryId TEXT NOT NULL,
        ownerId TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rooms_guild ON rooms(guildId);
      CREATE INDEX IF NOT EXISTS pilots_guild ON pilots(guildId);
    `);
  }

  savePilot(pilot) {
    const result = this.db.prepare(`INSERT INTO pilots VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(channelId) DO UPDATE SET
        categoryId=excluded.categoryId,
        nameTemplate=excluded.nameTemplate, userLimit=excluded.userLimit
      WHERE pilots.guildId=excluded.guildId`)
      .run(pilot.guildId, pilot.channelId, pilot.categoryId, pilot.nameTemplate, pilot.userLimit);
    if (result.changes === 0) throw new Error('Ce pilote appartient à un autre serveur.');
  }

  getPilot(guildId, channelId) {
    return this.db.prepare('SELECT * FROM pilots WHERE guildId=? AND channelId=?').get(guildId, channelId);
  }

  listPilots(guildId) {
    return this.db.prepare('SELECT * FROM pilots WHERE guildId=? ORDER BY channelId').all(guildId);
  }

  removePilot(guildId, channelId) {
    this.db.prepare('DELETE FROM pilots WHERE guildId=? AND channelId=?').run(guildId, channelId);
  }

  saveRoom(room) {
    this.db.prepare('INSERT INTO rooms VALUES (?, ?, ?, ?, ?, ?)')
      .run(room.guildId, room.channelId, room.pilotId, room.categoryId, room.ownerId, room.createdAt);
  }

  getRoom(guildId, channelId) {
    return this.db.prepare('SELECT * FROM rooms WHERE guildId=? AND channelId=?').get(guildId, channelId);
  }

  listRooms(guildId) {
    return this.db.prepare('SELECT * FROM rooms WHERE guildId=? ORDER BY createdAt, channelId').all(guildId);
  }

  removeRoom(guildId, channelId) {
    this.db.prepare('DELETE FROM rooms WHERE guildId=? AND channelId=?').run(guildId, channelId);
  }

  close() {
    this.db.close();
  }
}
