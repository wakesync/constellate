import Database from 'better-sqlite3';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
export function openDatabase(path:string){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const db=new Database(path);
 if(path!==':memory:')chmodSync(path,0o600);
 db.pragma('busy_timeout = 5000');
 db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');db.pragma('secure_delete = ON');
 return db;
}
export function migrateProduct(db:Database.Database){db.transaction(()=>{db.exec(`
 CREATE TABLE IF NOT EXISTS profile(userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reading(id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, data TEXT NOT NULL, createdAt TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS reading_owner ON reading(userId,createdAt);
 `);
 const columns=db.prepare('PRAGMA table_info(profile)').all() as {name:string}[];
 if(!columns.some(c=>c.name==='revision'))db.exec("ALTER TABLE profile ADD COLUMN revision TEXT NOT NULL DEFAULT ''");
 }).immediate();
}
